// src-tauri/src/db/workspace_permissions.rs
//! Workspace-scoped permission CRUD operations

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Stored workspace permission
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWorkspacePermission {
    pub id: i64,
    pub workspace_id: String,
    pub folder_path: String,
    pub access_level: String,
    pub source: String,
    pub created_at: String,
}

/// Save (upsert) a workspace permission
pub fn save_workspace_permission(
    conn: &Connection,
    workspace_id: &str,
    folder_path: &str,
    access_level: &str,
    source: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO workspace_permissions (workspace_id, folder_path, access_level, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(workspace_id, folder_path) DO UPDATE SET access_level = excluded.access_level, source = excluded.source",
        params![workspace_id, folder_path, access_level, source, now],
    )
    .map_err(|e| format!("Failed to save workspace permission: {}", e))?;
    Ok(())
}

/// Get all permissions for a workspace
pub fn get_workspace_permissions(
    conn: &Connection,
    workspace_id: &str,
) -> Vec<StoredWorkspacePermission> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, folder_path, access_level, source, created_at
             FROM workspace_permissions
             WHERE workspace_id = ?1
             ORDER BY folder_path ASC",
        )
        .expect("Failed to prepare workspace_permissions query");

    let iter = stmt
        .query_map([workspace_id], |row| {
            Ok(StoredWorkspacePermission {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                folder_path: row.get(2)?,
                access_level: row.get(3)?,
                source: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .expect("Failed to query workspace_permissions");

    iter.filter_map(|r| r.ok()).collect()
}

/// Remove a specific workspace permission
pub fn remove_workspace_permission(
    conn: &Connection,
    workspace_id: &str,
    folder_path: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_permissions WHERE workspace_id = ?1 AND folder_path = ?2",
        params![workspace_id, folder_path],
    )
    .map_err(|e| format!("Failed to remove workspace permission: {}", e))?;
    Ok(())
}
