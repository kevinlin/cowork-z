use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_updater::{Update, UpdaterExt};

/// Managed state to hold a pending update between check and install steps.
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

/// Check for an available update. Returns `Some(UpdateInfo)` if an update is
/// available, or `None` if the app is already up to date.
#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    match update {
        Some(u) => {
            let info = UpdateInfo {
                version: u.version.clone(),
                current_version: u.current_version.clone(),
                body: u.body.clone(),
                date: u.date.map(|d| format!("{d}")),
            };
            *crate::lock_util::lock_or_recover(&pending.0, "pending update") = Some(u);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

/// Download and install the pending update, then relaunch the app.
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = crate::lock_util::lock_or_recover(&pending.0, "pending update")
        .take()
        .ok_or("No pending update to install")?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
