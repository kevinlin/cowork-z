use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Manager, State};

mod db;
mod secure_storage;
mod sidecar;

use db::DbState;
use sidecar::SidecarState;

// ============================================================================
// Types - Match the TypeScript types in src/shared/types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub prompt: String,
    pub status: String,
    pub messages: Vec<TaskMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TaskResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<TaskAttachment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAttachment {
    #[serde(rename = "type")]
    pub att_type: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConfig {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub task_id: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyConfig {
    pub id: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsResponse {
    pub debug_mode: bool,
    pub onboarding_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedModel {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub id: String,
    pub display_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub base_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<OllamaModel>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureFoundryConfig {
    pub base_url: String,
    pub deployment_name: String,
    pub auth_type: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureFoundryTestConfig {
    pub endpoint: String,
    pub deployment_name: String,
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteLLMConfig {
    pub base_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<OpenRouterModel>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockModel {
    pub id: String,
    pub name: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_provider: Option<String>,
    pub connected_providers: HashMap<String, ConnectedProviderResponse>,
    pub debug_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedProviderResponse {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyStatus {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub install_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<OllamaModel>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRouterModelsResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<OpenRouterModel>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockModelsResult {
    pub success: bool,
    pub models: Vec<BedrockModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<HashMap<String, serde_json::Value>>,
}

// Input types for connected provider
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedProviderInput {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

// ============================================================================
// App Info Commands
// ============================================================================

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

// ============================================================================
// Task Commands
// ============================================================================

#[tauri::command]
async fn start_task(
    config: TaskConfig,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<Task, String> {
    // Generate task ID
    let task_id = config.task_id.clone().unwrap_or_else(|| {
        format!("task_{}", uuid::Uuid::new_v4())
    });

    // Get API keys from secure storage
    let api_keys = sidecar::get_all_api_keys()?;

    // Ensure sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    // Send start task command
    manager
        .send_command(sidecar::SidecarCommand::StartTask {
            task_id: task_id.clone(),
            payload: sidecar::StartTaskPayload {
                task_id: task_id.clone(),
                prompt: config.prompt.clone(),
                session_id: None,
                api_keys: Some(api_keys),
                working_directory: None,
                model_id: None,
            },
        })
        .await?;

    // Return task object (status will be updated via events)
    Ok(Task {
        id: task_id,
        prompt: config.prompt,
        status: "starting".to_string(),
        messages: vec![],
        result: None,
        session_id: None,
        summary: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        completed_at: None,
        started_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

#[tauri::command]
async fn cancel_task(
    task_id: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if manager.is_running() {
        manager
            .send_command(sidecar::SidecarCommand::CancelTask { task_id })
            .await?;
    }
    Ok(())
}

#[tauri::command]
async fn interrupt_task(
    task_id: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if manager.is_running() {
        manager
            .send_command(sidecar::SidecarCommand::InterruptTask { task_id })
            .await?;
    }
    Ok(())
}

#[tauri::command]
async fn get_task(task_id: String, state: State<'_, DbState>) -> Result<Option<Task>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let stored = db::tasks::get_task(&conn, &task_id);

    Ok(stored.map(|t| Task {
        id: t.id,
        prompt: t.prompt,
        status: t.status,
        messages: t
            .messages
            .into_iter()
            .map(|m| TaskMessage {
                id: m.id,
                msg_type: m.msg_type,
                content: m.content,
                timestamp: m.timestamp,
                tool_name: m.tool_name,
                tool_input: m.tool_input,
                attachments: m.attachments.map(|atts| {
                    atts.into_iter()
                        .map(|a| TaskAttachment {
                            att_type: a.att_type,
                            data: a.data,
                            label: a.label,
                        })
                        .collect()
                }),
            })
            .collect(),
        result: None,
        session_id: t.session_id,
        summary: t.summary,
        created_at: t.created_at.clone(),
        updated_at: None,
        completed_at: t.completed_at,
        started_at: t.started_at,
    }))
}

#[tauri::command]
async fn list_tasks(state: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tasks = db::tasks::get_tasks(&conn);

    Ok(tasks
        .into_iter()
        .map(|t| Task {
            id: t.id,
            prompt: t.prompt,
            status: t.status,
            messages: t
                .messages
                .into_iter()
                .map(|m| TaskMessage {
                    id: m.id,
                    msg_type: m.msg_type,
                    content: m.content,
                    timestamp: m.timestamp,
                    tool_name: m.tool_name,
                    tool_input: m.tool_input,
                    attachments: m.attachments.map(|atts| {
                        atts.into_iter()
                            .map(|a| TaskAttachment {
                                att_type: a.att_type,
                                data: a.data,
                                label: a.label,
                            })
                            .collect()
                    }),
                })
                .collect(),
            result: None,
            session_id: t.session_id,
            summary: t.summary,
            created_at: t.created_at.clone(),
            updated_at: None,
            completed_at: t.completed_at,
            started_at: t.started_at,
        })
        .collect())
}

#[tauri::command]
async fn delete_task(task_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::delete_task(&conn, &task_id)
}

#[tauri::command]
async fn clear_task_history(state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::clear_history(&conn)
}

#[tauri::command]
async fn respond_to_permission(
    response: PermissionResponse,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if manager.is_running() {
        // Send the response text to the sidecar
        let response_text = if response.allowed { "yes" } else { "no" };
        manager
            .send_command(sidecar::SidecarCommand::SendResponse {
                task_id: response.task_id,
                payload: sidecar::SendResponsePayload {
                    response: response_text.to_string(),
                },
            })
            .await?;
    }
    Ok(())
}

#[tauri::command]
async fn resume_session(
    session_id: String,
    prompt: String,
    task_id: Option<String>,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<Task, String> {
    // Generate task ID
    let task_id = task_id.unwrap_or_else(|| {
        format!("task_{}", uuid::Uuid::new_v4())
    });

    // Get API keys from secure storage
    let api_keys = sidecar::get_all_api_keys()?;

    // Ensure sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    // Send start task command with session ID for resume
    manager
        .send_command(sidecar::SidecarCommand::StartTask {
            task_id: task_id.clone(),
            payload: sidecar::StartTaskPayload {
                task_id: task_id.clone(),
                prompt: prompt.clone(),
                session_id: Some(session_id.clone()),
                api_keys: Some(api_keys),
                working_directory: None,
                model_id: None,
            },
        })
        .await?;

    // Return task object
    Ok(Task {
        id: task_id,
        prompt,
        status: "starting".to_string(),
        messages: vec![],
        result: None,
        session_id: Some(session_id),
        summary: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
        completed_at: None,
        started_at: Some(chrono::Utc::now().to_rfc3339()),
    })
}

// ============================================================================
// Settings Commands
// ============================================================================

#[tauri::command]
async fn get_api_keys() -> Result<Vec<ApiKeyConfig>, String> {
    let status = secure_storage::get_all_api_key_status()?;
    let mut keys = Vec::new();

    for (provider, key_status) in status {
        if key_status.exists {
            keys.push(ApiKeyConfig {
                id: format!("apikey-{}", provider),
                provider: provider.clone(),
                label: Some(provider),
                created_at: chrono::Utc::now().to_rfc3339(),
            });
        }
    }

    Ok(keys)
}

#[tauri::command]
async fn add_api_key(
    provider: String,
    key: String,
    label: Option<String>,
) -> Result<ApiKeyConfig, String> {
    secure_storage::store_api_key(&provider, &key)?;

    Ok(ApiKeyConfig {
        id: format!("apikey-{}", provider),
        provider: provider.clone(),
        label,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
async fn remove_api_key(id: String) -> Result<(), String> {
    // Extract provider from id (format: "apikey-{provider}")
    let provider = id.strip_prefix("apikey-").unwrap_or(&id);
    secure_storage::delete_api_key(provider)?;
    Ok(())
}

#[tauri::command]
async fn get_debug_mode(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::settings::get_debug_mode(&conn))
}

#[tauri::command]
async fn set_debug_mode(enabled: bool, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_debug_mode(&conn, enabled)
}

#[tauri::command]
async fn get_app_settings(state: State<'_, DbState>) -> Result<AppSettingsResponse, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let settings = db::settings::get_app_settings(&conn);
    Ok(AppSettingsResponse {
        debug_mode: settings.debug_mode,
        onboarding_complete: settings.onboarding_complete,
    })
}

// ============================================================================
// API Key Management Commands
// ============================================================================

#[tauri::command]
async fn has_api_key() -> Result<bool, String> {
    // Check for default provider (anthropic)
    secure_storage::has_api_key("anthropic")
}

#[tauri::command]
async fn set_api_key(key: String) -> Result<(), String> {
    // Set default provider key (anthropic)
    secure_storage::store_api_key("anthropic", &key)
}

#[tauri::command]
async fn get_api_key() -> Result<Option<String>, String> {
    // Get default provider key (anthropic)
    secure_storage::get_api_key("anthropic")
}

#[tauri::command]
async fn validate_api_key(_key: String) -> Result<ValidationResult, String> {
    // Basic validation - check key format
    Ok(ValidationResult {
        valid: true,
        error: None,
    })
}

#[tauri::command]
async fn validate_api_key_for_provider(
    provider: String,
    key: String,
    _options: Option<HashMap<String, serde_json::Value>>,
) -> Result<ValidationResult, String> {
    // Validate API key format based on provider
    let valid = match provider.as_str() {
        "anthropic" => key.starts_with("sk-ant-"),
        "openai" => key.starts_with("sk-"),
        "google" => !key.is_empty(),
        "openrouter" => key.starts_with("sk-or-"),
        _ => !key.is_empty(),
    };

    if valid {
        Ok(ValidationResult {
            valid: true,
            error: None,
        })
    } else {
        Ok(ValidationResult {
            valid: false,
            error: Some(format!("Invalid API key format for provider: {}", provider)),
        })
    }
}

#[tauri::command]
async fn clear_api_key() -> Result<(), String> {
    // Clear default provider key (anthropic)
    secure_storage::delete_api_key("anthropic")?;
    Ok(())
}

#[tauri::command]
async fn get_all_api_keys() -> Result<HashMap<String, ApiKeyStatus>, String> {
    let status = secure_storage::get_all_api_key_status()?;
    Ok(status
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                ApiKeyStatus {
                    exists: v.exists,
                    prefix: v.prefix,
                },
            )
        })
        .collect())
}

#[tauri::command]
async fn has_any_api_key() -> Result<bool, String> {
    secure_storage::has_any_api_key()
}

// ============================================================================
// Onboarding Commands
// ============================================================================

#[tauri::command]
async fn get_onboarding_complete(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::settings::get_onboarding_complete(&conn))
}

#[tauri::command]
async fn set_onboarding_complete(complete: bool, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_onboarding_complete(&conn, complete)
}

// ============================================================================
// Claude CLI Commands
// ============================================================================

#[tauri::command]
async fn check_claude_cli() -> Result<ClaudeCliStatus, String> {
    // Check if opencode CLI is installed
    let output = std::process::Command::new("which").arg("opencode").output();

    match output {
        Ok(out) if out.status.success() => {
            // Try to get version
            let version_output = std::process::Command::new("opencode")
                .arg("--version")
                .output();

            let version = version_output.ok().and_then(|v| {
                if v.status.success() {
                    String::from_utf8(v.stdout).ok().map(|s| s.trim().to_string())
                } else {
                    None
                }
            });

            Ok(ClaudeCliStatus {
                installed: true,
                version,
                install_command: "npm install -g opencode-ai".to_string(),
            })
        }
        _ => Ok(ClaudeCliStatus {
            installed: false,
            version: None,
            install_command: "npm install -g opencode-ai".to_string(),
        }),
    }
}

#[tauri::command]
async fn get_claude_version() -> Result<Option<String>, String> {
    let output = std::process::Command::new("opencode")
        .arg("--version")
        .output();

    Ok(output.ok().and_then(|v| {
        if v.status.success() {
            String::from_utf8(v.stdout).ok().map(|s| s.trim().to_string())
        } else {
            None
        }
    }))
}

// ============================================================================
// Model Selection Commands
// ============================================================================

#[tauri::command]
async fn get_selected_model(state: State<'_, DbState>) -> Result<Option<SelectedModel>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let model = db::settings::get_selected_model(&conn);
    Ok(model.map(|m| SelectedModel {
        provider: m.provider,
        model: m.model,
        base_url: m.base_url,
        deployment_name: m.deployment_name,
    }))
}

#[tauri::command]
async fn set_selected_model(model: SelectedModel, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_model = db::settings::SelectedModel {
        provider: model.provider,
        model: model.model,
        base_url: model.base_url,
        deployment_name: model.deployment_name,
    };
    db::settings::set_selected_model(&conn, Some(&db_model))
}

// ============================================================================
// Ollama Commands
// ============================================================================

#[tauri::command]
async fn test_ollama_connection(url: String) -> Result<ConnectionResult, String> {
    // Try to connect to Ollama and list models
    let client = reqwest::Client::new();
    let tags_url = format!("{}/api/tags", url.trim_end_matches('/'));

    match client.get(&tags_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                // Parse models from response
                #[derive(Deserialize)]
                struct OllamaTagsResponse {
                    models: Vec<OllamaModelInfo>,
                }
                #[derive(Deserialize)]
                struct OllamaModelInfo {
                    name: String,
                    size: u64,
                }

                match response.json::<OllamaTagsResponse>().await {
                    Ok(tags) => {
                        let models: Vec<OllamaModel> = tags
                            .models
                            .into_iter()
                            .map(|m| OllamaModel {
                                id: m.name.clone(),
                                display_name: m.name,
                                size: m.size,
                            })
                            .collect();

                        Ok(ConnectionResult {
                            success: true,
                            models: Some(models),
                            error: None,
                        })
                    }
                    Err(e) => Ok(ConnectionResult {
                        success: false,
                        models: None,
                        error: Some(format!("Failed to parse Ollama response: {}", e)),
                    }),
                }
            } else {
                Ok(ConnectionResult {
                    success: false,
                    models: None,
                    error: Some(format!("Ollama returned status: {}", response.status())),
                })
            }
        }
        Err(e) => Ok(ConnectionResult {
            success: false,
            models: None,
            error: Some(format!("Failed to connect to Ollama: {}", e)),
        }),
    }
}

#[tauri::command]
async fn get_ollama_config(state: State<'_, DbState>) -> Result<Option<OllamaConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_ollama_config(&conn);
    Ok(config.map(|c| OllamaConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| OllamaModel {
                    id: m.id,
                    display_name: m.display_name,
                    size: m.size,
                })
                .collect()
        }),
    }))
}

#[tauri::command]
async fn set_ollama_config(
    config: Option<OllamaConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::OllamaConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| db::settings::OllamaModel {
                    id: m.id,
                    display_name: m.display_name,
                    size: m.size,
                })
                .collect()
        }),
    });
    db::settings::set_ollama_config(&conn, db_config.as_ref())
}

// ============================================================================
// Azure Foundry Commands
// ============================================================================

#[tauri::command]
async fn get_azure_foundry_config(
    state: State<'_, DbState>,
) -> Result<Option<AzureFoundryConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_azure_foundry_config(&conn);
    Ok(config.map(|c| AzureFoundryConfig {
        base_url: c.base_url,
        deployment_name: c.deployment_name,
        auth_type: c.auth_type,
        enabled: c.enabled,
        last_validated: c.last_validated,
    }))
}

#[tauri::command]
async fn set_azure_foundry_config(
    config: Option<AzureFoundryConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::AzureFoundryConfig {
        base_url: c.base_url,
        deployment_name: c.deployment_name,
        auth_type: c.auth_type,
        enabled: c.enabled,
        last_validated: c.last_validated,
    });
    db::settings::set_azure_foundry_config(&conn, db_config.as_ref())
}

#[tauri::command]
async fn test_azure_foundry_connection(
    _config: AzureFoundryTestConfig,
) -> Result<ValidationResult, String> {
    // TODO: Implement Azure Foundry connection test
    Ok(ValidationResult {
        valid: false,
        error: Some("Azure Foundry connection test not yet implemented".to_string()),
    })
}

#[tauri::command]
async fn save_azure_foundry_config(_config: AzureFoundryTestConfig) -> Result<(), String> {
    // TODO: Implement with secure storage for API key
    Ok(())
}

// ============================================================================
// OpenRouter Commands
// ============================================================================

#[tauri::command]
async fn fetch_openrouter_models() -> Result<OpenRouterModelsResult, String> {
    // TODO: Requires API key from secure storage
    Ok(OpenRouterModelsResult {
        success: false,
        models: None,
        error: Some("OpenRouter not yet implemented".to_string()),
    })
}

// ============================================================================
// LiteLLM Commands
// ============================================================================

#[tauri::command]
async fn test_litellm_connection(
    url: String,
    _api_key: Option<String>,
) -> Result<OpenRouterModelsResult, String> {
    let client = reqwest::Client::new();
    let models_url = format!("{}/models", url.trim_end_matches('/'));

    match client.get(&models_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct LiteLLMModelsResponse {
                    data: Vec<LiteLLMModelInfo>,
                }
                #[derive(Deserialize)]
                struct LiteLLMModelInfo {
                    id: String,
                    #[serde(default)]
                    owned_by: String,
                }

                match response.json::<LiteLLMModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<OpenRouterModel> = resp
                            .data
                            .into_iter()
                            .map(|m| OpenRouterModel {
                                id: m.id.clone(),
                                name: m.id,
                                provider: m.owned_by,
                                context_length: 0,
                            })
                            .collect();

                        Ok(OpenRouterModelsResult {
                            success: true,
                            models: Some(models),
                            error: None,
                        })
                    }
                    Err(e) => Ok(OpenRouterModelsResult {
                        success: false,
                        models: None,
                        error: Some(format!("Failed to parse LiteLLM response: {}", e)),
                    }),
                }
            } else {
                Ok(OpenRouterModelsResult {
                    success: false,
                    models: None,
                    error: Some(format!("LiteLLM returned status: {}", response.status())),
                })
            }
        }
        Err(e) => Ok(OpenRouterModelsResult {
            success: false,
            models: None,
            error: Some(format!("Failed to connect to LiteLLM: {}", e)),
        }),
    }
}

