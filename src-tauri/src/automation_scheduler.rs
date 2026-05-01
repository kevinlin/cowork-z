use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use cron::Schedule;
use rusqlite::Connection;
use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::db::{automations as db_automations, DbState};
use crate::sidecar::{
    self, ApiKeys, FolderPermissionPayload, SidecarCommand, SidecarState, StartTaskPayload,
};

struct ScheduledItem {
    next_fire: DateTime<Utc>,
    automation_id: String,
}

impl PartialEq for ScheduledItem {
    fn eq(&self, other: &Self) -> bool {
        self.next_fire == other.next_fire
    }
}

impl Eq for ScheduledItem {}

impl PartialOrd for ScheduledItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ScheduledItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reverse so the earliest fire time is popped first (min-heap)
        other.next_fire.cmp(&self.next_fire)
    }
}

/// Shared state for tracking whether an automation run is currently executing.
/// This prevents concurrent automation runs (v1 sequential model).
pub struct AutomationSchedulerState {
    pub is_running: AtomicBool,
}

impl AutomationSchedulerState {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
        }
    }
}

impl Default for AutomationSchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct AutomationScheduler {
    queue: Arc<Mutex<BinaryHeap<ScheduledItem>>>,
}

/// Resolved context needed to dispatch a `StartTask` to the sidecar.
struct StartTaskDispatch {
    task_id: String,
    prompt: String,
    working_directory: Option<String>,
    folder_permissions: Option<Vec<FolderPermissionPayload>>,
    custom_prompt: Option<String>,
    mcp_servers: Option<serde_json::Value>,
    model_id: String,
    api_keys: ApiKeys,
}

/// Resolve workspace + settings + secrets needed to dispatch a `StartTask` for an automation.
fn build_dispatch_context(
    conn: &Connection,
    automation: &db_automations::StoredAutomation,
    task_id: String,
) -> Result<StartTaskDispatch, String> {
    let working_directory = crate::db::workspaces::get_workspace(conn, &automation.workspace_id)
        .map(|w| w.folder_path);

    let workspace_perms =
        crate::db::workspace_permissions::get_workspace_permissions(conn, &automation.workspace_id);
    let mut perms: Vec<FolderPermissionPayload> = Vec::new();
    if let Some(ref wd) = working_directory {
        perms.push(FolderPermissionPayload {
            path: wd.clone(),
            access_level: "read-write".to_string(),
            source: Some("workspace".to_string()),
        });
    }
    perms.extend(workspace_perms.into_iter().map(|wp| FolderPermissionPayload {
        path: wp.folder_path,
        access_level: wp.access_level,
        source: Some(wp.source),
    }));
    let folder_permissions = if perms.is_empty() { None } else { Some(perms) };

    let custom_prompt = if crate::db::settings::get_user_prompt_enabled(conn) {
        crate::db::settings::get_user_prompt_text(conn)
    } else {
        None
    };

    let mcp_servers = crate::db::settings::get_mcp_servers_config(conn)
        .map(|c| serde_json::to_value(c).unwrap());

    let api_keys = sidecar::get_all_api_keys()
        .map_err(|e| format!("Failed to get API keys: {}", e))?;

    Ok(StartTaskDispatch {
        task_id,
        prompt: automation.prompt.clone(),
        working_directory,
        folder_permissions,
        custom_prompt,
        mcp_servers,
        model_id: automation.model_id.clone(),
        api_keys,
    })
}

/// Send `StartTask` to the sidecar, spawning it if needed. Errors are logged.
fn spawn_start_task_dispatch(app: &AppHandle, dispatch: StartTaskDispatch) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let sidecar_state = app_handle.state::<SidecarState>();
        let mut manager = sidecar_state.manager.lock().await;
        if !manager.is_running() {
            if let Err(e) = manager.spawn(&app_handle).await {
                eprintln!("[AutomationScheduler] Failed to spawn sidecar: {}", e);
                return;
            }
        }

        let StartTaskDispatch {
            task_id,
            prompt,
            working_directory,
            folder_permissions,
            custom_prompt,
            mcp_servers,
            model_id,
            api_keys,
        } = dispatch;

        if let Err(e) = manager
            .send_command(SidecarCommand::StartTask {
                task_id: task_id.clone(),
                payload: StartTaskPayload {
                    task_id,
                    prompt,
                    api_keys: Some(api_keys),
                    working_directory,
                    model_id: Some(model_id),
                    folder_permissions,
                    custom_prompt,
                    mcp_servers,
                    skip_config: None,
                    arena_id: None,
                },
            })
            .await
        {
            eprintln!("[AutomationScheduler] Failed to send StartTask: {}", e);
        }
    });
}

