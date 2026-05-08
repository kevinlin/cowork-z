use tauri::{Manager, State};

use crate::db;
use crate::db::DbState;
use crate::sidecar;
use crate::sidecar::SidecarState;
use crate::types::*;

#[tauri::command]
pub async fn start_task(
    config: TaskConfig,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<Task, String> {
    // Resolve model ID from provider settings to avoid interactive CLI prompts
    let resolved_model_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let active_id = db::providers::get_active_provider_id(&conn);
        if let Some(active_id) = active_id {
            if let Some(provider) = db::providers::get_connected_provider(&conn, &active_id) {
                if provider.connection_status == "connected" {
                    if let Some(model_id) = provider.selected_model_id {
                        Some(model_id)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
        .or_else(|| {
            let settings = db::providers::get_provider_settings(&conn);
            settings.connected_providers.values().find_map(|provider| {
                if provider.connection_status == "connected" {
                    provider.selected_model_id.clone()
                } else {
                    None
                }
            })
        })
    };
    // Allow frontend to override model (used by Arena)
    let resolved_model_id = config.model_id.or(resolved_model_id);

    // Generate task ID
    let task_id = config
        .task_id
        .clone()
        .unwrap_or_else(|| format!("task_{}", uuid::Uuid::new_v4()));

    let created_at = chrono::Utc::now().to_rfc3339();
    let started_at = chrono::Utc::now().to_rfc3339();

    // Create initial task record in database
    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::tasks::save_task(
            &conn,
            &db::tasks::TaskInput {
                id: task_id.clone(),
                prompt: config.prompt.clone(),
                status: "starting".to_string(),
                session_id: None,
                summary: None,
                messages: vec![],
                created_at: created_at.clone(),
                started_at: Some(started_at.clone()),
                completed_at: None,
            },
        )?;
    }

    // Assign task to active workspace and get working directory
    let working_directory = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let ws_id = db::settings::get_last_workspace_id(&conn);
        if let Some(ref ws_id) = ws_id {
            let _ = db::workspaces::assign_task_to_workspace(&conn, ws_id, &task_id);
            db::workspaces::get_workspace(&conn, ws_id).map(|w| w.folder_path)
        } else {
            None
        }
    };

    // Load workspace-scoped permissions from database
    let ws_id_for_perms = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
    };
    let workspace_perms = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref ws_id) = ws_id_for_perms {
            db::workspace_permissions::get_workspace_permissions(&conn, ws_id)
        } else {
            vec![]
        }
    };
    let mut sidecar_perms: Option<Vec<sidecar::FolderPermissionPayload>> =
        if workspace_perms.is_empty() {
            None
        } else {
            Some(
                workspace_perms
                    .iter()
                    .map(|wp| sidecar::FolderPermissionPayload {
                        path: wp.folder_path.clone(),
                        access_level: wp.access_level.clone(),
                        source: Some(wp.source.clone()),
                    })
                    .collect(),
            )
        };

    // Prepend workspace folder as trusted read-write permission
    if let Some(ref wd) = working_directory {
        let ws_perm = sidecar::FolderPermissionPayload {
            path: wd.clone(),
            access_level: "read-write".to_string(),
            source: Some("workspace".to_string()),
        };
        let mut perms = vec![ws_perm];
        if let Some(existing) = sidecar_perms.take() {
            perms.extend(existing);
        }
        sidecar_perms = Some(perms);
    }

    // Get API keys from secure storage
    let api_keys = sidecar::get_all_api_keys()?;

    // Read user prompt from settings
    let custom_prompt = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if db::settings::get_user_prompt_enabled(&conn) {
            db::settings::get_user_prompt_text(&conn)
        } else {
            None
        }
    };

    // Load MCP servers config
    let mcp_servers = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_mcp_servers_config(&conn).map(|c| serde_json::to_value(c).unwrap())
    };

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
                api_keys: Some(api_keys),
                working_directory,
                model_id: resolved_model_id,
                folder_permissions: sidecar_perms,
                custom_prompt,
                mcp_servers,
                skip_config: None,
                arena_id: None,
            },
        })
        .await?;

    // Get the workspace_id for the response
    let response_workspace_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
    };

    // Return task object (status will be updated via events)
    Ok(Task {
        id: task_id,
        prompt: config.prompt,
        status: "starting".to_string(),
        messages: vec![],
        result: None,
        session_id: None,
        summary: None,
        created_at,
        updated_at: None,
        completed_at: None,
        started_at: Some(started_at),
        workspace_id: response_workspace_id,
        arena_id: None,
        arena_slot: None,
        model_id: None,
    })
}

