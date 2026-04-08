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

/// List arenas for a workspace (for sidebar display)
pub fn get_arenas_by_workspace(conn: &Connection, workspace_id: &str) -> Vec<ArenaListItem> {
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.prompt, a.workspace_id, a.created_at, a.completed_at
             FROM arenas a
             WHERE a.workspace_id = ?1
             ORDER BY a.created_at DESC
             LIMIT 50",
        )
        .expect("Failed to prepare arenas query");

    let arena_iter = stmt
        .query_map([workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .expect("Failed to query arenas");

    arena_iter
        .filter_map(|r| r.ok())
        .map(|(id, prompt, workspace_id, created_at, completed_at)| {
            let (status, model_ids) = derive_arena_status(conn, &id);
            ArenaListItem {
                id,
                prompt,
                workspace_id,
                created_at,
                completed_at,
                status,
                model_ids,
            }
        })
        .collect()
}

/// Derive arena status and model IDs from child tasks
fn derive_arena_status(conn: &Connection, arena_id: &str) -> (String, Vec<Option<String>>) {
    let mut stmt = conn
        .prepare(
            "SELECT status, model_id FROM tasks
             WHERE arena_id = ?1
             ORDER BY arena_slot ASC",
        )
        .expect("Failed to prepare arena status query");

    let rows: Vec<(String, Option<String>)> = stmt
        .query_map([arena_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .expect("Failed to query arena tasks")
        .filter_map(|r| r.ok())
        .collect();

    let model_ids: Vec<Option<String>> = rows.iter().map(|(_, m)| m.clone()).collect();
    let statuses: Vec<&str> = rows.iter().map(|(s, _)| s.as_str()).collect();

    // Derive overall status: running > starting > queued > failed > completed
    let status = if statuses.iter().any(|s| *s == "running") {
        "running"
    } else if statuses.iter().any(|s| *s == "starting" || *s == "queued") {
        "starting"
    } else if statuses.iter().any(|s| *s == "failed") {
        "failed"
    } else if statuses.iter().all(|s| *s == "completed") {
        "completed"
    } else if statuses.iter().any(|s| *s == "interrupted") {
        "interrupted"
    } else {
        "pending"
    };

    (status.to_string(), model_ids)
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
pub fn update_arena_prompt(
    conn: &Connection,
    arena_id: &str,
    prompt: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE arenas SET prompt = ?1 WHERE id = ?2",
        params![prompt, arena_id],
    )
    .map_err(|e| format!("Failed to update arena prompt: {}", e))?;
    Ok(())
}
