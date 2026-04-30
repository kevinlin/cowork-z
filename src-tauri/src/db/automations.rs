use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAutomation {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub prompt: String,
    pub schedule_cron: String,
    pub schedule_display: String,
    pub provider_id: String,
    pub model_id: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAutomationRun {
    pub id: String,
    pub automation_id: String,
    pub task_id: Option<String>,
    pub status: String,
    pub has_findings: bool,
    pub is_read: bool,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

pub fn create_automation(conn: &Connection, automation: &StoredAutomation) -> Result<(), String> {
    conn.execute(
        "INSERT INTO automations (id, workspace_id, name, prompt, schedule_cron, schedule_display, provider_id, model_id, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            automation.id,
            automation.workspace_id,
            automation.name,
            automation.prompt,
            automation.schedule_cron,
            automation.schedule_display,
            automation.provider_id,
            automation.model_id,
            automation.enabled,
            automation.created_at,
            automation.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to create automation: {}", e))?;
    Ok(())
}

pub fn update_automation(conn: &Connection, automation: &StoredAutomation) -> Result<(), String> {
    conn.execute(
        "UPDATE automations SET name = ?1, prompt = ?2, schedule_cron = ?3, schedule_display = ?4, provider_id = ?5, model_id = ?6, enabled = ?7, updated_at = ?8 WHERE id = ?9",
        params![
            automation.name,
            automation.prompt,
            automation.schedule_cron,
            automation.schedule_display,
            automation.provider_id,
            automation.model_id,
            automation.enabled,
            automation.updated_at,
            automation.id,
        ],
    )
    .map_err(|e| format!("Failed to update automation: {}", e))?;
    Ok(())
}

pub fn delete_automation(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM automations WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete automation: {}", e))?;
    Ok(())
}

pub fn get_automation(conn: &Connection, id: &str) -> Result<Option<StoredAutomation>, String> {
    let mut stmt = conn
        .prepare("SELECT id, workspace_id, name, prompt, schedule_cron, schedule_display, provider_id, model_id, enabled, created_at, updated_at FROM automations WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let result = stmt
        .query_row(params![id], |row| {
            Ok(StoredAutomation {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                prompt: row.get(3)?,
                schedule_cron: row.get(4)?,
                schedule_display: row.get(5)?,
                provider_id: row.get(6)?,
                model_id: row.get(7)?,
                enabled: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .ok();

    Ok(result)
}

pub fn list_automations(conn: &Connection, workspace_id: Option<&str>) -> Vec<StoredAutomation> {
    let query = match workspace_id {
        Some(_) => "SELECT id, workspace_id, name, prompt, schedule_cron, schedule_display, provider_id, model_id, enabled, created_at, updated_at FROM automations WHERE workspace_id = ?1 ORDER BY created_at DESC",
        None => "SELECT id, workspace_id, name, prompt, schedule_cron, schedule_display, provider_id, model_id, enabled, created_at, updated_at FROM automations ORDER BY created_at DESC",
    };

    let mut stmt = match conn.prepare(query) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<StoredAutomation> {
        Ok(StoredAutomation {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            prompt: row.get(3)?,
            schedule_cron: row.get(4)?,
            schedule_display: row.get(5)?,
            provider_id: row.get(6)?,
            model_id: row.get(7)?,
            enabled: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    };

    let rows = if let Some(ws_id) = workspace_id {
        stmt.query_map(params![ws_id], map_row)
    } else {
        stmt.query_map([], map_row)
    };

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn list_enabled_automations(conn: &Connection) -> Vec<StoredAutomation> {
    let mut stmt = match conn.prepare(
        "SELECT id, workspace_id, name, prompt, schedule_cron, schedule_display, provider_id, model_id, enabled, created_at, updated_at FROM automations WHERE enabled = 1 ORDER BY created_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map([], |row| {
        Ok(StoredAutomation {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            prompt: row.get(3)?,
            schedule_cron: row.get(4)?,
            schedule_display: row.get(5)?,
            provider_id: row.get(6)?,
            model_id: row.get(7)?,
            enabled: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn toggle_automation_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE automations SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled, now, id],
    )
    .map_err(|e| format!("Failed to toggle automation: {}", e))?;
    Ok(())
}

// --- Automation Runs ---

pub fn create_automation_run(conn: &Connection, run: &StoredAutomationRun) -> Result<(), String> {
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, task_id, status, has_findings, is_read, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            run.id,
            run.automation_id,
            run.task_id,
            run.status,
            run.has_findings,
            run.is_read,
            run.started_at,
            run.completed_at,
        ],
    )
    .map_err(|e| format!("Failed to create automation run: {}", e))?;
    Ok(())
}

pub fn update_automation_run_status(
    conn: &Connection,
    run_id: &str,
    status: &str,
    has_findings: bool,
    completed_at: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE automation_runs SET status = ?1, has_findings = ?2, completed_at = ?3 WHERE id = ?4",
        params![status, has_findings, completed_at, run_id],
    )
    .map_err(|e| format!("Failed to update automation run: {}", e))?;
    Ok(())
}

pub fn mark_run_read(conn: &Connection, run_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE automation_runs SET is_read = 1 WHERE id = ?1",
        params![run_id],
    )
    .map_err(|e| format!("Failed to mark run as read: {}", e))?;
    Ok(())
}

pub fn mark_all_runs_read(conn: &Connection, workspace_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE automation_runs SET is_read = 1 WHERE automation_id IN (SELECT id FROM automations WHERE workspace_id = ?1)",
        params![workspace_id],
    )
    .map_err(|e| format!("Failed to mark all runs read: {}", e))?;
    Ok(())
}

pub fn list_automation_runs(
    conn: &Connection,
    workspace_id: &str,
    unread_only: bool,
) -> Vec<StoredAutomationRun> {
    let query = if unread_only {
        "SELECT ar.id, ar.automation_id, ar.task_id, ar.status, ar.has_findings, ar.is_read, ar.started_at, ar.completed_at
         FROM automation_runs ar
         JOIN automations a ON ar.automation_id = a.id
         WHERE a.workspace_id = ?1 AND ar.is_read = 0 AND ar.has_findings = 1
         ORDER BY ar.started_at DESC"
    } else {
        "SELECT ar.id, ar.automation_id, ar.task_id, ar.status, ar.has_findings, ar.is_read, ar.started_at, ar.completed_at
         FROM automation_runs ar
         JOIN automations a ON ar.automation_id = a.id
         WHERE a.workspace_id = ?1
         ORDER BY ar.started_at DESC"
    };

    let mut stmt = match conn.prepare(query) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(StoredAutomationRun {
            id: row.get(0)?,
            automation_id: row.get(1)?,
            task_id: row.get(2)?,
            status: row.get(3)?,
            has_findings: row.get(4)?,
            is_read: row.get(5)?,
            started_at: row.get(6)?,
            completed_at: row.get(7)?,
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

pub fn get_unread_count(conn: &Connection, workspace_id: &str) -> i32 {
    conn.query_row(
        "SELECT COUNT(*) FROM automation_runs ar
         JOIN automations a ON ar.automation_id = a.id
         WHERE a.workspace_id = ?1 AND ar.is_read = 0 AND ar.has_findings = 1",
        params![workspace_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

pub fn get_running_run_by_task_id(conn: &Connection, task_id: &str) -> Option<StoredAutomationRun> {
    conn.query_row(
        "SELECT id, automation_id, task_id, status, has_findings, is_read, started_at, completed_at
         FROM automation_runs WHERE task_id = ?1 AND status = 'running'",
        params![task_id],
        |row| {
            Ok(StoredAutomationRun {
                id: row.get(0)?,
                automation_id: row.get(1)?,
                task_id: row.get(2)?,
                status: row.get(3)?,
                has_findings: row.get(4)?,
                is_read: row.get(5)?,
                started_at: row.get(6)?,
                completed_at: row.get(7)?,
            })
        },
    )
    .ok()
}

pub fn get_pending_runs(conn: &Connection) -> Vec<StoredAutomationRun> {
    let mut stmt = match conn.prepare(
        "SELECT id, automation_id, task_id, status, has_findings, is_read, started_at, completed_at
         FROM automation_runs WHERE status = 'pending' ORDER BY started_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map([], |row| {
        Ok(StoredAutomationRun {
            id: row.get(0)?,
            automation_id: row.get(1)?,
            task_id: row.get(2)?,
            status: row.get(3)?,
            has_findings: row.get(4)?,
            is_read: row.get(5)?,
            started_at: row.get(6)?,
            completed_at: row.get(7)?,
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}
