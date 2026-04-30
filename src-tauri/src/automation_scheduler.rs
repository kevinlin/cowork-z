use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use cron::Schedule;
use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::db::{automations as db_automations, DbState};

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

        // Create run as running
        let run = db_automations::StoredAutomationRun {
            id: run_id.clone(),
            automation_id: automation_id.to_string(),
            task_id: None,
            status: "running".to_string(),
            has_findings: false,
            is_read: false,
            started_at: Some(now),
            completed_at: None,
        };
        let _ = db_automations::create_automation_run(&conn, &run);
        scheduler_state.is_running.store(true, Ordering::Relaxed);

        let _ = app.emit(
            "automation:run_started",
            serde_json::json!({
                "automationId": automation_id,
                "runId": run_id,
            }),
        );

        println!(
            "[AutomationScheduler] Fired automation '{}' (run: {})",
            automation.name, run_id
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

        if let Some(run) = pending.first() {
            // Start the oldest pending run
            let _ = db_automations::update_automation_run_status(
                &conn,
                &run.id,
                "running",
                false,
                None,
            );
            scheduler_state.is_running.store(true, Ordering::Relaxed);

            let _ = app.emit(
                "automation:run_started",
                serde_json::json!({
                    "automationId": run.automation_id,
                    "runId": run.id,
                }),
            );

            println!(
                "[AutomationScheduler] Started pending run {} for automation {}",
                run.id, run.automation_id
            );
        }
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