#[tauri::command]
pub async fn cancel_task(
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
pub async fn abort_session(
    task_id: String,
    session_id: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    manager
        .send_command(sidecar::SidecarCommand::AbortSession {
            task_id,
            session_id,
        })
        .await
}

#[tauri::command]
pub async fn get_session_todos(
    task_id: String,
    session_id: String,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    manager
        .send_command(sidecar::SidecarCommand::GetSessionTodos {
            task_id,
            session_id,
        })
        .await
}

#[tauri::command]
pub async fn reply_to_question(
    task_id: String,
    request_id: String,
    answers: Vec<sidecar::QuestionAnswer>,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    let payload = sidecar::QuestionReplyPayload {
        request_id,
        answers,
    };

    manager
        .send_command(sidecar::SidecarCommand::SendQuestionReply { task_id, payload })
        .await
}

#[tauri::command]
pub async fn get_task(task_id: String, state: State<'_, DbState>) -> Result<Option<Task>, String> {
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
                tool_output: m.tool_output,
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
        workspace_id: t.workspace_id,
        arena_id: None,
        arena_slot: None,
        model_id: None,
    }))
}

#[tauri::command]
pub async fn list_tasks(
    workspace_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Task>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tasks = if let Some(ref ws_id) = workspace_id {
        db::tasks::get_tasks_by_workspace(&conn, ws_id)
    } else {
        db::tasks::get_tasks(&conn)
    };

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
                    tool_output: m.tool_output,
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
            workspace_id: t.workspace_id,
            arena_id: None,
            arena_slot: None,
            model_id: None,
        })
        .collect())
}

#[tauri::command]
pub async fn delete_task(task_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::delete_task(&conn, &task_id)
}

#[tauri::command]
pub async fn clear_task_history(state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::clear_history(&conn)
}

// ============================================================================
// Task Persistence Commands (for saving task updates from frontend events)
// ============================================================================

#[tauri::command]
pub async fn save_task_message(
    task_id: String,
    message: TaskMessage,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    db::tasks::add_task_message(
        &conn,
        &task_id,
        &db::tasks::TaskMessageInput {
            id: message.id,
            msg_type: message.msg_type,
            content: message.content,
            timestamp: message.timestamp,
            tool_name: message.tool_name,
            tool_input: message.tool_input,
            tool_output: message.tool_output,
            attachments: message.attachments.map(|atts| {
                atts.into_iter()
                    .map(|a| db::tasks::AttachmentInput {
                        att_type: a.att_type,
                        data: a.data,
                        label: a.label,
                    })
                    .collect()
            }),
        },
    )
}