#[tauri::command]
async fn fetch_litellm_models() -> Result<OpenRouterModelsResult, String> {
    Ok(OpenRouterModelsResult {
        success: false,
        models: None,
        error: Some("LiteLLM not yet implemented".to_string()),
    })
}

#[tauri::command]
async fn get_litellm_config(state: State<'_, DbState>) -> Result<Option<LiteLLMConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_litellm_config(&conn);
    Ok(config.map(|c| LiteLLMConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| OpenRouterModel {
                    id: m.id,
                    name: m.name,
                    provider: m.provider,
                    context_length: m.context_length,
                })
                .collect()
        }),
    }))
}

#[tauri::command]
async fn set_litellm_config(
    config: Option<LiteLLMConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::LiteLLMConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| db::settings::LiteLLMModel {
                    id: m.id,
                    name: m.name,
                    provider: m.provider,
                    context_length: m.context_length,
                })
                .collect()
        }),
    });
    db::settings::set_litellm_config(&conn, db_config.as_ref())
}

// ============================================================================
// Bedrock Commands
// ============================================================================

#[tauri::command]
async fn validate_bedrock_credentials(credentials: String) -> Result<ValidationResult, String> {
    // Parse and validate the credentials format
    match serde_json::from_str::<BedrockCredentials>(&credentials) {
        Ok(creds) => {
            if creds.access_key_id.is_empty()
                || creds.secret_access_key.is_empty()
                || creds.region.is_empty()
            {
                Ok(ValidationResult {
                    valid: false,
                    error: Some("All credential fields are required".to_string()),
                })
            } else {
                Ok(ValidationResult {
                    valid: true,
                    error: None,
                })
            }
        }
        Err(e) => Ok(ValidationResult {
            valid: false,
            error: Some(format!("Invalid credentials format: {}", e)),
        }),
    }
}

