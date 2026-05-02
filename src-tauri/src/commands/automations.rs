use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::automation_dispatch::{build_dispatch_context, dispatch_start_task};
use crate::automation_scheduler::AutomationSchedulerRegistry;
use crate::db::{self, automations as db_automations, DbState};

#[tauri::command]
pub async fn validate_cron(cron_expression: String) -> Result<bool, String> {
    let normalized = AutomationSchedulerRegistry::normalize_cron_public(&cron_expression);
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
        let conn = db.conn.lock().unwrap();
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
        let conn = db.conn.lock().unwrap();

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
        let conn = db.conn.lock().unwrap();
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
    let conn = db.conn.lock().unwrap();
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
    let conn = db.conn.lock().unwrap();
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
        let conn = db.conn.lock().unwrap();
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
    let conn = db.conn.lock().unwrap();
    Ok(db_automations::list_automation_runs(
        &conn,
        &workspace_id,
        unread_only,
    ))
}

#[tauri::command]
pub async fn mark_run_read(run_id: String, db: State<'_, DbState>) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    db_automations::mark_run_read(&conn, &run_id)
}

#[tauri::command]
pub async fn mark_all_runs_read(
    workspace_id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    db_automations::mark_all_runs_read(&conn, &workspace_id)
}

#[tauri::command]
pub async fn get_automation_unread_count(
    workspace_id: String,
    db: State<'_, DbState>,
) -> Result<i32, String> {
    let conn = db.conn.lock().unwrap();
    Ok(db_automations::get_unread_count(&conn, &workspace_id))
}

#[tauri::command]
pub async fn run_automation_now(
    automation_id: String,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (run_id, task_id, dispatch) = {
        let conn = db.conn.lock().unwrap();
        let automation = db_automations::get_automation(&conn, &automation_id)?
            .ok_or_else(|| format!("Automation not found: {}", automation_id))?;

        let now = chrono::Utc::now().to_rfc3339();
        let task_id = format!("task_{}", Uuid::new_v4());
        let run_id = Uuid::new_v4().to_string();

        db::tasks::save_task(
            &conn,
            &db::tasks::TaskInput {
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
        )?;

        let run = db_automations::StoredAutomationRun {
            id: run_id.clone(),
            automation_id: automation_id.clone(),
            task_id: Some(task_id.clone()),
            status: "running".to_string(),
            has_findings: false,
            is_read: false,
            started_at: Some(now),
            completed_at: None,
        };
        db_automations::create_automation_run(&conn, &run)?;

        let _ =
            db::workspaces::assign_task_to_workspace(&conn, &automation.workspace_id, &task_id);

        let dispatch = build_dispatch_context(&conn, &automation, task_id.clone())?;

        (run_id, task_id, dispatch)
    };

    dispatch_start_task(&app, dispatch).await?;

    let _ = app.emit(
        "automation:run_started",
        serde_json::json!({
            "automationId": automation_id,
            "runId": run_id,
            "taskId": task_id,
        }),
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