#[tauri::command]
pub async fn save_task_status(
    task_id: String,
    status: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::update_task_status(&conn, &task_id, &status, None)?;

    // Check arena completion after any terminal status change
    if status == "completed" || status == "failed" || status == "interrupted" {
        if let Some(arena_id) = db::arenas::check_arena_all_tasks_terminal(&conn, &task_id) {
            let completed_at = chrono::Utc::now().to_rfc3339();
            let _ = db::arenas::update_arena_completed(&conn, &arena_id, &completed_at);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn save_task_session(
    task_id: String,
    session_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::update_task_session_id(&conn, &task_id, &session_id)
}

#[tauri::command]
pub async fn save_task_summary(
    task_id: String,
    summary: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::tasks::update_task_summary(&conn, &task_id, &summary)
}

/// Shared completion logic, callable from both the Tauri command (frontend invoke)
/// and the Rust-side sidecar event handler. Idempotent: the automation-run path is
/// guarded by `get_running_run_by_task_id` (status='running'), so whichever caller
/// arrives first marks the run complete; subsequent callers no-op on that branch.
pub fn handle_task_completion_internal(
    app: &tauri::AppHandle,
    task_id: &str,
    status: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let db_state = app.state::<DbState>();
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

    let completed_at = chrono::Utc::now().to_rfc3339();

    db::tasks::update_task_status(&conn, task_id, status, Some(&completed_at))?;

    if let Some(sid) = session_id {
        db::tasks::update_task_session_id(&conn, task_id, sid)?;
    }

    if let Some(arena_id) = db::arenas::check_arena_all_tasks_terminal(&conn, task_id) {
        let _ = db::arenas::update_arena_completed(&conn, &arena_id, &completed_at);
    }

    if let Some(run) = db::automations::get_running_run_by_task_id(&conn, task_id) {
        let has_findings = if status == "completed" {
            db::automations::determine_has_findings(&conn, task_id)
        } else {
            false
        };
        drop(conn);
        crate::automation_scheduler::mark_automation_run_complete(app, &run.id, has_findings);
    }

    Ok(())
}

#[tauri::command]
pub async fn complete_task(
    task_id: String,
    status: String,
    session_id: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    handle_task_completion_internal(&app, &task_id, &status, session_id.as_deref())
}

#[tauri::command]
pub async fn respond_to_permission(
    response: PermissionResponse,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    // When the user allows a permission, persist the target folder as an adhoc grant.
    // For external_directory permissions, patterns are directory paths — use them directly.
    // For edit/file permissions, patterns are file paths — use the parent directory.
    if response.decision == "allow" {
        if let Some(patterns) = &response.patterns {
            let ws_id: Option<String> = {
                let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
                conn.query_row(
                    "SELECT workspace_id FROM tasks WHERE id = ?1",
                    [&response.task_id],
                    |row| row.get(0),
                )
                .ok()
                .flatten()
            };

            for pattern in patterns {
                let path = std::path::Path::new(pattern);
                let folder_path = if path.is_dir() {
                    Some(pattern.clone())
                } else {
                    path.parent().map(|p| p.to_string_lossy().to_string())
                };
                if let Some(folder_path) = folder_path {
                    if !folder_path.is_empty() {
                        if let Some(ref ws_id) = ws_id {
                            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
                            let _ = db::workspace_permissions::save_workspace_permission(
                                &conn,
                                ws_id,
                                &folder_path,
                                "read-write",
                                "adhoc",
                            );
                        }
                    }
                }
            }
        }
    }

    // Map frontend decision to sidecar reply format
    let reply = if response.decision == "allow" {
        "once"
    } else {
        "reject"
    };

    let payload = sidecar::PermissionReplyPayload {
        request_id: response.request_id.clone(),
        reply: reply.to_string(),
        message: response.message,
    };

    manager
        .send_command(sidecar::SidecarCommand::SendPermissionReply {
            task_id: response.task_id,
            payload,
        })
        .await
}

#[tauri::command]
pub async fn resume_session(
    session_id: String,
    prompt: String,
    task_id: Option<String>,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<Task, String> {
    // Generate task ID
    let task_id = task_id.unwrap_or_else(|| format!("task_{}", uuid::Uuid::new_v4()));

    // Get workspace working directory
    let working_directory = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
            .and_then(|ws_id| db::workspaces::get_workspace(&conn, &ws_id))
            .map(|w| w.folder_path)
    };

    // Load workspace-scoped permissions from database
    let ws_id_for_perms = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
    };
    let workspace_perms = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref ws_id) = ws_id_for_perms {
            db::workspace_permissions::get_workspace_permissions(&conn, ws_id)
        } else {
            vec![]
        }
    };
    let mut sidecar_perms: Option<Vec<sidecar::FolderPermissionPayload>> =
        if workspace_perms.is_empty() {
            None
        } else {
            Some(
                workspace_perms
                    .iter()
                    .map(|wp| sidecar::FolderPermissionPayload {
                        path: wp.folder_path.clone(),
                        access_level: wp.access_level.clone(),
                        source: Some(wp.source.clone()),
                    })
                    .collect(),
            )
        };

    // Prepend workspace folder as trusted read-write permission
    if let Some(ref wd) = working_directory {
        let ws_perm = sidecar::FolderPermissionPayload {
            path: wd.clone(),
            access_level: "read-write".to_string(),
            source: Some("workspace".to_string()),
        };
        let mut perms = vec![ws_perm];
        if let Some(existing) = sidecar_perms.take() {
            perms.extend(existing);
        }
        sidecar_perms = Some(perms);
    }

    // Get API keys from secure storage
    let api_keys = sidecar::get_all_api_keys()?;

    // Read user prompt from settings
    let custom_prompt = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if db::settings::get_user_prompt_enabled(&conn) {
            db::settings::get_user_prompt_text(&conn)
        } else {
            None
        }
    };

    // Load MCP servers config
    let mcp_servers = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_mcp_servers_config(&conn).map(|c| serde_json::to_value(c).unwrap())
    };

    // Ensure sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    // Send resume session command
    manager
        .send_command(sidecar::SidecarCommand::ResumeSession {
            task_id: task_id.clone(),
            payload: sidecar::ResumeSessionPayload {
                task_id: task_id.clone(),
                session_id: session_id.clone(),
                prompt: Some(prompt.clone()),
                api_keys: Some(api_keys),
                working_directory,
                model_id: None,
                folder_permissions: sidecar_perms,
                custom_prompt,
                mcp_servers,
                skip_config: None,
                arena_id: None,
            },
        })
        .await?;

    // Get the workspace_id for the response
    let response_workspace_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::settings::get_last_workspace_id(&conn)
    };

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
        workspace_id: response_workspace_id,
        arena_id: None,
        arena_slot: None,
        model_id: None,
    })
}
