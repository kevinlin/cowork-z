use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::automation_scheduler::{AutomationSchedulerRegistry, AutomationSchedulerState};
use crate::db::{automations as db_automations, DbState};
use crate::lock_util::lock_or_recover;

#[tauri::command]
pub async fn validate_cron(cron_expression: String) -> Result<bool, String> {
    let normalized = crate::cron_schedule::normalize(&cron_expression);
    match normalized.parse::<cron::Schedule>() {
        Ok(_) => Ok(true),
        Err(e) => Err(format!("Invalid cron expression: {}", e)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutomationInput {
    pub workspace_id: String,
    pub name: String,
    pub prompt: String,
    pub schedule_cron: String,
    pub schedule_display: String,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutomationInput {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub schedule_cron: String,
    pub schedule_display: String,
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationChangedEvent {
    pub automation_id: String,
    pub action: String,
}

#[tauri::command]
pub async fn create_automation(
    input: CreateAutomationInput,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<db_automations::StoredAutomation, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let automation = db_automations::StoredAutomation {
        id: Uuid::new_v4().to_string(),
        workspace_id: input.workspace_id,
        name: input.name,
        prompt: input.prompt,
        schedule_cron: input.schedule_cron,
        schedule_display: input.schedule_display,
        provider_id: input.provider_id,
        model_id: input.model_id,
        enabled: true,
        created_at: now.clone(),
        updated_at: now,
    };

    {
        let conn = lock_or_recover(&db.conn, "db (automations)");
        db_automations::create_automation(&conn, &automation)?;
    }

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: automation.id.clone(),
            action: "created".to_string(),
        },
    );

    let registry = app.state::<AutomationSchedulerRegistry>();
    registry.on_changed(&app, &automation.id);

    Ok(automation)
}

#[tauri::command]
pub async fn update_automation(
    input: UpdateAutomationInput,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let automation_id = input.id.clone();

    {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = lock_or_recover(&db.conn, "db (automations)");

        let existing = db_automations::get_automation(&conn, &automation_id)?
            .ok_or_else(|| format!("Automation not found: {}", automation_id))?;

        let updated = db_automations::StoredAutomation {
            id: automation_id.clone(),
            workspace_id: existing.workspace_id,
            name: input.name,
            prompt: input.prompt,
            schedule_cron: input.schedule_cron,
            schedule_display: input.schedule_display,
            provider_id: input.provider_id,
            model_id: input.model_id,
            enabled: input.enabled,
            created_at: existing.created_at,
            updated_at: now,
        };

        db_automations::update_automation(&conn, &updated)?;
    }

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: automation_id.clone(),
            action: "updated".to_string(),
        },
    );

    let registry = app.state::<AutomationSchedulerRegistry>();
    registry.on_changed(&app, &automation_id);

    Ok(())
}

#[tauri::command]
pub async fn delete_automation(
    id: String,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let conn = lock_or_recover(&db.conn, "db (automations)");
        db_automations::delete_automation(&conn, &id)?;
    }

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: id.clone(),
            action: "deleted".to_string(),
        },
    );

    let registry = app.state::<AutomationSchedulerRegistry>();
    registry.stop_automation(&id);

    Ok(())
}

#[tauri::command]
pub async fn list_automations(
    workspace_id: Option<String>,
    db: State<'_, DbState>,
) -> Result<Vec<db_automations::StoredAutomation>, String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    Ok(db_automations::list_automations(
        &conn,
        workspace_id.as_deref(),
    ))
}

#[tauri::command]
pub async fn get_automation(
    id: String,
    db: State<'_, DbState>,
) -> Result<Option<db_automations::StoredAutomation>, String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    db_automations::get_automation(&conn, &id)
}

#[tauri::command]
pub async fn toggle_automation_enabled(
    id: String,
    enabled: bool,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let conn = lock_or_recover(&db.conn, "db (automations)");
        db_automations::toggle_automation_enabled(&conn, &id, enabled)?;
    }

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: id.clone(),
            action: "updated".to_string(),
        },
    );

    let registry = app.state::<AutomationSchedulerRegistry>();
    registry.on_changed(&app, &id);

    Ok(())
}

#[tauri::command]
pub async fn list_automation_runs(
    workspace_id: String,
    unread_only: bool,
    db: State<'_, DbState>,
) -> Result<Vec<db_automations::StoredAutomationRun>, String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    Ok(db_automations::list_automation_runs(
        &conn,
        &workspace_id,
        unread_only,
    ))
}

#[tauri::command]
pub async fn mark_run_read(run_id: String, db: State<'_, DbState>) -> Result<(), String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    db_automations::mark_run_read(&conn, &run_id)
}

#[tauri::command]
pub async fn mark_all_runs_read(
    workspace_id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    db_automations::mark_all_runs_read(&conn, &workspace_id)
}

#[tauri::command]
pub async fn get_automation_unread_count(
    workspace_id: String,
    db: State<'_, DbState>,
) -> Result<i32, String> {
    let conn = lock_or_recover(&db.conn, "db (automations)");
    Ok(db_automations::get_unread_count(&conn, &workspace_id))
}

#[tauri::command]
pub async fn run_automation_now(
    automation_id: String,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let scheduler_state = app.state::<AutomationSchedulerState>();

    // Manual runs cross the same dispatch seam as scheduled ones: claim the
    // sequential slot or decline. Early `?` returns drop the guard -> released.
    let Some(guard) = scheduler_state.slot.try_acquire() else {
        return Err("An automation run is already in progress".to_string());
    };

    let conn = lock_or_recover(&db.conn, "db (automations)");
    let automation = db_automations::get_automation(&conn, &automation_id)?
        .ok_or_else(|| format!("Automation not found: {}", automation_id))?;

    let run_id = Uuid::new_v4().to_string();

    crate::automation_scheduler::dispatch_automation_run(
        &app,
        &conn,
        &scheduler_state,
        &automation,
        &run_id,
        true,
        guard,
    );

    Ok(())
}

#[tauri::command]
pub async fn get_automation_next_runs(
    automation_ids: Vec<String>,
    registry: State<'_, AutomationSchedulerRegistry>,
    app: tauri::AppHandle,
) -> Result<HashMap<String, Option<String>>, String> {
    Ok(registry.get_next_runs(&automation_ids, &app))
}
