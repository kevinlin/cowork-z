// src-tauri/src/commands/workspaces.rs
//! Workspace management commands

use std::path::Path;
use tauri::{Emitter, State};

use crate::db;
use crate::db::workspaces::StoredWorkspace;
use crate::db::DbState;
use crate::fs_watcher;
use crate::types::{DirectoryEntry, Workspace};
use crate::workspace_validator;

fn to_workspace(s: StoredWorkspace) -> Workspace {
    Workspace {
        id: s.id,
        folder_path: s.folder_path,
        display_name: s.display_name,
        created_at: s.created_at,
        last_opened_at: s.last_opened_at,
    }
}

fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn folder_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// List all workspaces (most recently opened first)
#[tauri::command]
pub async fn list_workspaces(state: State<'_, DbState>) -> Result<Vec<Workspace>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::workspaces::list_workspaces(&conn)
        .into_iter()
        .map(to_workspace)
        .collect())
}

/// Get the currently active workspace (based on last_workspace_id setting)
#[tauri::command]
pub async fn get_active_workspace(state: State<'_, DbState>) -> Result<Option<Workspace>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let ws = db::settings::get_last_workspace_id(&conn)
        .and_then(|id| db::workspaces::get_workspace(&conn, &id))
        .map(to_workspace);
    Ok(ws)
}

/// Add a new workspace folder (validates path, deduplicates)
#[tauri::command]
pub async fn add_workspace(
    folder_path: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<Workspace, String> {
    // Validate the path
    workspace_validator::validate_workspace_path(&folder_path)?;

    // Check if folder exists
    if !Path::new(&folder_path).is_dir() {
        return Err(format!(
            "'{}' does not exist or is not a directory",
            folder_path
        ));
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Check for existing workspace with this path
    if let Some(existing) = db::workspaces::get_workspace_by_path(&conn, &folder_path) {
        return Ok(to_workspace(existing));
    }

    let now = now_ts();
    let ws = StoredWorkspace {
        id: format!("ws_{}", uuid::Uuid::new_v4()),
        folder_path: folder_path.clone(),
        display_name: folder_basename(&folder_path),
        created_at: now,
        last_opened_at: now,
    };

    db::workspaces::save_workspace(&conn, &ws)?;

    let result = to_workspace(ws);
    let _ = app.emit("workspace:added", &result);
    Ok(result)
}

/// Remove a workspace from the list (sessions are preserved in DB)
#[tauri::command]
pub async fn remove_workspace(
    workspace_id: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Cannot remove the active workspace
    if let Some(active_id) = db::settings::get_last_workspace_id(&conn) {
        if active_id == workspace_id {
            return Err(
                "Cannot remove the active workspace. Switch to another workspace first."
                    .to_string(),
            );
        }
    }

    db::workspaces::remove_workspace(&conn, &workspace_id)?;

    let _ = app.emit(
        "workspace:removed",
        serde_json::json!({ "workspaceId": workspace_id }),
    );
    Ok(())
}

/// Switch to a different workspace
#[tauri::command]
pub async fn switch_workspace(
    workspace_id: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<Workspace, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let ws = db::workspaces::get_workspace(&conn, &workspace_id)
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;

    // Check if the folder still exists
    if !Path::new(&ws.folder_path).is_dir() {
        let _ = app.emit(
            "workspace:error",
            serde_json::json!({ "workspaceId": workspace_id, "kind": "missing_folder" }),
        );
        return Err(format!(
            "Workspace folder '{}' no longer exists. It may have been moved or deleted.",
            ws.folder_path
        ));
    }

    let now = now_ts();
    db::workspaces::update_last_opened_at(&conn, &workspace_id, now)?;
    db::settings::set_last_workspace_id(&conn, Some(&workspace_id))?;

    let result = Workspace {
        last_opened_at: now,
        ..to_workspace(ws)
    };

    // Start filesystem watcher for the new workspace folder
    if let Err(e) = fs_watcher::watch_folder(&app, &result.folder_path) {
        eprintln!("[warn] Failed to watch workspace folder: {}", e);
    }

    let _ = app.emit(
        "workspace:changed",
        serde_json::json!({ "workspace": &result }),
    );
    Ok(result)
}

/// Read directory contents for the file tree
#[tauri::command]
pub async fn read_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.is_dir() {
        return Err(format!("'{}' is not a directory", path));
    }

    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_directory = metadata.is_dir();
        let size = if is_directory {
            None
        } else {
            Some(metadata.len())
        };
        let extension = if is_directory {
            None
        } else {
            entry_path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        };

        entries.push(DirectoryEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
            size,
            extension,
        });
    }

    // Sort: directories first, then files, both alphabetical (case-insensitive)
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Initialize workspace on app startup.
/// If a last workspace exists, returns it. Otherwise creates ~/Downloads as default.
#[tauri::command]
pub async fn initialize_workspace(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<Workspace, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Check for existing active workspace
    if let Some(ws_id) = db::settings::get_last_workspace_id(&conn) {
        if let Some(ws) = db::workspaces::get_workspace(&conn, &ws_id) {
            // Verify folder still exists
            if Path::new(&ws.folder_path).is_dir() {
                if let Err(e) = fs_watcher::watch_folder(&app, &ws.folder_path) {
                    eprintln!("[warn] Failed to watch workspace folder: {}", e);
                }
                return Ok(to_workspace(ws));
            }
            // Folder missing — fall through to create default
        }
    }

    // Create ~/Downloads as default workspace
    let downloads_path = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?
        .join("Downloads");

    let downloads_str = downloads_path.to_string_lossy().to_string();

    // Check if Downloads workspace already exists
    if let Some(existing) = db::workspaces::get_workspace_by_path(&conn, &downloads_str) {
        db::settings::set_last_workspace_id(&conn, Some(&existing.id))?;
        db::workspaces::assign_orphaned_tasks(&conn, &existing.id)?;
        if let Err(e) = fs_watcher::watch_folder(&app, &existing.folder_path) {
            eprintln!("[warn] Failed to watch workspace folder: {}", e);
        }
        return Ok(to_workspace(existing));
    }

    let now = now_ts();
    let ws = StoredWorkspace {
        id: format!("ws_{}", uuid::Uuid::new_v4()),
        folder_path: downloads_str,
        display_name: "Downloads".to_string(),
        created_at: now,
        last_opened_at: now,
    };

    db::workspaces::save_workspace(&conn, &ws)?;
    db::settings::set_last_workspace_id(&conn, Some(&ws.id))?;
    db::workspaces::assign_orphaned_tasks(&conn, &ws.id)?;

    let result = to_workspace(ws);
    if let Err(e) = fs_watcher::watch_folder(&app, &result.folder_path) {
        eprintln!("[warn] Failed to watch workspace folder: {}", e);
    }
    let _ = app.emit(
        "workspace:changed",
        serde_json::json!({ "workspace": &result }),
    );
    Ok(result)
}
