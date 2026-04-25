use tauri::State;

use crate::sidecar::{SidecarCommand, SidecarState};

#[tauri::command]
pub async fn copilot_oauth_authorize(
    enterprise_url: Option<String>,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    manager
        .send_command(SidecarCommand::CopilotOAuthAuthorize { enterprise_url })
        .await
}

#[tauri::command]
pub async fn copilot_get_models(
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    manager.send_command(SidecarCommand::CopilotGetModels).await
}

#[tauri::command]
pub async fn copilot_disconnect(
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    manager
        .send_command(SidecarCommand::CopilotDisconnect)
        .await
}
