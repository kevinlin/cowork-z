//! Sidecar Manager - Manages the Node.js sidecar process for OpenCode CLI integration
//!
//! The sidecar communicates via JSON-line messages over stdin/stdout.

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
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

/// Commands sent to the sidecar (matches sidecar-opencode IPC protocol)
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarCommand {
    StartTask {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: StartTaskPayload,
    },
    ResumeSession {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: ResumeSessionPayload,
    },
    CancelTask {
        #[serde(rename = "taskId")]
        task_id: String,
    },
    AbortSession {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SendPermissionReply {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: PermissionReplyPayload,
    },
    SendQuestionReply {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: QuestionReplyPayload,
    },
    GetSessionTodos {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    UpdateMcpConfig {
        payload: UpdateMcpConfigPayload,
    },
    #[serde(rename = "copilot_oauth_authorize")]
    CopilotOAuthAuthorize {
        #[serde(rename = "enterpriseUrl")]
        enterprise_url: Option<String>,
    },
    #[serde(rename = "copilot_get_models")]
    CopilotGetModels,
    #[serde(rename = "copilot_disconnect")]
    CopilotDisconnect,
    #[allow(dead_code)]
    Ping,
    /// Health check command sent to sidecar
    #[allow(dead_code)] // Used in sidecar IPC (TypeScript), not constructed in Rust
    CheckServer,
}

/// Folder permission payload sent to sidecar
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPermissionPayload {
    pub path: String,
    pub access_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskPayload {
    pub task_id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys: Option<ApiKeys>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_permissions: Option<Vec<FolderPermissionPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSessionPayload {
    pub task_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys: Option<ApiKeys>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_permissions: Option<Vec<FolderPermissionPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMcpConfigPayload {
    pub mcp_servers: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionReplyPayload {
    pub request_id: String,
    pub reply: String, // "once" | "always" | "reject"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionReplyPayload {
    pub request_id: String,
    pub answers: Vec<QuestionAnswer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnswer {
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_text: Option<String>,
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

/// Creates a log file in ~/.opencode directory
/// Filename format: {datetime}_{session_id}_{task_id}.log (session_id and task_id are optional)
/// Returns the log file wrapped in Arc<Mutex> for thread-safe access
fn create_log_file(
    session_id: Option<&str>,
    task_id: Option<&str>,
) -> Result<Arc<std::sync::Mutex<File>>, String> {
    let log_dir = if cfg!(target_os = "windows") {
        // Windows: %LOCALAPPDATA%\opencode\log
        dirs::data_local_dir()
            .ok_or("Could not determine local app data directory")?
            .join("opencode")
            .join("log")
    } else {
        // macOS/Linux: ~/.local/share/opencode/log
        dirs::home_dir()
            .ok_or("Could not determine home directory")?
            .join(".local")
            .join("share")
            .join("opencode")
            .join("log")
    };
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory: {}", e))?;

    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S_RS");

    // Build filename: {datetime}_{session_id}_{task_id}.log
    let mut filename = timestamp.to_string();
    if let Some(sid) = session_id {
        filename.push('_');
        filename.push_str(sid);
    }
    if let Some(tid) = task_id {
        filename.push('_');
        filename.push_str(tid);
    }
    filename.push_str(".log");

    let log_path = log_dir.join(&filename);
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to create log file: {}", e))?;

    let log_file = Arc::new(std::sync::Mutex::new(log_file));

    // Write header to log file
    {
        let mut file = log_file.lock().unwrap();
        let _ = writeln!(file, "=== Sidecar Log Started: {} ===", Local::now());
        let _ = writeln!(file, "Log file: {}", log_path.display());
        if let Some(sid) = session_id {
            let _ = writeln!(file, "Session ID: {}", sid);
        }
        if let Some(tid) = task_id {
            let _ = writeln!(file, "Task ID: {}", tid);
        }
    }

    Ok(log_file)
}

/// Manages the sidecar process lifecycle
pub struct SidecarManager {
    child: Option<CommandChild>,
    is_ready: bool,
    log_file: Option<Arc<std::sync::Mutex<File>>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            is_ready: false,
            log_file: None,
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
        let _current_exe = std::env::current_exe().ok();
        let current_dir = std::env::current_dir().ok();
        let candidate_names: Vec<&str> = if cfg!(target_os = "macos") {
            vec![
                "sidecar-opencode-aarch64-apple-darwin",
                "sidecar-opencode-x86_64-apple-darwin",
                "sidecar-opencode",
            ]
        } else if cfg!(target_os = "windows") {
            vec![
                "sidecar-opencode-x86_64-pc-windows-msvc.exe",
                "sidecar-opencode.exe",
            ]
        } else {
            // Linux
            vec![
                "sidecar-opencode-aarch64-unknown-linux-gnu",
                "sidecar-opencode-x86_64-unknown-linux-gnu",
                "sidecar-opencode",
            ]
        };
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

        // Create log file in ~/.opencode directory
        let log_file = create_log_file(None, None)?;
        self.log_file = Some(Arc::clone(&log_file));

        let shell = app.shell();

        // Spawn the sidecar
        let (mut rx, child) = shell
            .sidecar("sidecar-opencode")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        // Log spawn success
        {
            let mut file = log_file.lock().unwrap();
            let _ = writeln!(file, "[{}] Sidecar process spawned successfully", Local::now().format("%H:%M:%S%.3f"));
        }

        // Clone app handle and log file for event forwarding
        let app_handle = app.clone();
        let log_file_clone = Arc::clone(&log_file);

        // Spawn stdout reader task
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = write!(file, "[{}] [stdout] {}", Local::now().format("%H:%M:%S%.3f"), line_str);
                        }
                        for json_line in line_str.lines() {
                            if let Ok(event) = serde_json::from_str::<SidecarEvent>(json_line) {
                                Self::handle_sidecar_event(&app_handle, event);
                            }
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        eprintln!("[sidecar stderr] {}", line_str);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = write!(file, "[{}] [stderr] {}", Local::now().format("%H:%M:%S%.3f"), line_str);
                        }
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[sidecar error] {}", err);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = writeln!(file, "[{}] ERROR: {}", Local::now().format("%H:%M:%S%.3f"), err);
                        }
                        let _ = app_handle.emit("sidecar:error", &err);
                    }
                    CommandEvent::Terminated(payload) => {
                        println!(
                            "[sidecar] terminated with code: {:?}",
                            payload.code
                        );
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = writeln!(file, "[{}] Sidecar terminated with code: {:?}", Local::now().format("%H:%M:%S%.3f"), payload.code);
                            let _ = writeln!(file, "=== Sidecar Log Ended: {} ===", Local::now());
                        }
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
        let _cmd_type = match &cmd {
            SidecarCommand::StartTask { .. } => "start_task",
            SidecarCommand::ResumeSession { .. } => "resume_session",
            SidecarCommand::CancelTask { .. } => "cancel_task",
            SidecarCommand::AbortSession { .. } => "abort_session",
            SidecarCommand::SendPermissionReply { .. } => "send_permission_reply",
            SidecarCommand::SendQuestionReply { .. } => "send_question_reply",
            SidecarCommand::GetSessionTodos { .. } => "get_session_todos",
            SidecarCommand::UpdateMcpConfig { .. } => "update_mcp_config",
            SidecarCommand::CopilotOAuthAuthorize { .. } => "copilot_oauth_authorize",
            SidecarCommand::CopilotGetModels => "copilot_get_models",
            SidecarCommand::CopilotDisconnect => "copilot_disconnect",
            SidecarCommand::Ping => "ping",
            SidecarCommand::CheckServer => "check_server",
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
        let event_name = match event.event_type.as_str() {
            "ready" => "sidecar:ready",
            "pong" => "sidecar:pong",
            "server_status" => "sidecar:server_status",
            "task_started" => "task:started",
            "task_message" => "task:message",
            "task_message_partial" => "task:message:partial",
            "task_message_complete" => "task:message:complete",
            "task_progress" => "task:progress",
            "permission_request" => "task:permission_request",
            "question_request" => "task:question_request",
            "task_complete" => "task:complete",
            "task_error" => "task:error",
            "todo_updated" => "task:todo_updated",
            "copilot_oauth_result" => "copilot:oauth_result",
            "copilot_oauth_complete" => "copilot:oauth_complete",
            "copilot_models_result" => "copilot:models_result",
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
    #[allow(dead_code)]
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            // Send shutdown command via stdin so sidecar can clean up child processes
            let shutdown_cmd = serde_json::json!({"type": "shutdown"});
            let json = serde_json::to_string(&shutdown_cmd).unwrap_or_default();
            let _ = child.write((json + "\n").as_bytes());

            // Give sidecar a moment to shut down gracefully, then force kill
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = child.kill();
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
