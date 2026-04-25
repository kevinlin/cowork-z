// src-tauri/src/db/arenas.rs
//! Arena persistence — side-by-side agent comparison sessions

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::tasks::{get_tasks_by_arena, StoredTask};

/// Input for creating an arena
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaInput {
    pub id: String,
    pub prompt: String,
    pub workspace_id: Option<String>,
    pub created_at: String,
}

/// Stored arena with its child tasks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredArena {
    pub id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub tasks: Vec<StoredTask>,
}

/// Lightweight child task info for sidebar display (no messages)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaChildTask {
    pub id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arena_slot: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Lightweight arena for sidebar listing (no messages loaded)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaListItem {
    pub id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// Summary status derived from child tasks
    pub status: String,
    /// Model IDs of the 3 columns
    pub model_ids: Vec<Option<String>>,
    /// Child tasks for expandable sidebar display
    pub tasks: Vec<ArenaChildTask>,
}

/// Save a new arena record
pub fn save_arena(conn: &Connection, arena: &ArenaInput) -> Result<(), String> {
    conn.execute(
        "INSERT INTO arenas (id, prompt, workspace_id, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![arena.id, arena.prompt, arena.workspace_id, arena.created_at],
    )
    .map_err(|e| format!("Failed to save arena: {}", e))?;
    Ok(())
}

/// Set arena_id, arena_slot, and model_id on a task
pub fn save_task_arena_fields(
    conn: &Connection,
    task_id: &str,
    arena_id: &str,
    arena_slot: i32,
    model_id: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET arena_id = ?1, arena_slot = ?2, model_id = ?3 WHERE id = ?4",
        params![arena_id, arena_slot, model_id, task_id],
    )
    .map_err(|e| format!("Failed to set arena fields on task: {}", e))?;
    Ok(())
}

/// Get an arena with its 3 child tasks (including messages)
pub fn get_arena_with_tasks(conn: &Connection, arena_id: &str) -> Option<StoredArena> {
    let result = conn.query_row(
        "SELECT id, prompt, workspace_id, created_at, completed_at
         FROM arenas WHERE id = ?1",
        [arena_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        },
    );

    match result {
        Ok((id, prompt, workspace_id, created_at, completed_at)) => {
            let tasks = get_tasks_by_arena(conn, &id);
            Some(StoredArena {
                id,
                prompt,
                workspace_id,
                created_at,
                completed_at,
                tasks,
            })
        }
        Err(_) => None,
    }
}

/// List arenas for a workspace (for sidebar display).
/// Uses a single JOIN to fetch arenas and their child tasks together.
pub fn get_arenas_by_workspace(conn: &Connection, workspace_id: &str) -> Vec<ArenaListItem> {
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.prompt, a.workspace_id, a.created_at, a.completed_at,
                    t.id, t.status, t.model_id, t.arena_slot, t.summary
             FROM arenas a
             LEFT JOIN tasks t ON t.arena_id = a.id
             WHERE a.workspace_id = ?1
             ORDER BY a.created_at DESC, t.arena_slot ASC",
        )
        .expect("Failed to prepare arenas query");

    let rows: Vec<(
        String,
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i32>,
        Option<String>,
    )> = stmt
        .query_map([workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i32>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .expect("Failed to query arenas")
        .filter_map(|r| r.ok())
        .collect();

    let mut arenas: Vec<ArenaListItem> = Vec::new();

    for (
        arena_id,
        prompt,
        ws_id,
        created_at,
        completed_at,
        task_id,
        task_status,
        model_id,
        arena_slot,
        summary,
    ) in rows
    {
        let needs_new = arenas.last().map_or(true, |a| a.id != arena_id);
        if needs_new {
            arenas.push(ArenaListItem {
                id: arena_id,
                prompt,
                workspace_id: ws_id,
                created_at,
                completed_at,
                status: String::new(),
                model_ids: Vec::new(),
                tasks: Vec::new(),
            });
        }

        if let (Some(tid), Some(tstatus)) = (task_id, task_status) {
            let entry = arenas.last_mut().unwrap();
            entry.model_ids.push(model_id.clone());
            entry.tasks.push(ArenaChildTask {
                id: tid,
                status: tstatus,
                model_id,
                arena_slot,
                summary,
            });
        }
    }

    for item in &mut arenas {
        item.status = derive_arena_status(&item.tasks);
    }

    arenas.truncate(50);
    arenas
}

fn derive_arena_status(tasks: &[ArenaChildTask]) -> String {
    if tasks.is_empty() {
        return "pending".to_string();
    }
    if tasks.iter().any(|t| t.status == "running") {
        "running"
    } else if tasks
        .iter()
        .any(|t| t.status == "starting" || t.status == "queued")
    {
        "starting"
    } else if tasks.iter().any(|t| t.status == "failed") {
        "failed"
    } else if tasks.iter().all(|t| t.status == "completed") {
        "completed"
    } else if tasks.iter().any(|t| t.status == "interrupted") {
        "interrupted"
    } else {
        "pending"
    }
    .to_string()
}

/// Check if all tasks in an arena have reached a terminal state.
/// Returns `Some(arena_id)` if the task belongs to an arena and all siblings are terminal,
/// or `None` otherwise.
pub fn check_arena_all_tasks_terminal(conn: &Connection, task_id: &str) -> Option<String> {
    let arena_id: Option<String> = conn
        .query_row(
            "SELECT arena_id FROM tasks WHERE id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    let arena_id = arena_id?;

    let non_terminal_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE arena_id = ?1 AND status NOT IN ('completed', 'failed', 'interrupted')",
            [&arena_id],
            |row| row.get(0),
        )
        .unwrap_or(1);

    if non_terminal_count == 0 {
        Some(arena_id)
    } else {
        None
    }
}

/// Update arena completion timestamp
pub fn update_arena_completed(
    conn: &Connection,
    arena_id: &str,
    completed_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE arenas SET completed_at = ?1 WHERE id = ?2",
        params![completed_at, arena_id],
    )
    .map_err(|e| format!("Failed to update arena completed_at: {}", e))?;
    Ok(())
}

/// Delete an arena and its child tasks (cascade via FK)
pub fn delete_arena(conn: &Connection, arena_id: &str) -> Result<(), String> {
    // Delete child tasks first (their messages cascade via FK)
    conn.execute("DELETE FROM tasks WHERE arena_id = ?1", [arena_id])
        .map_err(|e| format!("Failed to delete arena tasks: {}", e))?;

    conn.execute("DELETE FROM arenas WHERE id = ?1", [arena_id])
        .map_err(|e| format!("Failed to delete arena: {}", e))?;

    Ok(())
}

/// Update arena prompt (for rename)
pub fn update_arena_prompt(conn: &Connection, arena_id: &str, prompt: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE arenas SET prompt = ?1 WHERE id = ?2",
        params![prompt, arena_id],
    )
    .map_err(|e| format!("Failed to update arena prompt: {}", e))?;
    Ok(())
}
