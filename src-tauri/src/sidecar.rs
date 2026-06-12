//! Sidecar Manager - Manages the Node.js sidecar process for OpenCode CLI integration
//!
//! The sidecar communicates via JSON-line messages over stdin/stdout.

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
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
    #[serde(rename = "get_mcp_status")]
    GetMcpStatus,
    #[serde(rename = "get_mcp_tools")]
    GetMcpTools,
    #[serde(rename = "connect_mcp_server")]
    ConnectMcpServer {
        payload: McpServerNamePayload,
    },
    #[serde(rename = "disconnect_mcp_server")]
    DisconnectMcpServer {
        payload: McpServerNamePayload,
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
    /// Reply to the sidecar's `request_api_keys` event — the only message
    /// that carries key material over IPC, sent solely at server-spawn time
    /// (2026-06-12 review #5).
    #[serde(rename = "api_keys_response")]
    ApiKeysResponse { payload: ApiKeysResponsePayload },
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
    /// Fingerprint of the current keychain credentials — no key material.
    /// The sidecar pulls actual keys via `request_api_keys` only when this
    /// differs from what it last applied (2026-06-12 review #5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys_fingerprint: Option<String>,
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
    /// Skip PATCH /config call (Arena sends config once, subsequent tasks skip)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_config: Option<bool>,
    /// Arena ID — prevents cleanup of sibling sessions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arena_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSessionPayload {
    pub task_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// See `StartTaskPayload::api_keys_fingerprint`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_keys_fingerprint: Option<String>,
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
    /// Skip PATCH /config call (Arena sends config once, subsequent tasks skip)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_config: Option<bool>,
    /// Arena ID — prevents cleanup of sibling sessions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arena_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeysResponsePayload {
    pub request_id: String,
    pub api_keys: ApiKeys,
    /// Fingerprint of `api_keys`, so the sidecar can record what it applied
    /// without ever computing hashes over key material itself.
    pub fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMcpConfigPayload {
    pub mcp_servers: serde_json::Value,
    /// Active workspace directory — the sidecar forwards this as
    /// `?directory=<path>` so the PATCH /config reaches the correct
    /// per-workspace OpenCode server instance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerNamePayload {
    pub name: String,
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
    /// Set by the stdout reader task when the sidecar process terminates.
    exited: Arc<AtomicBool>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            is_ready: false,
            log_file: None,
            exited: Arc::new(AtomicBool::new(false)),
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
            let _ = writeln!(
                file,
                "[{}] Sidecar process spawned successfully",
                Local::now().format("%H:%M:%S%.3f")
            );
        }

        // Clone app handle and log file for event forwarding
        let app_handle = app.clone();
        let log_file_clone = Arc::clone(&log_file);
        self.exited.store(false, Ordering::SeqCst);
        let exited = Arc::clone(&self.exited);

        // Spawn stdout reader task
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let line_str = String::from_utf8_lossy(&line);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = write!(
                                file,
                                "[{}] [stdout] {}",
                                Local::now().format("%H:%M:%S%.3f"),
                                line_str
                            );
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
                            let _ = write!(
                                file,
                                "[{}] [stderr] {}",
                                Local::now().format("%H:%M:%S%.3f"),
                                line_str
                            );
                        }
                    }
                    CommandEvent::Error(err) => {
                        eprintln!("[sidecar error] {}", err);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = writeln!(
                                file,
                                "[{}] ERROR: {}",
                                Local::now().format("%H:%M:%S%.3f"),
                                err
                            );
                        }
                        let _ = app_handle.emit("sidecar:error", &err);
                    }
                    CommandEvent::Terminated(payload) => {
                        exited.store(true, Ordering::SeqCst);
                        println!("[sidecar] terminated with code: {:?}", payload.code);
                        // Write to log file
                        if let Ok(mut file) = log_file_clone.lock() {
                            let _ = writeln!(
                                file,
                                "[{}] Sidecar terminated with code: {:?}",
                                Local::now().format("%H:%M:%S%.3f"),
                                payload.code
                            );
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
            SidecarCommand::GetMcpStatus => "get_mcp_status",
            SidecarCommand::GetMcpTools => "get_mcp_tools",
            SidecarCommand::ConnectMcpServer { .. } => "connect_mcp_server",
            SidecarCommand::DisconnectMcpServer { .. } => "disconnect_mcp_server",
            SidecarCommand::CopilotOAuthAuthorize { .. } => "copilot_oauth_authorize",
            SidecarCommand::CopilotGetModels => "copilot_get_models",
            SidecarCommand::CopilotDisconnect => "copilot_disconnect",
            SidecarCommand::ApiKeysResponse { .. } => "api_keys_response",
            SidecarCommand::Ping => "ping",
            SidecarCommand::CheckServer => "check_server",
        };

        let child = self.child.as_mut().ok_or("Sidecar not running")?;

        let json = serde_json::to_string(&cmd)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;

        child
            .write((json + "\n").as_bytes())
            .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;

        Ok(())
    }

    /// Handle events from the sidecar and forward to frontend
    fn handle_sidecar_event(app: &AppHandle, event: SidecarEvent) {
        // Narrow key bridge (2026-06-12 review #5): the sidecar requests
        // credentials only when it is about to (re)spawn the OpenCode
        // server. Keys are loaded from the keychain at that moment and sent
        // back over stdin; they never ride along on task payloads. Not
        // forwarded to the frontend.
        if event.event_type == "request_api_keys" {
            let request_id = event
                .payload
                .as_ref()
                .and_then(|p| p.get("requestId"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let api_keys = match get_all_api_keys() {
                    Ok(keys) => keys,
                    Err(e) => {
                        eprintln!("[sidecar] failed to load API keys for request: {}", e);
                        ApiKeys::default()
                    }
                };
                let fingerprint = fingerprint_api_keys(&api_keys);
                let state = app.state::<SidecarState>();
                let mut manager = state.manager.lock().await;
                if let Err(e) = manager
                    .send_command(SidecarCommand::ApiKeysResponse {
                        payload: ApiKeysResponsePayload {
                            request_id,
                            api_keys,
                            fingerprint,
                        },
                    })
                    .await
                {
                    eprintln!("[sidecar] failed to send api_keys_response: {}", e);
                }
            });
            return;
        }

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
            "task_complete" => {
                // Drive completion directly from Rust so that automation lifecycle
                // (mark_automation_run_complete -> release is_running -> drain pending)
                // does not depend on the frontend's `task:complete` listener, which
                // gets throttled by macOS WKWebView when the app is backgrounded
                // in release builds.
                if let (Some(task_id), Some(payload)) = (&event.task_id, &event.payload) {
                    let sidecar_status = payload
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("");
                    // Keep in sync with the sidecar's TaskCompletePayload status union
                    // ('success' | 'error' | 'cancelled' | 'aborted') and the frontend
                    // mapping in src/lib/tauri-api.ts (aborted/cancelled => interrupted).
                    let mapped_status = match sidecar_status {
                        "success" => "completed",
                        "aborted" | "cancelled" | "interrupted" => "interrupted",
                        _ => "failed",
                    };
                    let session_id = payload.get("sessionId").and_then(|s| s.as_str());
                    if let Err(e) = crate::commands::tasks::handle_task_completion_internal(
                        app,
                        task_id,
                        mapped_status,
                        session_id,
                    ) {
                        eprintln!(
                            "[sidecar] handle_task_completion_internal failed for {}: {}",
                            task_id, e
                        );
                    }
                }
                "task:complete"
            }
            "task_error" => "task:error",
            "todo_updated" => "task:todo_updated",
            "mcp_status" => "mcp:status",
            "mcp_tools" => "mcp:tools",
            "mcp_tools_changed" => "mcp:tools_changed",
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

    /// Stop the sidecar process gracefully.
    ///
    /// Sends the `shutdown` command over stdin so the sidecar can terminate its
    /// `opencode serve` child, then waits for the sidecar to exit on its own
    /// before falling back to a hard kill. The sidecar's own shutdown sequence
    /// (HTTP dispose → SIGTERM → SIGKILL fallback) can take up to ~10s in the
    /// worst case; the normal path completes in well under a second.
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            // Send shutdown command via stdin so sidecar can clean up child processes
            let shutdown_cmd = serde_json::json!({"type": "shutdown"});
            let json = serde_json::to_string(&shutdown_cmd).unwrap_or_default();
            let _ = child.write((json + "\n").as_bytes());

            const MAX_WAIT_MS: u64 = 12_000;
            const POLL_MS: u64 = 100;
            let mut waited: u64 = 0;
            while !self.exited.load(Ordering::SeqCst) && waited < MAX_WAIT_MS {
                tokio::time::sleep(std::time::Duration::from_millis(POLL_MS)).await;
                waited += POLL_MS;
            }

            if self.exited.load(Ordering::SeqCst) {
                println!("[sidecar] shut down gracefully after {}ms", waited);
            } else {
                eprintln!("[sidecar] graceful shutdown timed out, force killing");
                let _ = child.kill();
            }
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

/// Stable SHA-256 fingerprint of an `ApiKeys` set. Mirrors the scheme the
/// sidecar previously used (`api-key-fingerprint.ts`): sorted
/// `[name, value]` entries for non-empty string keys (JSON field names),
/// plus a combined bedrock entry, hashed as a JSON array. The digest
/// contains no key material, so it is safe to send per task and to log.
pub fn fingerprint_api_keys(keys: &ApiKeys) -> String {
    use sha2::{Digest, Sha256};

    let mut entries: Vec<(&str, String)> = Vec::new();
    let string_keys: [(&str, &Option<String>); 9] = [
        ("anthropic", &keys.anthropic),
        ("openai", &keys.openai),
        ("google", &keys.google),
        ("xai", &keys.xai),
        ("deepseek", &keys.deepseek),
        ("openrouter", &keys.openrouter),
        ("litellm", &keys.litellm),
        ("ollama", &keys.ollama),
        ("azureFoundry", &keys.azure_foundry),
    ];
    for (name, value) in string_keys {
        if let Some(v) = value {
            if !v.is_empty() {
                entries.push((name, v.clone()));
            }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(b.0));
    if let Some(bedrock) = &keys.bedrock {
        entries.push((
            "bedrock",
            format!(
                "{}:{}:{}",
                bedrock.access_key_id, bedrock.secret_access_key, bedrock.region
            ),
        ));
    }

    let json = serde_json::to_string(&entries).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Load all keys from the keychain, return only their fingerprint, and drop
/// the key material immediately. Task payloads carry this instead of the
/// keys themselves (2026-06-12 review #5).
pub fn current_api_keys_fingerprint() -> Result<String, String> {
    let keys = get_all_api_keys()?;
    Ok(fingerprint_api_keys(&keys))
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
    // Legacy `azureFoundry` entries are migrated to this id at app startup
    // (secure_storage::migrate_legacy_azure_foundry_key), so no fallback here.
    if let Ok(Some(key)) = secure_storage::get_api_key("azure-foundry") {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_stable_and_ignores_empty_strings() {
        let keys = ApiKeys {
            anthropic: Some("sk-ant-1".to_string()),
            openai: Some(String::new()),
            ..Default::default()
        };
        let only_anthropic = ApiKeys {
            anthropic: Some("sk-ant-1".to_string()),
            ..Default::default()
        };
        assert_eq!(fingerprint_api_keys(&keys), fingerprint_api_keys(&only_anthropic));
        assert_eq!(fingerprint_api_keys(&keys), fingerprint_api_keys(&keys));
    }

    #[test]
    fn fingerprint_changes_when_a_key_changes() {
        let a = ApiKeys {
            anthropic: Some("sk-ant-1".to_string()),
            ..Default::default()
        };
        let b = ApiKeys {
            anthropic: Some("sk-ant-2".to_string()),
            ..Default::default()
        };
        assert_ne!(fingerprint_api_keys(&a), fingerprint_api_keys(&b));
        assert_ne!(fingerprint_api_keys(&a), fingerprint_api_keys(&ApiKeys::default()));
    }

    #[test]
    fn fingerprint_includes_bedrock_credentials() {
        let with_bedrock = ApiKeys {
            bedrock: Some(BedrockCredentials {
                access_key_id: "AKIA".to_string(),
                secret_access_key: "s3cret".to_string(),
                region: "us-east-1".to_string(),
            }),
            ..Default::default()
        };
        let fp = fingerprint_api_keys(&with_bedrock);
        assert_ne!(fp, fingerprint_api_keys(&ApiKeys::default()));
        // The fingerprint is a hex digest — never contains key material
        assert!(!fp.contains("s3cret"));
        assert_eq!(fp.len(), 64);
    }
}