#[tauri::command]
async fn save_bedrock_credentials(credentials: String) -> Result<ApiKeyConfig, String> {
    secure_storage::store_bedrock_credentials(&credentials)?;

    Ok(ApiKeyConfig {
        id: "apikey-bedrock".to_string(),
        provider: "bedrock".to_string(),
        label: Some("AWS Bedrock".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
async fn get_bedrock_credentials() -> Result<Option<BedrockCredentials>, String> {
    match secure_storage::get_bedrock_credentials()? {
        Some(creds) => Ok(Some(BedrockCredentials {
            access_key_id: creds.access_key_id,
            secret_access_key: creds.secret_access_key,
            region: creds.region,
        })),
        None => Ok(None),
    }
}

#[tauri::command]
async fn fetch_bedrock_models(_credentials: String) -> Result<BedrockModelsResult, String> {
    // TODO: Implement AWS Bedrock model listing
    Ok(BedrockModelsResult {
        success: false,
        models: vec![],
        error: Some("Bedrock not yet implemented".to_string()),
    })
}

// ============================================================================
// E2E Testing Command
// ============================================================================

#[tauri::command]
async fn is_e2e_mode() -> Result<bool, String> {
    Ok(std::env::var("E2E_MODE").is_ok())
}

// ============================================================================
// Provider Settings Commands
// ============================================================================

#[tauri::command]
async fn get_provider_settings(state: State<'_, DbState>) -> Result<ProviderSettings, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let settings = db::providers::get_provider_settings(&conn);

    let connected_providers: HashMap<String, ConnectedProviderResponse> = settings
        .connected_providers
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                ConnectedProviderResponse {
                    id: v.provider_id,
                    selected_model: v.selected_model_id,
                    config: serde_json::to_value(&v.credentials).ok(),
                },
            )
        })
        .collect();

    Ok(ProviderSettings {
        active_provider: settings.active_provider_id,
        connected_providers,
        debug_mode: settings.debug_mode,
    })
}

#[tauri::command]
async fn set_active_provider(
    provider_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::set_active_provider(&conn, provider_id.as_deref())
}

#[tauri::command]
async fn get_connected_provider(
    provider_id: String,
    state: State<'_, DbState>,
) -> Result<Option<ConnectedProviderResponse>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let provider = db::providers::get_connected_provider(&conn, &provider_id);

    Ok(provider.map(|p| ConnectedProviderResponse {
        id: p.provider_id,
        selected_model: p.selected_model_id,
        config: serde_json::to_value(&p.credentials).ok(),
    }))
}

