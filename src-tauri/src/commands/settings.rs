use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::sidecar;
use crate::sidecar::SidecarState;
use crate::types::*;

#[tauri::command]
pub async fn get_debug_mode(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::settings::get_debug_mode(&conn))
}

#[tauri::command]
pub async fn set_debug_mode(enabled: bool, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_debug_mode(&conn, enabled)
}

#[tauri::command]
pub async fn get_user_prompt(state: State<'_, DbState>) -> Result<UserPromptResponse, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(UserPromptResponse {
        enabled: db::settings::get_user_prompt_enabled(&conn),
        text: db::settings::get_user_prompt_text(&conn),
    })
}

#[tauri::command]
pub async fn set_user_prompt(
    enabled: bool,
    text: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_user_prompt(&conn, enabled, text.as_deref())
}

#[tauri::command]
pub async fn get_mcp_servers_config(
    state: State<'_, DbState>,
) -> Result<Option<serde_json::Value>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_mcp_servers_config(&conn);
    Ok(config.map(|c| serde_json::to_value(c).unwrap()))
}

#[tauri::command]
pub async fn set_mcp_servers_config(
    config: Option<serde_json::Value>,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    // Parse and validate config
    let parsed_config: Option<db::settings::McpServersConfig> = match config.clone() {
        Some(val) => {
            Some(serde_json::from_value(val).map_err(|e| format!("Invalid MCP config: {}", e))?)
        }
        None => None,
    };

    // Write to database
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::set_mcp_servers_config(&conn, parsed_config.as_ref())?;
    }

    // Resolve the active workspace directory so the config update is routed
    // to the correct per-workspace OpenCode server instance
    let working_directory = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
            .and_then(|id| db::workspaces::get_workspace(&conn, &id))
            .map(|ws| ws.folder_path)
    };

    // Apply to OpenCode server immediately if sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if manager.is_running() {
        let mcp_value = config.unwrap_or(serde_json::json!({}));
        manager
            .send_command(sidecar::SidecarCommand::UpdateMcpConfig {
                payload: sidecar::UpdateMcpConfigPayload {
                    mcp_servers: mcp_value,
                    working_directory,
                },
            })
            .await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_app_settings(state: State<'_, DbState>) -> Result<AppSettingsResponse, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let settings = db::settings::get_app_settings(&conn);
    Ok(AppSettingsResponse {
        debug_mode: settings.debug_mode,
        onboarding_complete: settings.onboarding_complete,
    })
}

#[tauri::command]
pub async fn get_theme(state: State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::settings::get_theme_id(&conn))
}

#[tauri::command]
pub async fn set_theme(theme_id: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_theme_id(&conn, theme_id.as_deref())
}

#[tauri::command]
pub async fn get_onboarding_complete(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::settings::get_onboarding_complete(&conn))
}

#[tauri::command]
pub async fn set_onboarding_complete(
    complete: bool,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_onboarding_complete(&conn, complete)
}
