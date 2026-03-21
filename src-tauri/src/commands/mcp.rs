use tauri::State;

use crate::sidecar::{McpServerNamePayload, SidecarCommand, SidecarState};

#[tauri::command]
pub async fn get_mcp_status(
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        return Ok(());
    }

    manager
        .send_command(SidecarCommand::GetMcpStatus)
        .await
}

#[tauri::command]
pub async fn get_mcp_tools(
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        return Ok(());
    }

    manager
        .send_command(SidecarCommand::GetMcpTools)
        .await
}

#[tauri::command]
pub async fn connect_mcp_server(
    name: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    manager
        .send_command(SidecarCommand::ConnectMcpServer {
            payload: McpServerNamePayload { name },
        })
        .await
}

#[tauri::command]
pub async fn disconnect_mcp_server(
    name: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;

    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    manager
        .send_command(SidecarCommand::DisconnectMcpServer {
            payload: McpServerNamePayload { name },
        })
        .await
}
