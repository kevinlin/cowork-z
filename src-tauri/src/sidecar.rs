//! Sidecar Manager - Manages the Node.js sidecar process for OpenCode CLI integration
//!
//! The sidecar communicates via JSON-line messages over stdin/stdout.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// API keys structure passed to sidecar
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeys {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xai: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deepseek: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openrouter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub litellm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ollama: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub azure_foundry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bedrock: Option<BedrockCredentials>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
}

/// Commands sent to the sidecar
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarCommand {
    StartTask {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: StartTaskPayload,
    },
    CancelTask {
        #[serde(rename = "taskId")]
        task_id: String,
    },
    InterruptTask {
        #[serde(rename = "taskId")]
        task_id: String,
    },
    SendResponse {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: SendResponsePayload,
    },
    Ping,
    CheckCli,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskPayload {
    pub task_id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys: Option<ApiKeys>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SendResponsePayload {
    pub response: String,
}

/// Events received from the sidecar
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SidecarEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "taskId")]
    pub task_id: Option<String>,
    pub payload: Option<serde_json::Value>,
}

/// Manages the sidecar process lifecycle
pub struct SidecarManager {
    child: Option<CommandChild>,
    is_ready: bool,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            is_ready: false,
        }
    }

    /// Check if sidecar is running
    pub fn is_running(&self) -> bool {
        self.child.is_some() && self.is_ready
    }

    /// Spawn the sidecar process
    pub async fn spawn(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_some() {
            return Ok(());
        }

        let resource_dir = app.path().resource_dir().ok();
        let current_exe = std::env::current_exe().ok();
        let current_dir = std::env::current_dir().ok();
        let candidate_names = [
            "cowork-sidecar-aarch64-apple-darwin",
            "cowork-sidecar-x86_64-apple-darwin",
            "cowork-sidecar",
        ];
        let mut candidates = serde_json::Map::new();

        if let Some(dir) = resource_dir.as_ref() {
            for name in &candidate_names {
                let path = dir.join("binaries").join(name);
                let meta = std::fs::metadata(&path).ok();
                candidates.insert(
                    format!("resource_binaries/{}", name),
                    serde_json::json!({
                        "exists": meta.is_some(),
                        "size": meta.as_ref().map(|m| m.len()),
                        "path": path.to_string_lossy().to_string(),
                    }),
                );
            }
        }
        if let Some(dir) = current_dir.as_ref() {
            for name in &candidate_names {
                let path = dir.join("src-tauri").join("binaries").join(name);
                let meta = std::fs::metadata(&path).ok();
                candidates.insert(
                    format!("cwd_src-tauri_binaries/{}", name),
                    serde_json::json!({
                        "exists": meta.is_some(),
                        "size": meta.as_ref().map(|m| m.len()),
                        "path": path.to_string_lossy().to_string(),
                    }),
                );
            }
        }

        let shell = app.shell();

        // Spawn the sidecar
        let (mut rx, child) = shell
            .sidecar("cowork-sidecar")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        // Clone app handle for event forwarding
        let app_handle = app.clone();

        // Spawn stdout reader task
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        let mut parsed = 0;
                        let mut lines = 0;
                        for json_line in line_str.lines() {
                            lines += 1;
                            if let Ok(event) = serde_json::from_str::<SidecarEvent>(json_line) {
                                parsed += 1;
                                Self::handle_sidecar_event(&app_handle, event);
                            }
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        eprintln!("[sidecar stderr] {}", line_str);
                    }
                    CommandEvent::Error(err) => {
                        let err_str = err.to_string();
                        eprintln!("[sidecar error] {}", err);
                        let _ = app_handle.emit("sidecar:error", &err);
                    }
                    CommandEvent::Terminated(payload) => {
                        println!(
                            "[sidecar] terminated with code: {:?}",
                            payload.code
                        );
                        let _ = app_handle.emit("sidecar:terminated", payload.code);
                    }
                    _ => {}
                }
            }
        });

        self.child = Some(child);
        self.is_ready = true;

        Ok(())
    }

    /// Send a command to the sidecar
    pub async fn send_command(&mut self, cmd: SidecarCommand) -> Result<(), String> {
        let (cmd_type, has_task_id) = match &cmd {
            SidecarCommand::StartTask { task_id, .. } => ("start_task", !task_id.is_empty()),
            SidecarCommand::CancelTask { task_id } => ("cancel_task", !task_id.is_empty()),
            SidecarCommand::InterruptTask { task_id } => ("interrupt_task", !task_id.is_empty()),
            SidecarCommand::SendResponse { task_id, .. } => ("send_response", !task_id.is_empty()),
            SidecarCommand::Ping => ("ping", false),
            SidecarCommand::CheckCli => ("check_cli", false),
        };

        let child = self
            .child
            .as_mut()
            .ok_or("Sidecar not running")?;

        let json = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        child
            .write((json + "\n").as_bytes())
            .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;

        Ok(())
    }

    /// Handle events from the sidecar and forward to frontend
    fn handle_sidecar_event(app: &AppHandle, event: SidecarEvent) {
        if matches!(
            event.event_type.as_str(),
            "task_message" | "task_progress" | "task_complete" | "task_error"
        ) {
        }
        let event_name = match event.event_type.as_str() {
            "ready" => "sidecar:ready",
            "pong" => "sidecar:pong",
            "cli_status" => "sidecar:cli_status",
            "task_started" => "task:started",
            "task_message" => "task:message",
            "task_progress" => "task:progress",
            "permission_request" => "task:permission_request",
            "task_complete" => "task:complete",
            "task_error" => "task:error",
            "log" => "sidecar:log",
            "error" => "sidecar:error",
            _ => {
                println!("[sidecar] unknown event type: {}", event.event_type);
                return;
            }
        };

        // Build the payload to emit
        let mut emit_payload = serde_json::json!({});
        if let Some(task_id) = &event.task_id {
            emit_payload["taskId"] = serde_json::json!(task_id);
        }
        if let Some(payload) = event.payload {
            emit_payload["payload"] = payload;
        }

        if let Err(e) = app.emit(event_name, emit_payload) {
            eprintln!("[sidecar] Failed to emit event {}: {}", event_name, e);
        }
    }

    /// Stop the sidecar process
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.take() {
            child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        }
        self.is_ready = false;
        Ok(())
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

/// State for sidecar manager
pub struct SidecarState {
    pub manager: Arc<Mutex<SidecarManager>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(Mutex::new(SidecarManager::new())),
        }
    }
}

impl Default for SidecarState {
    fn default() -> Self {
        Self::new()
    }
}

/// Get all API keys from secure storage
pub fn get_all_api_keys() -> Result<ApiKeys, String> {
    use crate::secure_storage;

    let mut keys = ApiKeys::default();

    // Get individual API keys
    if let Ok(Some(key)) = secure_storage::get_api_key("anthropic") {
        keys.anthropic = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("openai") {
        keys.openai = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("google") {
        keys.google = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("xai") {
        keys.xai = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("deepseek") {
        keys.deepseek = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("openrouter") {
        keys.openrouter = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("litellm") {
        keys.litellm = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("ollama") {
        keys.ollama = Some(key);
    }
    if let Ok(Some(key)) = secure_storage::get_api_key("azureFoundry") {
        keys.azure_foundry = Some(key);
    }

    // Get Bedrock credentials
    if let Ok(Some(creds)) = secure_storage::get_bedrock_credentials() {
        keys.bedrock = Some(BedrockCredentials {
            access_key_id: creds.access_key_id,
            secret_access_key: creds.secret_access_key,
            region: creds.region,
        });
    }

    Ok(keys)
}
