# Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduled, recurring AI tasks (Automations) with a Home tab for CRUD, a sidebar tab for triage, and a Rust-based cron scheduler that fires tasks through the existing sidecar pipeline.

**Architecture:** Rust scheduler (priority queue + 30s tick loop) triggers tasks via the existing `start_task` command flow. New SQLite tables store automation definitions and run history. Frontend adds a third Home tab and a third sidebar tab. Sequential execution — one run at a time, queued when sidecar is busy.

**Tech Stack:** Rust (Tauri commands, `cron` crate, `rusqlite`), TypeScript/React (Zustand store, new components), existing sidecar IPC unchanged.

---

## Implementation Notes (Post-Implementation Corrections)

The following corrections were applied during implementation and differ from the original plan code:

1. **Cron format normalization:** The `cron` crate (v0.12) requires 6-7 field expressions (`sec min hour dom month dow [year]`). The frontend stores standard 5-field Unix cron (e.g., `0 9 * * *`). The scheduler's `normalize_cron()` prepends `"0 "` to 5-field expressions before parsing. All `Schedule::from_str` / `.parse::<Schedule>()` calls must use the normalized form.

2. **`run_automation_now` directly dispatches to sidecar:** The original plan had `run_automation_now` creating a pending run for the scheduler to pick up. This introduced a 30s delay and relied on the scheduler tick. The corrected implementation directly dispatches `StartTask` to the sidecar (same as the `start_task` command), providing immediate execution.

3. **FK ordering in `run_automation_now`:** The `automation_runs.task_id` column has a foreign key to `tasks(id)`. The task record must be created **before** the automation run record. The original plan code had these reversed.

4. **`model_id` is already provider-qualified:** The `automation.model_id` field stores the full model identifier (e.g., `github-copilot/claude-sonnet-4.6`). When passing to the sidecar, use it directly — do NOT prepend `provider_id/`.

---

## File Structure

### Rust (backend)

| File | Responsibility |
|------|----------------|
| `src-tauri/src/db/automations.rs` | CRUD for `automations` and `automation_runs` tables |
| `src-tauri/src/db/migrations.rs` | Migration v7: new tables + `tasks.automation_run_id` column |
| `src-tauri/src/commands/automations.rs` | Tauri command handlers for automation CRUD + run management |
| `src-tauri/src/automation_scheduler.rs` | Scheduler struct: priority queue, tick loop, run execution |
| `src-tauri/src/commands/mod.rs` | Register `automations` module |
| `src-tauri/src/lib.rs` | Register commands, spawn scheduler at startup |
| `src-tauri/Cargo.toml` | Add `cron` dependency |

### TypeScript (frontend)

| File | Responsibility |
|------|----------------|
| `src/shared/types/automation.ts` | TypeScript types for automations and runs |
| `src/stores/automationStore.ts` | Zustand store: automation list, runs, unread count, CRUD |
| `src/lib/tauri-api.ts` | New invoke wrappers + event listeners for automations |
| `src/components/landing/AutomationsList.tsx` | Home tab list view |
| `src/components/landing/AutomationCard.tsx` | Individual automation card |
| `src/components/landing/AutomationForm.tsx` | Inline create/edit form |
| `src/components/sidebar/AutomationRunsPanel.tsx` | Sidebar tab content |
| `src/components/sidebar/AutomationRunItem.tsx` | Individual run item |
| `src/pages/Home.tsx` | Add `'automations'` tab option |
| `src/components/layout/Sidebar.tsx` | Add `'automations'` tab between Sessions and Files |

---

## Task 1: Database Schema (Migration v7)

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/automations.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Add migration v7 to migrations.rs**

In `src-tauri/src/db/migrations.rs`, bump `CURRENT_VERSION` to 7 and add the migration function:

```rust
const CURRENT_VERSION: i32 = 7;
```

Add the migration function before `run_migrations`:

```rust
/// Migration v7: Automations tables + tasks.automation_run_id
fn migrate_v7(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v7 (automations)");

    conn.execute_batch(
        "CREATE TABLE automations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL,
            schedule_cron TEXT NOT NULL,
            schedule_display TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_automations_workspace_id ON automations(workspace_id);

        CREATE TABLE automation_runs (
            id TEXT PRIMARY KEY,
            automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
            task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            has_findings INTEGER NOT NULL DEFAULT 0,
            is_read INTEGER NOT NULL DEFAULT 0,
            started_at TEXT,
            completed_at TEXT
        );

        CREATE INDEX idx_automation_runs_automation_id ON automation_runs(automation_id);
        CREATE INDEX idx_automation_runs_status ON automation_runs(status);

        ALTER TABLE tasks ADD COLUMN automation_run_id TEXT REFERENCES automation_runs(id) ON DELETE SET NULL;",
    )
    .map_err(|e| format!("Migration v7 failed: {}", e))?;

    set_stored_version(conn, 7)?;
    println!("[Migrations] Migration v7 complete");
    Ok(())
}
```

