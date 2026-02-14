use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::types::FolderPermission;

#[tauri::command]
pub async fn save_folder_permission(
    task_id: String,
    folder_path: String,
    access_level: String,
    source: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let source = source.as_deref().unwrap_or("user");
    db::folder_permissions::save_folder_permission(&conn, &task_id, &folder_path, &access_level, source)
}

#[tauri::command]
pub async fn get_folder_permissions(
    task_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<FolderPermission>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let perms = db::folder_permissions::get_folder_permissions(&conn, &task_id);
    Ok(perms.iter().map(|p| FolderPermission {
        folder_path: p.folder_path.clone(),
        access_level: p.access_level.clone(),
        source: Some(p.source.clone()),
    }).collect())
}

#[tauri::command]
pub async fn remove_folder_permission(
    task_id: String,
    folder_path: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::folder_permissions::remove_folder_permission(&conn, &task_id, &folder_path)
}

#[tauri::command]
pub async fn get_default_folder_permissions() -> Result<Vec<FolderPermission>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let downloads = home.join("Downloads");
    let desktop = home.join("Desktop");

    let mut defaults = Vec::new();
    if downloads.exists() {
        defaults.push(FolderPermission {
            folder_path: downloads.to_string_lossy().to_string(),
            access_level: "read".to_string(),
            source: None,
        });
    }
    if desktop.exists() {
        defaults.push(FolderPermission {
            folder_path: desktop.to_string_lossy().to_string(),
            access_level: "read".to_string(),
            source: None,
        });
    }
    Ok(defaults)
}
