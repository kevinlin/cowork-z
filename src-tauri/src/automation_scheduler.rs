use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::automation_dispatch::{build_dispatch_context, spawn_start_task_dispatch};
use crate::db::{automations as db_automations, DbState};
use crate::dispatch_slot::{DispatchSlot, SlotGuard};
use crate::lock_util::lock_or_recover;

struct ScheduledThread {
    cancel: Arc<AtomicBool>,
    wake: Arc<(Mutex<bool>, Condvar)>,
    handle: Option<std::thread::JoinHandle<()>>,
}

/// Per-automation scheduler registry. Each enabled automation gets its own
/// thread that sleeps until the next fire time, fires, then re-sleeps.
pub struct AutomationSchedulerRegistry {
    threads: Arc<Mutex<HashMap<String, ScheduledThread>>>,
    next_runs: Arc<Mutex<HashMap<String, Option<String>>>>,
}

impl AutomationSchedulerRegistry {
    pub fn new() -> Self {
        Self {
            threads: Arc::new(Mutex::new(HashMap::new())),
            next_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_next_runs(
        &self,
        automation_ids: &[String],
        app: &AppHandle,
    ) -> HashMap<String, Option<String>> {
        let map = lock_or_recover(&self.next_runs, "scheduler next_runs");
        let mut result: HashMap<String, Option<String>> = HashMap::new();
        let mut missing: Vec<String> = Vec::new();

        for id in automation_ids {
            match map.get(id) {
                Some(val) => {
                    result.insert(id.clone(), val.clone());
                }
                None => {
                    missing.push(id.clone());
                }
            }
        }
        drop(map);

        if !missing.is_empty() {
            let db_state = app.state::<DbState>();
            let conn = lock_or_recover(&db_state.conn, "db (scheduler next_runs)");
            for id in &missing {
                let next = match db_automations::get_automation(&conn, id) {
                    Ok(Some(a)) if a.enabled => crate::cron_schedule::next_fire(&a.schedule_cron)
                        .map(|t| t.to_rfc3339()),
                    _ => None,
                };
                result.insert(id.clone(), next);
            }
        }

        result
    }

    fn start_automation(
        &self,
        app: &AppHandle,
        automation: db_automations::StoredAutomation,
    ) {
        self.stop_automation(&automation.id);

        let next_fire = match crate::cron_schedule::next_fire(&automation.schedule_cron) {
            Some(t) => t,
            None => {
                eprintln!(
                    "[AutomationScheduler] Invalid cron for '{}': {}",
                    automation.name, automation.schedule_cron
                );
                return;
            }
        };

        {
            let mut map = lock_or_recover(&self.next_runs, "scheduler next_runs");
            map.insert(
                automation.id.clone(),
                Some(next_fire.to_rfc3339()),
            );
        }

        let cancel = Arc::new(AtomicBool::new(false));
        let wake = Arc::new((Mutex::new(false), Condvar::new()));

        let cancel_clone = cancel.clone();
        let wake_clone = wake.clone();
        let app_clone = app.clone();
        let auto_id = automation.id.clone();
        let cron_expr = automation.schedule_cron.clone();
        let next_runs = self.next_runs.clone();

        let handle = std::thread::spawn(move || {
            let mut next = next_fire;

            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }

                let now = Utc::now();
                let wait_duration = if next > now {
                    (next - now).to_std().unwrap_or(std::time::Duration::from_secs(1))
                } else {
                    std::time::Duration::ZERO
                };

                if !wait_duration.is_zero() {
                    let (lock, cvar) = &*wake_clone;
                    let guard = lock_or_recover(lock, "scheduler wake");
                    let _ = cvar
                        .wait_timeout(guard, wait_duration)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                }

                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }

                if Utc::now() >= next {
                    Self::fire_automation_on_thread(&app_clone, &auto_id);

                    match crate::cron_schedule::next_fire(&cron_expr) {
                        Some(t) => {
                            next = t;
                            let mut map = lock_or_recover(&next_runs, "scheduler next_runs");
                            map.insert(auto_id.clone(), Some(next.to_rfc3339()));
                        }
                        None => break,
                    }
                }
            }
        });

        let mut threads = lock_or_recover(&self.threads, "scheduler threads");
        threads.insert(
            automation.id.clone(),
            ScheduledThread {
                cancel,
                wake,
                handle: Some(handle),
            },
        );

