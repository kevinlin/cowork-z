// src-tauri/src/db/folder_permissions.rs
//! Folder permission CRUD operations

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Stored folder permission
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFolderPermission {
    pub id: i64,
    pub task_id: String,
    pub folder_path: String,
    pub access_level: String,
    pub created_at: String,
}

/// Save (upsert) a folder permission for a task
pub fn save_folder_permission(
    conn: &Connection,
    task_id: &str,
    folder_path: &str,
    access_level: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folder_permissions (task_id, folder_path, access_level, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(task_id, folder_path) DO UPDATE SET access_level = excluded.access_level",
        params![task_id, folder_path, access_level, now],
    )
    .map_err(|e| format!("Failed to save folder permission: {}", e))?;
    Ok(())
}

/// Get all folder permissions for a task
pub fn get_folder_permissions(conn: &Connection, task_id: &str) -> Vec<StoredFolderPermission> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, folder_path, access_level, created_at
             FROM folder_permissions
             WHERE task_id = ?1
             ORDER BY folder_path ASC",
        )
        .expect("Failed to prepare folder_permissions query");

    let iter = stmt
        .query_map([task_id], |row| {
            Ok(StoredFolderPermission {
                id: row.get(0)?,
                task_id: row.get(1)?,
                folder_path: row.get(2)?,
                access_level: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .expect("Failed to query folder_permissions");

    iter.filter_map(|r| r.ok()).collect()
}

/// Remove a specific folder permission for a task
pub fn remove_folder_permission(
    conn: &Connection,
    task_id: &str,
    folder_path: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM folder_permissions WHERE task_id = ?1 AND folder_path = ?2",
        params![task_id, folder_path],
    )
    .map_err(|e| format!("Failed to remove folder permission: {}", e))?;
    Ok(())
}

/// Clear all folder permissions for a task
pub fn clear_folder_permissions(conn: &Connection, task_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM folder_permissions WHERE task_id = ?1",
        [task_id],
    )
    .map_err(|e| format!("Failed to clear folder permissions: {}", e))?;
    Ok(())
}