- [ ] **Step 2: Register migration v7 in run_migrations**

Add to the `run_migrations` function, after the `stored_version < 6` block:

```rust
    if stored_version < 7 {
        migrate_v7(conn)?;
    }
```

- [ ] **Step 3: Create db/automations.rs**

Create `src-tauri/src/db/automations.rs`:

```rust
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

    let rows = if let Some(ws_id) = workspace_id {
        stmt.query_map(params![ws_id], |row| {
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
    } else {
        stmt.query_map([], |row| {
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

pub fn toggle_automation_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
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
```

- [ ] **Step 4: Register automations module in db/mod.rs**

Add `pub mod automations;` to `src-tauri/src/db/mod.rs`.

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/automations.rs src-tauri/src/db/migrations.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add automations schema (migration v7) and CRUD repository"
```

---

## Task 2: Tauri Commands for Automations

**Files:**
- Create: `src-tauri/src/commands/automations.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create commands/automations.rs**

Create `src-tauri/src/commands/automations.rs`:

```rust
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use uuid::Uuid;

use crate::db::{automations as db_automations, DbState};

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

    let conn = db.conn.lock().unwrap();
    db_automations::create_automation(&conn, &automation)?;

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: automation.id.clone(),
            action: "created".to_string(),
        },
    );

    Ok(automation)
}

#[tauri::command]
pub async fn update_automation(
    input: UpdateAutomationInput,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.conn.lock().unwrap();

    let existing = db_automations::get_automation(&conn, &input.id)?
        .ok_or_else(|| format!("Automation not found: {}", input.id))?;

    let updated = db_automations::StoredAutomation {
        id: input.id.clone(),
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

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: input.id,
            action: "updated".to_string(),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn delete_automation(
    id: String,
    db: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    db_automations::delete_automation(&conn, &id)?;

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: id,
            action: "deleted".to_string(),
        },
    );

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
    let conn = db.conn.lock().unwrap();
    db_automations::toggle_automation_enabled(&conn, &id, enabled)?;

    let _ = app.emit(
        "automation:changed",
        AutomationChangedEvent {
            automation_id: id,
            action: "updated".to_string(),
        },
    );

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
    sidecar_state: State<'_, SidecarState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // This command directly dispatches a task to the sidecar (bypasses the scheduler queue).
    // It resolves the automation's workspace, permissions, model, and API keys,
    // then sends StartTask — mirroring the start_task command flow.
    //
    // Important implementation notes:
    // - Create the task record BEFORE the automation_run (FK constraint: automation_runs.task_id → tasks.id)
    // - Use automation.model_id directly as the sidecar model_id (it's already provider-qualified, e.g. "github-copilot/claude-sonnet-4.6")
    // - Do NOT prepend provider_id — that would produce an invalid double-prefix

    let conn = db.conn.lock().unwrap();
    let automation = db_automations::get_automation(&conn, &automation_id)?
        .ok_or_else(|| format!("Automation not found: {}", automation_id))?;

    let now = chrono::Utc::now().to_rfc3339();
    let task_id = format!("task_{}", Uuid::new_v4());
    let run_id = Uuid::new_v4().to_string();

    // 1. Create task first (FK target)
    db::tasks::save_task(&conn, &db::tasks::TaskInput {
        id: task_id.clone(),
        prompt: automation.prompt.clone(),
        status: "starting".to_string(),
        session_id: None,
        summary: None,
        messages: vec![],
        created_at: now.clone(),
        started_at: Some(now.clone()),
        completed_at: None,
    })?;

    // 2. Create automation run linked to task
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

    // 3. Resolve workspace context, permissions, API keys, model
    let _ = db::workspaces::assign_task_to_workspace(&conn, &automation.workspace_id, &task_id);
    let working_directory = db::workspaces::get_workspace(&conn, &automation.workspace_id)
        .map(|w| w.folder_path);
    // ... (build folder_permissions, api_keys, custom_prompt, mcp_servers same as start_task)

    // 4. Dispatch to sidecar
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }
    manager.send_command(sidecar::SidecarCommand::StartTask {
        task_id: task_id.clone(),
        payload: sidecar::StartTaskPayload {
            task_id: task_id.clone(),
            prompt: automation.prompt.clone(),
            api_keys: Some(api_keys),
            working_directory,
            model_id: Some(automation.model_id.clone()), // Already provider-qualified
            folder_permissions: sidecar_perms,
            custom_prompt,
            mcp_servers,
            skip_config: None,
            arena_id: None,
        },
    }).await?;

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
```