        println!(
            "[AutomationScheduler] Started thread for '{}' (next: {})",
            automation.name,
            next_fire.to_rfc3339()
        );
    }

    pub fn stop_automation(&self, automation_id: &str) {
        let thread = {
            let mut threads = lock_or_recover(&self.threads, "scheduler threads");
            threads.remove(automation_id)
        };

        if let Some(mut t) = thread {
            t.cancel.store(true, Ordering::Relaxed);
            let (lock, cvar) = &*t.wake;
            let mut signaled = lock_or_recover(lock, "scheduler wake");
            *signaled = true;
            cvar.notify_one();
            drop(signaled);

            if let Some(handle) = t.handle.take() {
                let _ = handle.join();
            }
        }

        let mut map = lock_or_recover(&self.next_runs, "scheduler next_runs");
        map.remove(automation_id);
    }

    pub fn on_changed(&self, app: &AppHandle, automation_id: &str) {
        self.stop_automation(automation_id);

        let db_state = app.state::<DbState>();
        let conn = lock_or_recover(&db_state.conn, "db (scheduler reload)");
        match db_automations::get_automation(&conn, automation_id) {
            Ok(Some(a)) if a.enabled => {
                drop(conn);
                self.start_automation(app, a);
            }
            _ => {}
        }
    }

    pub fn reload_all(&self, app: &AppHandle) {
        let ids: Vec<String> = {
            let threads = lock_or_recover(&self.threads, "scheduler threads");
            threads.keys().cloned().collect()
        };
        for id in &ids {
            self.stop_automation(id);
        }

        let db_state = app.state::<DbState>();
        let conn = lock_or_recover(&db_state.conn, "db (scheduler reload_all)");
        let automations = db_automations::list_enabled_automations(&conn);
        drop(conn);

        let count = automations.len();
        for automation in automations {
            self.start_automation(app, automation);
        }

        println!(
            "[AutomationScheduler] Reloaded: started {} automation threads",
            count
        );
    }

    fn fire_automation_on_thread(app: &AppHandle, automation_id: &str) {
        let scheduler_state = app.state::<AutomationSchedulerState>();

        let db_state = app.state::<DbState>();
        let conn = lock_or_recover(&db_state.conn, "db (scheduler fire)");

        let automation = match db_automations::get_automation(&conn, automation_id) {
            Ok(Some(a)) if a.enabled => a,
            _ => return,
        };

        let now = Utc::now().to_rfc3339();
        let run_id = Uuid::new_v4().to_string();

        // Atomically claim the dispatch slot. If another path (process_pending_runs
        // or a concurrent fire) already holds it, queue this fire as pending instead.
        let Some(guard) = scheduler_state.slot.try_acquire() else {
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
        };

        dispatch_automation_run(app, &conn, &scheduler_state, &automation, &run_id, true, guard);
    }
}

impl Default for AutomationSchedulerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared state for tracking whether an automation run is currently executing.
/// This prevents concurrent automation runs (v1 sequential model).
pub struct AutomationSchedulerState {
    pub slot: DispatchSlot,
    /// The guard for the currently-dispatched run, parked until completion,
    /// keyed by run_id so only the owning run's completion releases it.
    active: Mutex<Option<(String, SlotGuard)>>,
}

impl AutomationSchedulerState {
    pub fn new() -> Self {
        Self {
            slot: DispatchSlot::new(),
            active: Mutex::new(None),
        }
    }

    /// Park the slot guard for a dispatched run until its completion.
    fn park(&self, run_id: &str, guard: SlotGuard) {
        let mut active = lock_or_recover(&self.active, "scheduler active guard");
        *active = Some((run_id.to_string(), guard));
    }

    /// Release the slot iff `run_id` matches the parked holder. A completion
    /// whose run_id doesn't match releases nothing — this is what prevents a
    /// foreign completion (e.g. a stale caller) from freeing a slot it never
    /// acquired.
    fn release(&self, run_id: &str) {
        let mut active = lock_or_recover(&self.active, "scheduler active guard");
        if matches!(active.as_ref(), Some((held, _)) if held == run_id) {
            *active = None; // drops the guard -> slot auto-released
        }
    }
}

