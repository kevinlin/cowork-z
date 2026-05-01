use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db::automations as db_automations;
use crate::sidecar::{
    self, ApiKeys, FolderPermissionPayload, SidecarCommand, SidecarState, StartTaskPayload,
};

/// Resolved context needed to dispatch a `StartTask` to the sidecar.
pub(crate) struct StartTaskDispatch {
    pub task_id: String,
    pub prompt: String,
    pub working_directory: Option<String>,
    pub folder_permissions: Option<Vec<FolderPermissionPayload>>,
    pub custom_prompt: Option<String>,
    pub mcp_servers: Option<serde_json::Value>,
    pub model_id: String,
    pub api_keys: ApiKeys,
}

/// Resolve workspace + settings + secrets needed to dispatch a `StartTask` for an automation.
pub(crate) fn build_dispatch_context(
    conn: &Connection,
    automation: &db_automations::StoredAutomation,
    task_id: String,
) -> Result<StartTaskDispatch, String> {
    let working_directory = crate::db::workspaces::get_workspace(conn, &automation.workspace_id)
        .map(|w| w.folder_path);

    let workspace_perms =
        crate::db::workspace_permissions::get_workspace_permissions(conn, &automation.workspace_id);
    let mut perms: Vec<FolderPermissionPayload> = Vec::new();
    if let Some(ref wd) = working_directory {
        perms.push(FolderPermissionPayload {
            path: wd.clone(),
            access_level: "read-write".to_string(),
            source: Some("workspace".to_string()),
        });
    }
    perms.extend(workspace_perms.into_iter().map(|wp| FolderPermissionPayload {
        path: wp.folder_path,
        access_level: wp.access_level,
        source: Some(wp.source),
    }));
    let folder_permissions = if perms.is_empty() { None } else { Some(perms) };

    let custom_prompt = if crate::db::settings::get_user_prompt_enabled(conn) {
        crate::db::settings::get_user_prompt_text(conn)
    } else {
        None
    };

    let mcp_servers = crate::db::settings::get_mcp_servers_config(conn)
        .map(|c| serde_json::to_value(c).unwrap());

    let api_keys =
        sidecar::get_all_api_keys().map_err(|e| format!("Failed to get API keys: {}", e))?;

    Ok(StartTaskDispatch {
        task_id,
        prompt: automation.prompt.clone(),
        working_directory,
        folder_permissions,
        custom_prompt,
        mcp_servers,
        model_id: automation.model_id.clone(),
        api_keys,
    })
}

/// Fire-and-forget: spawn a Tokio task that sends `StartTask` to the sidecar.
/// Errors are logged but not propagated. Used by the scheduler.
pub(crate) fn spawn_start_task_dispatch(app: &AppHandle, dispatch: StartTaskDispatch) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = dispatch_start_task_inner(&app_handle, dispatch).await {
            eprintln!("[AutomationDispatch] {}", e);
        }
    });
}

/// Send `StartTask` to the sidecar with error propagation.
/// Spawns the sidecar if not already running. Used by `run_automation_now`.
pub(crate) async fn dispatch_start_task(
    app: &AppHandle,
    dispatch: StartTaskDispatch,
) -> Result<(), String> {
    dispatch_start_task_inner(app, dispatch).await
}

async fn dispatch_start_task_inner(
    app: &AppHandle,
    dispatch: StartTaskDispatch,
) -> Result<(), String> {
    let sidecar_state = app.state::<SidecarState>();
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager
            .spawn(app)
            .await
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;
    }

    let StartTaskDispatch {
        task_id,
        prompt,
        working_directory,
        folder_permissions,
        custom_prompt,
        mcp_servers,
        model_id,
        api_keys,
    } = dispatch;

    manager
        .send_command(SidecarCommand::StartTask {
            task_id: task_id.clone(),
            payload: StartTaskPayload {
                task_id,
                prompt,
                api_keys: Some(api_keys),
                working_directory,
                model_id: Some(model_id),
                folder_permissions,
                custom_prompt,
                mcp_servers,
                skip_config: None,
                arena_id: None,
            },
        })
        .await
        .map_err(|e| format!("Failed to send StartTask: {}", e))
}