- [ ] **Step 2: Register in commands/mod.rs**

Add `pub mod automations;` to `src-tauri/src/commands/mod.rs`.

- [ ] **Step 3: Register commands in lib.rs invoke_handler**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` macro after the Skills block:

```rust
            // Automations
            commands::automations::create_automation,
            commands::automations::update_automation,
            commands::automations::delete_automation,
            commands::automations::list_automations,
            commands::automations::get_automation,
            commands::automations::toggle_automation_enabled,
            commands::automations::list_automation_runs,
            commands::automations::mark_run_read,
            commands::automations::mark_all_runs_read,
            commands::automations::get_automation_unread_count,
            commands::automations::run_automation_now,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/automations.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): add Tauri command handlers for automations CRUD"
```

---

## Task 3: Automation Scheduler (Rust)

**Files:**
- Create: `src-tauri/src/automation_scheduler.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add cron dependency to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
# Cron scheduling
cron = "0.12"
```

- [ ] **Step 2: Create automation_scheduler.rs**

Create `src-tauri/src/automation_scheduler.rs`:

```rust
use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use cron::Schedule;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::db::{automations as db_automations, DbState};
use crate::sidecar::SidecarState;

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
        Reverse(self.next_fire).cmp(&Reverse(other.next_fire))
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

    pub fn reload(&self, app: &AppHandle) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();
        let automations = db_automations::list_enabled_automations(&conn);

        let mut queue = self.queue.lock().unwrap();
        queue.clear();

        let now = Utc::now();
        for automation in automations {
            let normalized = Self::normalize_cron(&automation.schedule_cron);
            if let Ok(schedule) = normalized.parse::<Schedule>() {
                if let Some(next) = schedule.upcoming(Utc).next() {
                    if next > now {
                        queue.push(ScheduledItem {
                            next_fire: next,
                            automation_id: automation.id,
                        });
                    }
                }
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
            // Initial load after a short delay to let DB initialize
            std::thread::sleep(std::time::Duration::from_secs(5));

            let scheduler = AutomationScheduler { queue: queue.clone() };
            scheduler.reload(&app);

            // Listen for automation:changed events to reload
            let app_for_listener = app.clone();
            let queue_for_listener = queue.clone();
            app.listen("automation:changed", move |_| {
                let sched = AutomationScheduler { queue: queue_for_listener.clone() };
                sched.reload(&app_for_listener);
            });

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

                for automation_id in due_automations {
                    Self::fire_automation(&app, &automation_id);

                    // Re-schedule for next occurrence
                    let db_state = app.state::<DbState>();
                    let conn = db_state.conn.lock().unwrap();
                    if let Ok(Some(automation)) = db_automations::get_automation(&conn, &automation_id) {
                        if automation.enabled {
                            let normalized = Self::normalize_cron(&automation.schedule_cron);
                            if let Ok(schedule) = normalized.parse::<Schedule>() {
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
            }
        });
    }

    fn fire_automation(app: &AppHandle, automation_id: &str) {
        let db_state = app.state::<DbState>();
        let conn = db_state.conn.lock().unwrap();

        let automation = match db_automations::get_automation(&conn, automation_id) {
            Ok(Some(a)) => a,
            _ => return,
        };

        if !automation.enabled {
            return;
        }

        // Check if sidecar is busy
        let sidecar_state = app.state::<SidecarState>();
        if sidecar_state.is_busy() {
            // Queue as pending run
            let run = db_automations::StoredAutomationRun {
                id: Uuid::new_v4().to_string(),
                automation_id: automation_id.to_string(),
                task_id: None,
                status: "pending".to_string(),
                has_findings: false,
                is_read: false,
                started_at: Some(Utc::now().to_rfc3339()),
                completed_at: None,
            };
            let _ = db_automations::create_automation_run(&conn, &run);
            println!(
                "[AutomationScheduler] Sidecar busy, queued run {} for automation {}",
                run.id, automation_id
            );
            return;
        }

        // Create run and start task
        let run_id = Uuid::new_v4().to_string();
        let run = db_automations::StoredAutomationRun {
            id: run_id.clone(),
            automation_id: automation_id.to_string(),
            task_id: None,
            status: "running".to_string(),
            has_findings: false,
            is_read: false,
            started_at: Some(Utc::now().to_rfc3339()),
            completed_at: None,
        };
        let _ = db_automations::create_automation_run(&conn, &run);

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
}
```

- [ ] **Step 3: Register scheduler module and spawn at startup in lib.rs**

In `src-tauri/src/lib.rs`, add `mod automation_scheduler;` to the module declarations, and spawn the scheduler inside the `setup` closure (after sidecar state init):

```rust
mod automation_scheduler;
```

Inside `setup`:

```rust
            // Initialize and start automation scheduler
            let scheduler = automation_scheduler::AutomationScheduler::new();
            scheduler.start(app.handle().clone());
```

- [ ] **Step 4: Add is_busy method to SidecarState**

In `src-tauri/src/sidecar.rs`, add a public method to `SidecarState`:

```rust
    pub fn is_busy(&self) -> bool {
        // Returns true if there's an active task running
        // Implementation depends on existing SidecarState internals
        self.active_task_id.lock().unwrap().is_some()
    }
```

(Exact implementation depends on how `SidecarState` tracks active tasks — inspect the existing struct.)

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/automation_scheduler.rs src-tauri/src/lib.rs src-tauri/src/sidecar.rs src-tauri/Cargo.toml
git commit -m "feat(scheduler): add cron-based automation scheduler with priority queue"
```

---

## Task 4: Frontend Types and Tauri API

**Files:**
- Create: `src/shared/types/automation.ts`
- Modify: `src/shared/types/index.ts` (or wherever shared types are re-exported)
- Modify: `src/lib/tauri-api.ts`

- [ ] **Step 1: Create shared types**

Create `src/shared/types/automation.ts`:

```typescript
export interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  taskId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  hasFindings: boolean;
  isRead: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateAutomationInput {
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
}

export interface UpdateAutomationInput {
  id: string;
  name: string;
  prompt: string;
  scheduleCron: string;
  scheduleDisplay: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
}
```

- [ ] **Step 2: Export types from shared index**

Add to `src/shared/types/index.ts` (or the barrel file):

```typescript
export type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './automation';
```

- [ ] **Step 3: Add Tauri API functions**

Add to `src/lib/tauri-api.ts` in a new `// Automations` section:

```typescript
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@/shared';

// ============================================================================
// Automations
// ============================================================================

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  return invoke<Automation>('create_automation', { input });
}

export async function updateAutomation(input: UpdateAutomationInput): Promise<void> {
  return invoke<void>('update_automation', { input });
}

export async function deleteAutomation(id: string): Promise<void> {
  return invoke<void>('delete_automation', { id });
}

export async function listAutomations(workspaceId?: string): Promise<Automation[]> {
  return invoke<Automation[]>('list_automations', { workspaceId: workspaceId ?? null });
}

export async function getAutomation(id: string): Promise<Automation | null> {
  return invoke<Automation | null>('get_automation', { id });
}

export async function toggleAutomationEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>('toggle_automation_enabled', { id, enabled });
}

export async function listAutomationRuns(workspaceId: string, unreadOnly: boolean): Promise<AutomationRun[]> {
  return invoke<AutomationRun[]>('list_automation_runs', { workspaceId, unreadOnly });
}

export async function markRunRead(runId: string): Promise<void> {
  return invoke<void>('mark_run_read', { runId });
}

export async function markAllRunsRead(workspaceId: string): Promise<void> {
  return invoke<void>('mark_all_runs_read', { workspaceId });
}

export async function getAutomationUnreadCount(workspaceId: string): Promise<number> {
  return invoke<number>('get_automation_unread_count', { workspaceId });
}

export async function runAutomationNow(automationId: string): Promise<void> {
  return invoke<void>('run_automation_now', { automationId });
}

// Automation events
export function onAutomationRunStarted(callback: (event: { automationId: string; runId: string }) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  listen<{ automationId: string; runId: string }>('automation:run_started', (event) => {
    callback(event.payload);
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}

export function onAutomationRunCompleted(callback: (event: { runId: string; hasFindings: boolean; status: string }) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  listen<{ runId: string; hasFindings: boolean; status: string }>('automation:run_completed', (event) => {
    callback(event.payload);
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}

export function onAutomationChanged(callback: (event: { automationId: string; action: string }) => void): () => void {
  let unlisten: UnlistenFn | null = null;
  listen<{ automationId: string; action: string }>('automation:changed', (event) => {
    callback(event.payload);
  }).then((fn) => { unlisten = fn; });
  return () => { unlisten?.(); };
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/automation.ts src/shared/types/index.ts src/lib/tauri-api.ts
git commit -m "feat(api): add automation types and Tauri API bridge functions"
```

---

## Task 5: Automation Zustand Store

**Files:**
- Create: `src/stores/automationStore.ts`

- [ ] **Step 1: Create automationStore.ts**

Create `src/stores/automationStore.ts`:

```typescript
import { create } from 'zustand';
import * as api from '@/lib/tauri-api';
import type { Automation, AutomationRun, CreateAutomationInput, UpdateAutomationInput } from '@/shared';

interface AutomationState {
  automations: Automation[];
  runs: AutomationRun[];
  unreadCount: number;
  isLoading: boolean;

  loadAutomations: (workspaceId: string) => Promise<void>;
  loadRuns: (workspaceId: string, unreadOnly?: boolean) => Promise<void>;
  loadUnreadCount: (workspaceId: string) => Promise<void>;
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>;
  updateAutomation: (input: UpdateAutomationInput) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (automationId: string) => Promise<void>;
  markRunRead: (runId: string) => Promise<void>;
  markAllRead: (workspaceId: string) => Promise<void>;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  automations: [],
  runs: [],
  unreadCount: 0,
  isLoading: false,

  loadAutomations: async (workspaceId: string) => {
    set({ isLoading: true });
    const automations = await api.listAutomations(workspaceId);
    set({ automations, isLoading: false });
  },

  loadRuns: async (workspaceId: string, unreadOnly = false) => {
    const runs = await api.listAutomationRuns(workspaceId, unreadOnly);
    set({ runs });
  },

  loadUnreadCount: async (workspaceId: string) => {
    const unreadCount = await api.getAutomationUnreadCount(workspaceId);
    set({ unreadCount });
  },

  createAutomation: async (input: CreateAutomationInput) => {
    const automation = await api.createAutomation(input);
    set((state) => ({ automations: [automation, ...state.automations] }));
    return automation;
  },

  updateAutomation: async (input: UpdateAutomationInput) => {
    await api.updateAutomation(input);
    set((state) => ({
      automations: state.automations.map((a) =>
        a.id === input.id ? { ...a, ...input, updatedAt: new Date().toISOString() } : a
      ),
    }));
  },

  deleteAutomation: async (id: string) => {
    await api.deleteAutomation(id);
    set((state) => ({
      automations: state.automations.filter((a) => a.id !== id),
    }));
  },

  toggleEnabled: async (id: string, enabled: boolean) => {
    await api.toggleAutomationEnabled(id, enabled);
    set((state) => ({
      automations: state.automations.map((a) =>
        a.id === id ? { ...a, enabled } : a
      ),
    }));
  },

  runNow: async (automationId: string) => {
    await api.runAutomationNow(automationId);
  },

  markRunRead: async (runId: string) => {
    await api.markRunRead(runId);
    set((state) => ({
      runs: state.runs.map((r) => (r.id === runId ? { ...r, isRead: true } : r)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllRead: async (workspaceId: string) => {
    await api.markAllRunsRead(workspaceId);
    set((state) => ({
      runs: state.runs.map((r) => ({ ...r, isRead: true })),
      unreadCount: 0,
    }));
  },
}));
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

- [ ] **Step 3: Commit**

```bash
git add src/stores/automationStore.ts
git commit -m "feat(store): add Zustand automation store with CRUD and triage"
```

---

## Task 6: Home Page — Automations Tab

**Files:**
- Create: `src/components/landing/AutomationsList.tsx`
- Create: `src/components/landing/AutomationCard.tsx`
- Create: `src/components/landing/AutomationForm.tsx`
- Modify: `src/pages/Home.tsx`

- [ ] **Step 1: Create AutomationCard.tsx**

Create `src/components/landing/AutomationCard.tsx`:

```typescript
import { Clock, MoreVertical, Pause, Play, Trash2, Zap } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Automation } from '@/shared';

interface AutomationCardProps {
  automation: Automation;
  onEdit: (automation: Automation) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function AutomationCard({ automation, onEdit, onToggleEnabled, onRunNow, onDelete }: AutomationCardProps) {
  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/50"
      onClick={() => onEdit(automation)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{automation.name}</span>
          {automation.enabled ? (
            <span className="flex items-center gap-1 text-green-500 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Disabled</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <Clock className="h-3 w-3" />
          <span>{automation.scheduleDisplay}</span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
            type="button"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRunNow(automation.id)}>
            <Zap className="mr-2 h-4 w-4" />
            Run Now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onToggleEnabled(automation.id, !automation.enabled)}>
            {automation.enabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {automation.enabled ? 'Disable' : 'Enable'}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(automation.id)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [x] **Step 2: Create AutomationForm.tsx**

Create `src/components/landing/AutomationForm.tsx`.

**Model selection approach:** Instead of a plain `<select>` dropdown, the form uses a button that displays the current model name and opens a **model picker dialog** (similar to `ArenaModelPickerDialog`). Key behaviors:

1. **Default to global model:** On mount (for new automations), reads `getActiveProvider(settings)` from `useProviderSettings()` to pre-populate `providerId`, `modelId`, and `modelDisplayName` with the globally configured provider/model.
2. **Button trigger:** A styled button shows the current model display name (or "Select model..." placeholder) with a `ChevronDown` icon. Clicking opens the picker dialog.
3. **Picker dialog (`AutomationModelPickerDialog`):** A local component that reuses `ProviderGrid` and `ProviderSettingsPanel` (same as `ArenaModelPickerDialog`) inside a `Dialog`. Title is "Select Model". On "Select Model" click, extracts `providerId` from the full model ID and calls back with `(fullModelId, displayName)`.
4. **Edit mode:** When editing an existing automation, resolves the display name from the stored `providerId`/`modelId` against `settings.connectedProviders`.

Dependencies: `useProviderSettings`, `ProviderGrid`, `ProviderSettingsPanel`, `Dialog` components, `getActiveProvider`, `isProviderReady` from `@/shared`, `AnimatePresence`/`motion` from framer-motion, `ChevronDown` from lucide-react.

- [ ] **Step 3: Create AutomationsList.tsx**

Create `src/components/landing/AutomationsList.tsx`:

```typescript
import { Plus, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Automation, CreateAutomationInput, UpdateAutomationInput } from '@/shared';
import { useAutomationStore } from '@/stores/automationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import AutomationCard from './AutomationCard';
import AutomationForm from './AutomationForm';

export default function AutomationsList() {
  const [showForm, setShowForm] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);

  const { automations, isLoading, loadAutomations, createAutomation, updateAutomation, deleteAutomation, toggleEnabled, runNow } = useAutomationStore();
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadAutomations(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, loadAutomations]);

  const handleSave = useCallback(
    async (input: CreateAutomationInput | UpdateAutomationInput) => {
      if ('id' in input) {
        await updateAutomation(input);
      } else {
        await createAutomation(input);
      }
      setShowForm(false);
      setEditingAutomation(null);
    },
    [createAutomation, updateAutomation]
  );

  const handleEdit = useCallback((automation: Automation) => {
    setEditingAutomation(automation);
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingAutomation(null);
  }, []);

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
        Select a workspace to manage automations
      </div>
    );
  }

  if (showForm) {
    return (
      <AutomationForm
        editing={editingAutomation}
        onCancel={handleCancel}
        onSave={handleSave}
        workspaceId={activeWorkspace.id}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">
          {automations.length} automation{automations.length !== 1 ? 's' : ''}
        </span>
        <button
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
          onClick={() => setShowForm(true)}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      {automations.length === 0 && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Zap className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium text-foreground text-sm">No automations yet</p>
            <p className="mt-1 text-muted-foreground text-xs">Create your first automation to run tasks on a schedule</p>
          </div>
          <button
            className="mt-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
            onClick={() => setShowForm(true)}
            type="button"
          >
            Create your first automation
          </button>
        </div>
      )}

      {automations.map((automation) => (
        <AutomationCard
          automation={automation}
          key={automation.id}
          onDelete={deleteAutomation}
          onEdit={handleEdit}
          onRunNow={runNow}
          onToggleEnabled={toggleEnabled}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add Automations tab to Home.tsx**

In `src/pages/Home.tsx`, change the `HomeTab` type and add the tab button + content:

Change:
```typescript
type HomeTab = 'packs' | 'skills';
```
To:
```typescript
type HomeTab = 'packs' | 'skills' | 'automations';
```

Add the import:
```typescript
import AutomationsList from '../components/landing/AutomationsList';
```

Add the third tab button after the "Skills Catalog" button (inside the tab bar `<div>`):

```typescript
                <button
                  className={`flex-1 px-4 py-2.5 font-medium text-sm transition-colors ${
                    activeTab === 'automations'
                      ? 'border-primary border-b-2 text-foreground'
                      : 'border-transparent border-b-2 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab('automations')}
                  type="button"
                >
                  Automations
                </button>
```

Change the tab content rendering:

```typescript
              {activeTab === 'packs' && <StarterPacks onPromptSeed={setPrompt} />}
              {activeTab === 'skills' && <SkillsCatalog />}
              {activeTab === 'automations' && <AutomationsList />}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/AutomationCard.tsx src/components/landing/AutomationForm.tsx src/components/landing/AutomationsList.tsx src/pages/Home.tsx
git commit -m "feat(ui): add Automations tab to Home page with list, card, and form"
```

---

## Task 7: Sidebar — Automations Tab

**Files:**
- Create: `src/components/sidebar/AutomationRunItem.tsx`
- Create: `src/components/sidebar/AutomationRunsPanel.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create AutomationRunItem.tsx**

Create `src/components/sidebar/AutomationRunItem.tsx`:

```typescript
import type { AutomationRun } from '@/shared';

interface AutomationRunItemProps {
  run: AutomationRun;
  automationName: string;
  onClick: () => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AutomationRunItem({ run, automationName, onClick }: AutomationRunItemProps) {
  const isUnread = !run.isRead && run.hasFindings;

  return (
    <button
      className={`w-full rounded-md border p-2.5 text-left transition-colors hover:bg-accent/50 ${
        isUnread ? 'border-l-amber-500 border-l-[3px] border-border' : 'border-border opacity-60'
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between">
        <span className={`truncate text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground'}`}>
          {automationName}
        </span>
        <span className="text-muted-foreground text-xs">{timeAgo(run.startedAt)}</span>
      </div>
      {run.status === 'running' && (
        <div className="mt-1 text-blue-500 text-xs">Running...</div>
      )}
      {run.status === 'completed' && !run.hasFindings && (
        <div className="mt-1 text-green-500 text-xs">No issues found</div>
      )}
      {run.status === 'failed' && (
        <div className="mt-1 text-destructive text-xs">Failed</div>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Create AutomationRunsPanel.tsx**

Create `src/components/sidebar/AutomationRunsPanel.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAutomationStore } from '@/stores/automationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import AutomationRunItem from './AutomationRunItem';

export default function AutomationRunsPanel() {
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const navigate = useNavigate();

  const { automations, runs, loadAutomations, loadRuns, markAllRead } = useAutomationStore();
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadAutomations(activeWorkspace.id);
      loadRuns(activeWorkspace.id, filter === 'unread');
    }
  }, [activeWorkspace?.id, filter, loadAutomations, loadRuns]);

  const getAutomationName = (automationId: string): string => {
    return automations.find((a) => a.id === automationId)?.name ?? 'Automation';
  };

  const handleRunClick = (run: { taskId: string | null; id: string }) => {
    if (run.taskId) {
      navigate(`/execution/${run.taskId}`);
    }
  };

  if (!activeWorkspace) {
    return <div className="p-4 text-center text-muted-foreground text-xs">No workspace selected</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-border border-b px-3 py-2">
        <div className="flex gap-1">
          <button
            className={`rounded px-2 py-0.5 text-xs ${
              filter === 'unread' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setFilter('unread')}
            type="button"
          >
            Unread
          </button>
          <button
            className={`rounded px-2 py-0.5 text-xs ${
              filter === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setFilter('all')}
            type="button"
          >
            All
          </button>
        </div>
        <button
          className="text-muted-foreground text-xs hover:text-foreground"
          onClick={() => activeWorkspace && markAllRead(activeWorkspace.id)}
          type="button"
        >
          Mark all read
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {runs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-xs">
            {filter === 'unread' ? 'No unread automation runs' : 'No automation runs yet'}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {runs.map((run) => (
            <AutomationRunItem
              automationName={getAutomationName(run.automationId)}
              key={run.id}
              onClick={() => handleRunClick(run)}
              run={run}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Automations tab to Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`:

Add the import:
```typescript
import AutomationRunsPanel from '../sidebar/AutomationRunsPanel';
import { Zap } from 'lucide-react';
import { useAutomationStore } from '@/stores/automationStore';
```

Change the sidebar tab type (find where it's defined) to include `'automations'`:
```typescript
type SidebarTab = 'sessions' | 'automations' | 'files';
```

Add the Automations tab button between the Sessions and Files buttons at line ~195-216:

```typescript
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-medium text-xs transition-colors ${
              activeTab === 'automations' ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('automations')}
            type="button"
          >
            <Zap className="h-3.5 w-3.5" />
            Automations
            {unreadCount > 0 && (
              <span className="h-2 w-2 rounded-full bg-destructive" />
            )}
          </button>
```

Add the tab content panel (where the existing tab content is rendered):
```typescript
{activeTab === 'automations' && <AutomationRunsPanel />}
```

Get the unread count from the store at the top of the component:
```typescript
const unreadCount = useAutomationStore((s) => s.unreadCount);
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/AutomationRunItem.tsx src/components/sidebar/AutomationRunsPanel.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(ui): add Automations sidebar tab with triage run list"
```

---

## Task 8: Filter Automation Runs from Sessions Tab

**Files:**
- Modify: `src/stores/taskStore.ts` (or wherever task list filtering happens)

- [ ] **Step 1: Identify where tasks are listed for the Sessions tab**

The `taskStore` has a `tasks` array that populates the sidebar Sessions tab. When loading tasks, filter out any task that has an `automation_run_id` set.

In the `list_tasks` Tauri command (Rust side, `src-tauri/src/commands/tasks.rs`), add a WHERE clause:

```sql
WHERE automation_run_id IS NULL
```

Or, if filtering on the frontend side, add to the task list query in `src-tauri/src/db/tasks.rs` (the `list_tasks` function):

```rust
// Add to the WHERE clause of the list_tasks query
AND t.automation_run_id IS NULL
```

- [ ] **Step 2: Verify that automation-triggered tasks don't appear in Sessions**

Run: `pnpm typecheck && cd src-tauri && cargo check`
Expected: both pass

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db/tasks.rs
git commit -m "fix: exclude automation runs from Sessions task list"
```

---

## Task 9: Integration Wiring & Event Listeners

**Files:**
- Modify: `src/lib/tauri-api-interface.ts` (add automation methods to the interface)
- Modify: `src/components/layout/Sidebar.tsx` (load unread count on workspace change)

- [ ] **Step 1: Add automation methods to TauriAPI interface**

In `src/lib/tauri-api-interface.ts`, add the automation methods to the interface so that `getTauriAPI()` exposes them:

```typescript
  // Automations
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>;
  updateAutomation: (input: UpdateAutomationInput) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
  listAutomations: (workspaceId?: string) => Promise<Automation[]>;
  getAutomation: (id: string) => Promise<Automation | null>;
  toggleAutomationEnabled: (id: string, enabled: boolean) => Promise<void>;
  listAutomationRuns: (workspaceId: string, unreadOnly: boolean) => Promise<AutomationRun[]>;
  markRunRead: (runId: string) => Promise<void>;
  markAllRunsRead: (workspaceId: string) => Promise<void>;
  getAutomationUnreadCount: (workspaceId: string) => Promise<number>;
  runAutomationNow: (automationId: string) => Promise<void>;
  onAutomationRunStarted: (callback: (event: { automationId: string; runId: string }) => void) => () => void;
  onAutomationRunCompleted: (callback: (event: { runId: string; hasFindings: boolean; status: string }) => void) => () => void;
  onAutomationChanged: (callback: (event: { automationId: string; action: string }) => void) => () => void;
```

- [ ] **Step 2: Wire up unread count loading on workspace change in Sidebar**

In `Sidebar.tsx`, add an effect that loads the unread count when the active workspace changes:

```typescript
const { loadUnreadCount } = useAutomationStore();
const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

useEffect(() => {
  if (activeWorkspace?.id) {
    loadUnreadCount(activeWorkspace.id);
  }
}, [activeWorkspace?.id, loadUnreadCount]);
```

Also subscribe to automation events to refresh the count:

```typescript
useEffect(() => {
  const unsub1 = api.onAutomationRunCompleted(() => {
    if (activeWorkspace?.id) {
      loadUnreadCount(activeWorkspace.id);
    }
  });
  return () => { unsub1(); };
}, [activeWorkspace?.id, loadUnreadCount, api]);
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

- [ ] **Step 4: Run formatter**

Run: `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri-api-interface.ts src/components/layout/Sidebar.tsx
git commit -m "feat: wire automation event listeners and unread count in sidebar"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: passes with no errors

- [ ] **Step 2: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: passes with no errors

- [ ] **Step 3: Run formatter**

Run: `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/`
Expected: no formatting issues

- [ ] **Step 4: Run frontend tests**

Run: `pnpm test --run`
Expected: existing tests pass (no regressions)

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification and formatting fixes"
```