impl Default for AutomationSchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Call this when an automation run completes to release the scheduler lock
/// and process any pending runs.
pub fn mark_automation_run_complete(app: &AppHandle, run_id: &str, has_findings: bool) {
    let transition_result = {
        let db_state = app.state::<DbState>();
        let conn = lock_or_recover(&db_state.conn, "db (run transition)");
        let now = Utc::now().to_rfc3339();
        db_automations::try_complete_run_if_running(&conn, run_id, has_findings, &now)
    };

    let did_transition = match transition_result {
        Ok(t) => t,
        Err(e) => {
            // Row state is unknown; bail without releasing the slot so we don't
            // dispatch the next run on top of a still-'running' DB row.
            eprintln!("[AutomationScheduler] {}", e);
            return;
        }
    };

    if !did_transition {
        // Another caller (Rust sidecar event handler vs. frontend invoke) already
        // marked this run completed; do not double-release the slot or re-drain.
        return;
    }

    let scheduler_state = app.state::<AutomationSchedulerState>();
    scheduler_state.release(run_id);

    let _ = app.emit(
        "automation:run_completed",
        serde_json::json!({
            "runId": run_id,
            "hasFindings": has_findings,
            "status": "completed",
        }),
    );

    process_pending_runs(app);
}

fn process_pending_runs(app: &AppHandle) {
    let scheduler_state = app.state::<AutomationSchedulerState>();

    // Atomically claim the dispatch slot. Prevents a race with the scheduler
    // thread also trying to fire at the same instant.
    let Some(guard) = scheduler_state.slot.try_acquire() else {
        return;
    };

    let db_state = app.state::<DbState>();
    let conn = lock_or_recover(&db_state.conn, "db (pending runs)");
    let pending = db_automations::get_pending_runs(&conn);

    // Early returns below drop `guard`, auto-releasing the slot.
    let Some(run) = pending.first() else {
        return;
    };

    let automation = match db_automations::get_automation(&conn, &run.automation_id) {
        Ok(Some(a)) => a,
        _ => return,
    };

    dispatch_automation_run(app, &conn, &scheduler_state, &automation, &run.id, false, guard);
}

/// Creates a task, links it to the run, builds dispatch context, and sends to sidecar.
/// When `create_run` is true, inserts a new run row; when false, updates the existing one.
///
/// The caller passes the `SlotGuard` it acquired. Early-error returns drop the
/// guard (auto-releasing the slot); on successful dispatch the guard is parked
/// in `AutomationSchedulerState` until the run completes.
pub(crate) fn dispatch_automation_run(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    scheduler_state: &AutomationSchedulerState,
    automation: &db_automations::StoredAutomation,
    run_id: &str,
    create_run: bool,
    guard: SlotGuard,
) {
    let now = Utc::now().to_rfc3339();
    let task_id = format!("task_{}", Uuid::new_v4());

    if let Err(e) = crate::db::tasks::save_task(
        conn,
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

    let _ = crate::db::tasks::set_automation_run_id(conn, &task_id, run_id);
    let _ = crate::db::workspaces::assign_task_to_workspace(
        conn,
        &automation.workspace_id,
        &task_id,
    );

    if create_run {
        let run = db_automations::StoredAutomationRun {
            id: run_id.to_string(),
            automation_id: automation.id.clone(),
            task_id: Some(task_id.clone()),
            status: "running".to_string(),
            has_findings: false,
            is_read: false,
            started_at: Some(now),
            completed_at: None,
        };
        let _ = db_automations::create_automation_run(conn, &run);
    } else {
        let _ =
            db_automations::update_automation_run_status(conn, run_id, "running", false, None);
        let _ = db_automations::set_run_task_id(conn, run_id, &task_id);
    }

    let dispatch = match build_dispatch_context(conn, automation, task_id.clone()) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[AutomationScheduler] {}", e);
            return;
        }
    };

    let automation_id = automation.id.clone();

    spawn_start_task_dispatch(app, dispatch);

    // Dispatch succeeded — park the guard until the run's completion releases it.
    scheduler_state.park(run_id, guard);

    let _ = app.emit(
        "automation:run_started",
        serde_json::json!({
            "automationId": automation_id,
            "runId": run_id,
            "taskId": task_id,
        }),
    );

    println!(
        "[AutomationScheduler] Dispatched run for '{}' (run: {}, task: {})",
        automation.name, run_id, task_id
    );
}
