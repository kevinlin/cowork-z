// src-tauri/src/db/workspaces.rs
//! Workspace CRUD operations

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Stored workspace
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWorkspace {
    pub id: String,
    pub folder_path: String,
    pub display_name: String,
    pub created_at: i64,
    pub last_opened_at: i64,
}

/// Save (upsert) a workspace
pub fn save_workspace(conn: &Connection, ws: &StoredWorkspace) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workspaces (id, folder_path, display_name, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET folder_path = excluded.folder_path, display_name = excluded.display_name, last_opened_at = excluded.last_opened_at",
        params![ws.id, ws.folder_path, ws.display_name, ws.created_at, ws.last_opened_at],
    )
    .map_err(|e| format!("Failed to save workspace: {}", e))?;
    Ok(())
}

/// Get a workspace by ID
pub fn get_workspace(conn: &Connection, id: &str) -> Option<StoredWorkspace> {
    conn.query_row(
        "SELECT id, folder_path, display_name, created_at, last_opened_at
         FROM workspaces WHERE id = ?1",
        [id],
        |row| {
            Ok(StoredWorkspace {
                id: row.get(0)?,
                folder_path: row.get(1)?,
                display_name: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        },
    )
    .ok()
}

/// Get a workspace by folder path
pub fn get_workspace_by_path(conn: &Connection, folder_path: &str) -> Option<StoredWorkspace> {
    conn.query_row(
        "SELECT id, folder_path, display_name, created_at, last_opened_at
         FROM workspaces WHERE folder_path = ?1",
        [folder_path],
        |row| {
            Ok(StoredWorkspace {
                id: row.get(0)?,
                folder_path: row.get(1)?,
                display_name: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        },
    )
    .ok()
}

/// List all workspaces, most recently opened first
pub fn list_workspaces(conn: &Connection) -> Result<Vec<StoredWorkspace>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, folder_path, display_name, created_at, last_opened_at
             FROM workspaces
             ORDER BY last_opened_at DESC",
        )
        .map_err(|e| format!("Failed to prepare workspaces query: {}", e))?;

    let iter = stmt
        .query_map([], |row| {
            Ok(StoredWorkspace {
                id: row.get(0)?,
                folder_path: row.get(1)?,
                display_name: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query workspaces: {}", e))?;

    Ok(iter.filter_map(|r| r.ok()).collect())
}

/// Remove a workspace (preserves tasks by nulling their workspace_id)
pub fn remove_workspace(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET workspace_id = NULL WHERE workspace_id = ?1",
        params![id],
    )
    .map_err(|e| format!("Failed to unlink tasks from workspace: {}", e))?;

    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to remove workspace: {}", e))?;
    Ok(())
}

/// Update the last_opened_at timestamp for a workspace
pub fn update_last_opened_at(conn: &Connection, id: &str, ts: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE workspaces SET last_opened_at = ?1 WHERE id = ?2",
        params![ts, id],
    )
    .map_err(|e| format!("Failed to update workspace last_opened_at: {}", e))?;
    Ok(())
}

/// Assign a task to a workspace
pub fn assign_task_to_workspace(
    conn: &Connection,
    workspace_id: &str,
    task_id: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET workspace_id = ?1 WHERE id = ?2",
        params![workspace_id, task_id],
    )
    .map_err(|e| format!("Failed to assign task to workspace: {}", e))?;
    Ok(())
}

/// Assign all orphaned tasks (workspace_id IS NULL) to a workspace
pub fn assign_orphaned_tasks(conn: &Connection, workspace_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET workspace_id = ?1 WHERE workspace_id IS NULL",
        params![workspace_id],
    )
    .map_err(|e| format!("Failed to assign orphaned tasks: {}", e))?;
    Ok(())
}