impl AutomationScheduler {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(BinaryHeap::new())),
        }
    }

    /// Normalize a cron expression for the `cron` crate which requires 6-7 fields
    /// (sec min hour dom month dow [year]). Standard 5-field Unix cron (min hour dom month dow)
    /// is converted by prepending "0" for seconds.
    fn normalize_cron(expr: &str) -> String {
        let fields: Vec<&str> = expr.split_whitespace().collect();
        if fields.len() == 5 {
            format!("0 {}", expr)
        } else {
            expr.to_string()
        }
    }

    fn reload_queue(&self, app: &AppHandle) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
        let automations = db_automations::list_enabled_automations(&conn);

        let mut queue = self.queue.lock().unwrap();
        queue.clear();

        let now = Utc::now();
        for automation in automations {
            let normalized = Self::normalize_cron(&automation.schedule_cron);
            if let Ok(schedule) = Schedule::from_str(&normalized) {
                if let Some(next) = schedule.upcoming(Utc).next() {
                    if next > now {
                        queue.push(ScheduledItem {
                            next_fire: next,
                            automation_id: automation.id,
                        });
                    }
                }
            } else {
                eprintln!(
                    "[AutomationScheduler] Invalid cron for automation '{}': {}",
                    automation.name, automation.schedule_cron
                );
            }
        }

        println!(
            "[AutomationScheduler] Reloaded queue with {} items",
            queue.len()
        );
    }

    pub fn start(self, app: AppHandle) {
        let queue = self.queue.clone();

        std::thread::spawn(move || {
            // Wait for DB and app to initialize
            std::thread::sleep(std::time::Duration::from_secs(5));

            let scheduler = AutomationScheduler {
                queue: queue.clone(),
            };
            scheduler.reload_queue(&app);

            loop {
                std::thread::sleep(std::time::Duration::from_secs(30));

                let now = Utc::now();
                let mut due_automations: Vec<String> = vec![];

                {
                    let mut q = queue.lock().unwrap();
                    while let Some(item) = q.peek() {
                        if item.next_fire <= now {
                            let item = q.pop().unwrap();
                            due_automations.push(item.automation_id);
                        } else {
                            break;
                        }
                    }
                }

                let scheduler_state = app.state::<AutomationSchedulerState>();

                for automation_id in due_automations {
                    Self::fire_automation(&app, &automation_id, &scheduler_state);
                    Self::reschedule(&app, &automation_id, &queue);
                }

                // Check for pending runs that can now execute
                if !scheduler_state.is_running.load(Ordering::Relaxed) {
                    Self::process_pending_runs(&app, &scheduler_state);
                }

                // Reload queue if automations changed (simple approach: reload every cycle)
                // A more efficient approach would use a channel, but this is fine for v1
                let s = AutomationScheduler {
                    queue: queue.clone(),
                };
                s.reload_queue(&app);
            }
        });
    }

    fn fire_automation(
        app: &AppHandle,
        automation_id: &str,
        scheduler_state: &AutomationSchedulerState,
    ) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();

        let automation = match db_automations::get_automation(&conn, automation_id) {
            Ok(Some(a)) => a,
            _ => return,
        };

        if !automation.enabled {
            return;
        }

        let now = Utc::now().to_rfc3339();
        let run_id = Uuid::new_v4().to_string();

        if scheduler_state.is_running.load(Ordering::Relaxed) {
            // Queue as pending
            let run = db_automations::StoredAutomationRun {
                id: run_id,
                automation_id: automation_id.to_string(),
                task_id: None,
                status: "pending".to_string(),
                has_findings: false,
                is_read: false,
                started_at: Some(now),
                completed_at: None,
            };
            let _ = db_automations::create_automation_run(&conn, &run);
            println!(
                "[AutomationScheduler] Queued pending run for '{}'",
                automation.name
            );
            return;
        }

        let task_id = format!("task_{}", Uuid::new_v4());

        if let Err(e) = crate::db::tasks::save_task(
            &conn,
            &crate::db::tasks::TaskInput {
                id: task_id.clone(),
                prompt: automation.prompt.clone(),
                status: "starting".to_string(),
                session_id: None,
                summary: None,
                messages: vec![],
                created_at: now.clone(),
                started_at: Some(now.clone()),
                completed_at: None,
            },
        ) {
            eprintln!("[AutomationScheduler] Failed to create task: {}", e);
            return;
        }

        let _ = crate::db::tasks::set_automation_run_id(&conn, &task_id, &run_id);
        let _ = crate::db::workspaces::assign_task_to_workspace(
            &conn,
            &automation.workspace_id,
            &task_id,
        );

        let run = db_automations::StoredAutomationRun {
            id: run_id.clone(),
            automation_id: automation_id.to_string(),
            task_id: Some(task_id.clone()),
            status: "running".to_string(),
            has_findings: false,
            is_read: false,
            started_at: Some(now),
            completed_at: None,
        };
        let _ = db_automations::create_automation_run(&conn, &run);
        scheduler_state.is_running.store(true, Ordering::Relaxed);

        let dispatch = match build_dispatch_context(&conn, &automation, task_id.clone()) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[AutomationScheduler] {}", e);
                scheduler_state.is_running.store(false, Ordering::Relaxed);
                return;
            }
        };

        drop(conn);

        spawn_start_task_dispatch(app, dispatch);

        let _ = app.emit(
            "automation:run_started",
            serde_json::json!({
                "automationId": automation_id,
                "runId": run_id,
                "taskId": task_id,
            }),
        );

        println!(
            "[AutomationScheduler] Fired automation '{}' (run: {}, task: {})",
            automation.name, run_id, task_id
        );
    }

    fn reschedule(
        app: &AppHandle,
        automation_id: &str,
        queue: &Arc<Mutex<BinaryHeap<ScheduledItem>>>,
    ) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
        if let Ok(Some(automation)) = db_automations::get_automation(&conn, automation_id) {
            if automation.enabled {
                let normalized = Self::normalize_cron(&automation.schedule_cron);
                if let Ok(schedule) = Schedule::from_str(&normalized) {
                    if let Some(next) = schedule.upcoming(Utc).next() {
                        let mut q = queue.lock().unwrap();
                        q.push(ScheduledItem {
                            next_fire: next,
                            automation_id: automation.id,
                        });
                    }
                }
            }
        }
    }

    fn process_pending_runs(app: &AppHandle, scheduler_state: &AutomationSchedulerState) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
        let pending = db_automations::get_pending_runs(&conn);

        let Some(run) = pending.first() else {
            return;
        };

        let automation = match db_automations::get_automation(&conn, &run.automation_id) {
            Ok(Some(a)) => a,
            _ => return,
        };

        let now = Utc::now().to_rfc3339();
        let task_id = format!("task_{}", Uuid::new_v4());

        if let Err(e) = crate::db::tasks::save_task(
            &conn,
            &crate::db::tasks::TaskInput {
                id: task_id.clone(),
                prompt: automation.prompt.clone(),
                status: "starting".to_string(),
                session_id: None,
                summary: None,
                messages: vec![],
                created_at: now.clone(),
                started_at: Some(now.clone()),
                completed_at: None,
            },
        ) {
            eprintln!(
                "[AutomationScheduler] Failed to create task for pending run: {}",
                e
            );
            return;
        }

        let _ = crate::db::tasks::set_automation_run_id(&conn, &task_id, &run.id);
        let _ = crate::db::workspaces::assign_task_to_workspace(
            &conn,
            &automation.workspace_id,
            &task_id,
        );

        let _ = db_automations::update_automation_run_status(&conn, &run.id, "running", false, None);
        let _ = db_automations::set_run_task_id(&conn, &run.id, &task_id);
        scheduler_state.is_running.store(true, Ordering::Relaxed);

        let dispatch = match build_dispatch_context(&conn, &automation, task_id.clone()) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[AutomationScheduler] {}", e);
                scheduler_state.is_running.store(false, Ordering::Relaxed);
                return;
            }
        };

        let run_id = run.id.clone();
        let automation_id = run.automation_id.clone();

        drop(conn);

        spawn_start_task_dispatch(app, dispatch);

        let _ = app.emit(
            "automation:run_started",
            serde_json::json!({
                "automationId": automation_id,
                "runId": run_id,
                "taskId": task_id,
            }),
        );

        println!(
            "[AutomationScheduler] Started pending run {} (task: {}) for automation {}",
            run_id, task_id, automation_id
        );
    }
}

/// Call this when an automation run completes to release the scheduler lock.
pub fn mark_automation_run_complete(
    app: &AppHandle,
    run_id: &str,
    has_findings: bool,
) {
    let db_state = app.state::<DbState>();
    let conn = db_state.conn.lock().unwrap();
    let now = Utc::now().to_rfc3339();

    let _ = db_automations::update_automation_run_status(
        &conn,
        run_id,
        "completed",
        has_findings,
        Some(&now),
    );

    let scheduler_state = app.state::<AutomationSchedulerState>();
    scheduler_state.is_running.store(false, Ordering::Relaxed);

    let _ = app.emit(
        "automation:run_completed",
        serde_json::json!({
            "runId": run_id,
            "hasFindings": has_findings,
            "status": "completed",
        }),
    );
}
