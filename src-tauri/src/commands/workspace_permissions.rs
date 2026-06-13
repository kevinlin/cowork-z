use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::types::FolderPermission;

#[tauri::command]
pub async fn save_workspace_permission(
    workspace_id: String,
    folder_path: String,
    access_level: String,
    source: Option<String>,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Canonicalize and validate before persisting: grants feed allowed_roots
    // and the asset: protocol scope (technical review 2026-06-12 #3).
    let folder_path = crate::path_guard::validate_grant_path(&folder_path)?;

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let source = source.as_deref().unwrap_or("user");
    db::workspace_permissions::save_workspace_permission(
        &conn,
        &workspace_id,
        &folder_path,
        &access_level,
        source,
    )?;

    // Newly granted folders become loadable via the asset: protocol
    crate::path_guard::sync_asset_scope(&app, &conn);
    Ok(())
}

#[tauri::command]
pub async fn get_workspace_permissions(
    workspace_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<FolderPermission>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let perms = db::workspace_permissions::get_workspace_permissions(&conn, &workspace_id)?;
    Ok(perms
        .iter()
        .map(|p| FolderPermission {
            folder_path: p.folder_path.clone(),
            access_level: p.access_level.clone(),
            source: Some(p.source.clone()),
        })
        .collect())
}

#[tauri::command]
pub async fn remove_workspace_permission(
    workspace_id: String,
    folder_path: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::workspace_permissions::remove_workspace_permission(&conn, &workspace_id, &folder_path)
}

#[tauri::command]
pub async fn get_default_folder_permissions() -> Result<Vec<FolderPermission>, String> {
    Ok(vec![])
}