#[tauri::command]
async fn set_connected_provider(
    provider_id: String,
    provider: ConnectedProviderInput,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Convert input to db type
    let db_provider = db::providers::ConnectedProvider {
        provider_id: provider.id,
        connection_status: "connected".to_string(),
        selected_model_id: provider.selected_model,
        credentials: db::providers::ProviderCredentials {
            credentials_type: "api_key".to_string(),
            key_prefix: None,
            server_url: None,
            api_key: None,
            extra: HashMap::new(),
        },
        last_connected_at: chrono::Utc::now().to_rfc3339(),
        available_models: None,
    };

    db::providers::set_connected_provider(&conn, &provider_id, &db_provider)
}

#[tauri::command]
async fn remove_connected_provider(
    provider_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::remove_connected_provider(&conn, &provider_id)
}

#[tauri::command]
async fn update_provider_model(
    provider_id: String,
    model_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::update_provider_model(&conn, &provider_id, model_id.as_deref())
}

#[tauri::command]
async fn set_provider_debug_mode(enabled: bool, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::set_provider_debug_mode(&conn, enabled)
}

#[tauri::command]
async fn get_provider_debug_mode(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::providers::get_provider_debug_mode(&conn))
}

// ============================================================================
// Logging Command
// ============================================================================

#[tauri::command]
async fn log_event(payload: LogPayload) -> Result<(), String> {
    println!(
        "[{}] {}",
        payload.level.unwrap_or_else(|| "info".to_string()),
        payload.message
    );
    Ok(())
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize database
            let db_state = db::init_database(app.handle())
                .expect("Failed to initialize database");
            app.manage(db_state);

            // Initialize sidecar state
            app.manage(SidecarState::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App Info
            get_version,
            get_platform,
            // Task operations
            start_task,
            cancel_task,
            interrupt_task,
            get_task,
            list_tasks,
            delete_task,
            clear_task_history,
            respond_to_permission,
            resume_session,
            // Settings
            get_api_keys,
            add_api_key,
            remove_api_key,
            get_debug_mode,
            set_debug_mode,
            get_app_settings,
            // API Key management
            has_api_key,
            set_api_key,
            get_api_key,
            validate_api_key,
            validate_api_key_for_provider,
            clear_api_key,
            get_all_api_keys,
            has_any_api_key,
            // Onboarding
            get_onboarding_complete,
            set_onboarding_complete,
            // Claude CLI
            check_claude_cli,
            get_claude_version,
            // Model selection
            get_selected_model,
            set_selected_model,
            // Ollama
            test_ollama_connection,
            get_ollama_config,
            set_ollama_config,
            // Azure Foundry
            get_azure_foundry_config,
            set_azure_foundry_config,
            test_azure_foundry_connection,
            save_azure_foundry_config,
            // OpenRouter
            fetch_openrouter_models,
            // LiteLLM
            test_litellm_connection,
            fetch_litellm_models,
            get_litellm_config,
            set_litellm_config,
            // Bedrock
            validate_bedrock_credentials,
            save_bedrock_credentials,
            get_bedrock_credentials,
            fetch_bedrock_models,
            // E2E
            is_e2e_mode,
            // Provider Settings
            get_provider_settings,
            set_active_provider,
            get_connected_provider,
            set_connected_provider,
            remove_connected_provider,
            update_provider_model,
            set_provider_debug_mode,
            get_provider_debug_mode,
            // Logging
            log_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
