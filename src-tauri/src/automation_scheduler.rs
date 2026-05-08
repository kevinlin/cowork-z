use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use chrono::{DateTime, Local, Utc};
use cron::Schedule;
use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::automation_dispatch::{build_dispatch_context, spawn_start_task_dispatch};
use crate::db::{automations as db_automations, DbState};

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

    pub fn normalize_cron_public(expr: &str) -> String {
        Self::normalize_cron(expr)
    }

    pub fn get_next_runs(
        &self,
        automation_ids: &[String],
        app: &AppHandle,
    ) -> HashMap<String, Option<String>> {
        let map = self.next_runs.lock().unwrap();
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
            let conn = db_state.conn.lock().unwrap();
            for id in &missing {
                let next = match db_automations::get_automation(&conn, id) {
                    Ok(Some(a)) if a.enabled => Self::compute_next_fire(&a.schedule_cron)
                        .map(|t| t.to_rfc3339()),
                    _ => None,
                };
                result.insert(id.clone(), next);
            }
        }

        result
    }

    /// Normalize a cron expression for the `cron` crate which requires 6-7 fields
    /// (sec min hour dom month dow [year]). Standard 5-field Unix cron (min hour dom month dow)
    /// is converted by prepending "0" for seconds.
    ///
    /// The `cron` crate interprets numeric day-of-week as 1-indexed Sunday-first
    /// (1=Sun … 7=Sat), whereas standard Unix cron uses 0-indexed (0=Sun … 6=Sat).
    /// To avoid mismatches we replace the dow field with named abbreviations.
    fn normalize_cron(expr: &str) -> String {
        let fields: Vec<&str> = expr.split_whitespace().collect();
        if fields.len() == 5 {
            let dow_converted = Self::convert_dow_to_named(fields[4]);
            format!(
                "0 {} {} {} {} {}",
                fields[0], fields[1], fields[2], fields[3], dow_converted
            )
        } else {
            expr.to_string()
        }
    }

    fn convert_dow_to_named(field: &str) -> String {
        const NAMES: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        if field == "*" {
            return field.to_string();
        }

        let mut parts: Vec<String> = Vec::new();
        for segment in field.split(',') {
            if let Some(slash_pos) = segment.find('/') {
                let (base, step) = segment.split_at(slash_pos);
                let converted_base = Self::convert_dow_segment(base, &NAMES);
                parts.push(format!("{}{}", converted_base, step));
            } else {
                parts.push(Self::convert_dow_segment(segment, &NAMES));
            }
        }
        parts.join(",")
    }

    fn convert_dow_segment(segment: &str, names: &[&str; 7]) -> String {
        if segment == "*" {
            return segment.to_string();
        }
        if let Some((start_s, end_s)) = segment.split_once('-') {
            let start = Self::dow_to_name(start_s, names);
            let end = Self::dow_to_name(end_s, names);
            format!("{}-{}", start, end)
        } else {
            Self::dow_to_name(segment, names)
        }
    }

    fn dow_to_name(value: &str, names: &[&str; 7]) -> String {
        match value.parse::<u8>() {
            Ok(n) => names[(n % 7) as usize].to_string(),
            Err(_) => value.to_string(),
        }
    }

    fn compute_next_fire(cron_expr: &str) -> Option<DateTime<Utc>> {
        let normalized = Self::normalize_cron(cron_expr);
        let schedule = Schedule::from_str(&normalized).ok()?;
        schedule.upcoming(Local).next().map(|t| t.with_timezone(&Utc))
    }

    fn start_automation(
        &self,
        app: &AppHandle,
        automation: db_automations::StoredAutomation,
    ) {
        self.stop_automation(&automation.id);

        let next_fire = match Self::compute_next_fire(&automation.schedule_cron) {
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
            let mut map = self.next_runs.lock().unwrap();
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
                    let guard = lock.lock().unwrap();
                    let _ = cvar.wait_timeout(guard, wait_duration).unwrap();
                }

                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }

                if Utc::now() >= next {
                    Self::fire_automation_on_thread(&app_clone, &auto_id);

                    match Self::compute_next_fire(&cron_expr) {
                        Some(t) => {
                            next = t;
                            let mut map = next_runs.lock().unwrap();
                            map.insert(auto_id.clone(), Some(next.to_rfc3339()));
                        }
                        None => break,
                    }
                }
            }
        });

        let mut threads = self.threads.lock().unwrap();
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
            let mut threads = self.threads.lock().unwrap();
            threads.remove(automation_id)
        };

        if let Some(mut t) = thread {
            t.cancel.store(true, Ordering::Relaxed);
            let (lock, cvar) = &*t.wake;
            let mut signaled = lock.lock().unwrap();
            *signaled = true;
            cvar.notify_one();
            drop(signaled);

            if let Some(handle) = t.handle.take() {
                let _ = handle.join();
            }
        }

        let mut map = self.next_runs.lock().unwrap();
        map.remove(automation_id);
    }

    pub fn on_changed(&self, app: &AppHandle, automation_id: &str) {
        self.stop_automation(automation_id);

        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
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
            let threads = self.threads.lock().unwrap();
            threads.keys().cloned().collect()
        };
        for id in &ids {
            self.stop_automation(id);
        }

        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
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
        let conn = db_state.conn.lock().unwrap();

        let automation = match db_automations::get_automation(&conn, automation_id) {
            Ok(Some(a)) if a.enabled => a,
            _ => return,
        };

        let now = Utc::now().to_rfc3339();
        let run_id = Uuid::new_v4().to_string();

        // Atomically claim the dispatch slot. If another path (process_pending_runs
        // or a concurrent fire) already holds it, queue this fire as pending instead.
        let won_dispatch = scheduler_state
            .is_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok();

        if !won_dispatch {
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

        dispatch_automation_run(app, &conn, &scheduler_state, &automation, &run_id, true);
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

/// Call this when an automation run completes to release the scheduler lock
/// and process any pending runs.
pub fn mark_automation_run_complete(app: &AppHandle, run_id: &str, has_findings: bool) {
    let transition_result = {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        db_automations::try_complete_run_if_running(&conn, run_id, has_findings, &now)
    };

    let did_transition = match transition_result {
        Ok(t) => t,
        Err(e) => {
            // Row state is unknown; bail without releasing is_running so we don't
            // dispatch the next run on top of a still-'running' DB row.
            eprintln!("[AutomationScheduler] {}", e);
            return;
        }
    };

    if !did_transition {
        // Another caller (Rust sidecar event handler vs. frontend invoke) already
        // marked this run completed; do not double-release is_running or re-drain.
        return;
    }

    let scheduler_state = app.state::<AutomationSchedulerState>();
    scheduler_state.is_running.store(false, Ordering::SeqCst);

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
    if scheduler_state
        .is_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let db_state = app.state::<DbState>();
    let conn = db_state.conn.lock().unwrap();
    let pending = db_automations::get_pending_runs(&conn);

    let Some(run) = pending.first() else {
        scheduler_state.is_running.store(false, Ordering::SeqCst);
        return;
    };

    let automation = match db_automations::get_automation(&conn, &run.automation_id) {
        Ok(Some(a)) => a,
        _ => {
            scheduler_state.is_running.store(false, Ordering::SeqCst);
            return;
        }
    };

    dispatch_automation_run(app, &conn, &scheduler_state, &automation, &run.id, false);
}

/// Creates a task, links it to the run, builds dispatch context, and sends to sidecar.
/// When `create_run` is true, inserts a new run row; when false, updates the existing one.
fn dispatch_automation_run(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    scheduler_state: &AutomationSchedulerState,
    automation: &db_automations::StoredAutomation,
    run_id: &str,
    create_run: bool,
) {
    let now = Utc::now().to_rfc3339();
    let task_id = format!("task_{}", Uuid::new_v4());

    // Caller has already won the dispatch slot via compare_exchange on `is_running`.
    // We are responsible for releasing it on any failure path that aborts dispatch.
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
        scheduler_state.is_running.store(false, Ordering::SeqCst);
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
            scheduler_state.is_running.store(false, Ordering::SeqCst);
            return;
        }
    };

    let automation_id = automation.id.clone();

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
        "[AutomationScheduler] Dispatched run for '{}' (run: {}, task: {})",
        automation.name, run_id, task_id
    );
}
