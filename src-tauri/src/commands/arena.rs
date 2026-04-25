// src-tauri/src/commands/arena.rs
//! Arena commands — side-by-side agent comparison sessions

use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::sidecar;
use crate::sidecar::SidecarState;
use crate::types::*;

/// Convert StoredTask list to Task list, preserving arena fields.
fn stored_tasks_to_tasks(stored: Vec<db::tasks::StoredTask>) -> Vec<Task> {
    stored
        .into_iter()
        .map(|t| Task {
            id: t.id.clone(),
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
            created_at: t.created_at,
            updated_at: None,
            completed_at: t.completed_at,
            started_at: t.started_at,
            workspace_id: t.workspace_id,
            arena_id: t.arena_id,
            arena_slot: t.arena_slot,
            model_id: t.model_id,
        })
        .collect()
}

/// Helper: resolve shared task state (API keys, workspace, perms, custom prompt, MCP).
/// Returns (api_keys, working_directory, folder_permissions, custom_prompt, mcp_servers, workspace_id)
fn resolve_shared_state(
    db_state: &State<'_, DbState>,
    _task_id: &str,
) -> Result<
    (
        sidecar::ApiKeys,
        Option<String>,
        Option<Vec<sidecar::FolderPermissionPayload>>,
        Option<String>,
        Option<serde_json::Value>,
        Option<String>,
    ),
    String,
> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

    let ws_id = db::settings::get_last_workspace_id(&conn);
    let working_directory = ws_id
        .as_ref()
        .and_then(|id| db::workspaces::get_workspace(&conn, id))
        .map(|w| w.folder_path);

    let workspace_perms = if let Some(ref ws_id) = ws_id {
        db::workspace_permissions::get_workspace_permissions(&conn, ws_id)
    } else {
        vec![]
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

    drop(conn); // Release lock before calling get_all_api_keys

    let api_keys = sidecar::get_all_api_keys()?;

    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let custom_prompt = if db::settings::get_user_prompt_enabled(&conn) {
        db::settings::get_user_prompt_text(&conn)
    } else {
        None
    };

    let mcp_servers =
        db::settings::get_mcp_servers_config(&conn).map(|c| serde_json::to_value(c).unwrap());

    Ok((
        api_keys,
        working_directory,
        sidecar_perms,
        custom_prompt,
        mcp_servers,
        ws_id,
    ))
}

/// Start an arena session with 3 agents running in parallel.
#[tauri::command]
pub async fn start_arena(
    config: ArenaConfig,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<Arena, String> {
    if config.models.len() != 3 {
        return Err("Arena requires exactly 3 models".to_string());
    }

    let arena_id = format!("arena_{}", uuid::Uuid::new_v4());
    let created_at = chrono::Utc::now().to_rfc3339();

    // Resolve workspace ID and save arena in a single lock acquisition
    let workspace_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let ws_id = db::settings::get_last_workspace_id(&conn);
        db::arenas::save_arena(
            &conn,
            &db::arenas::ArenaInput {
                id: arena_id.clone(),
                prompt: config.prompt.clone(),
                workspace_id: ws_id.clone(),
                created_at: created_at.clone(),
            },
        )?;
        ws_id
    };

    // Resolve shared state once (using the first task_id as placeholder for perms)
    let first_task_id = format!("task_{}", uuid::Uuid::new_v4());
    let (api_keys, working_directory, folder_permissions, custom_prompt, mcp_servers, _ws_id) =
        resolve_shared_state(&db_state, &first_task_id)?;

    // Ensure sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    let mut tasks = Vec::with_capacity(3);

    for (slot, model_config) in config.models.iter().enumerate() {
        let task_id = if slot == 0 {
            first_task_id.clone()
        } else {
            format!("task_{}", uuid::Uuid::new_v4())
        };

        let started_at = chrono::Utc::now().to_rfc3339();

        // Save task to DB
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

            // Assign task to workspace
            if let Some(ref ws_id) = workspace_id {
                let _ = db::workspaces::assign_task_to_workspace(&conn, ws_id, &task_id);
            }

            // Set arena fields
            db::arenas::save_task_arena_fields(
                &conn,
                &task_id,
                &arena_id,
                slot as i32,
                &model_config.model_id,
            )?;
        }

        // Prepend folder instruction to prompt
        let arena_prompt = format!(
            "IMPORTANT: For any files you create, put them under a subfolder named \"output/{}\" in the workspace root to keep outputs separate from other agents.\n\n{}",
            model_config.display_name, config.prompt
        );

        // Send start_task command to sidecar
        // First task sends config, subsequent tasks skip it
        manager
            .send_command(sidecar::SidecarCommand::StartTask {
                task_id: task_id.clone(),
                payload: sidecar::StartTaskPayload {
                    task_id: task_id.clone(),
                    prompt: arena_prompt,
                    api_keys: Some(api_keys.clone()),
                    working_directory: working_directory.clone(),
                    model_id: Some(model_config.model_id.clone()),
                    folder_permissions: folder_permissions.clone(),
                    custom_prompt: custom_prompt.clone(),
                    mcp_servers: mcp_servers.clone(),
                    skip_config: if slot > 0 { Some(true) } else { None },
                    arena_id: Some(arena_id.clone()),
                },
            })
            .await?;

        tasks.push(Task {
            id: task_id,
            prompt: config.prompt.clone(),
            status: "starting".to_string(),
            messages: vec![],
            result: None,
            session_id: None,
            summary: None,
            created_at: created_at.clone(),
            updated_at: None,
            completed_at: None,
            started_at: Some(started_at),
            workspace_id: workspace_id.clone(),
            arena_id: Some(arena_id.clone()),
            arena_slot: Some(slot as i32),
            model_id: Some(model_config.model_id.clone()),
        });
    }

    Ok(Arena {
        id: arena_id,
        prompt: config.prompt,
        workspace_id,
        created_at,
        completed_at: None,
        tasks,
    })
}

/// Resume an arena session — send follow-up to all 3 agents.
#[tauri::command]
pub async fn resume_arena(
    arena_id: String,
    prompt: String,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<Arena, String> {
    // Load arena with tasks
    let arena = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::arenas::get_arena_with_tasks(&conn, &arena_id)
            .ok_or_else(|| format!("Arena not found: {}", arena_id))?
    };

    // Resolve shared state
    let first_task_id = arena
        .tasks
        .first()
        .map(|t| t.id.clone())
        .unwrap_or_default();
    let (api_keys, working_directory, folder_permissions, custom_prompt, mcp_servers, _ws_id) =
        resolve_shared_state(&db_state, &first_task_id)?;

    // Ensure sidecar is running
    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    for (slot, task) in arena.tasks.iter().enumerate() {
        let session_id = match &task.session_id {
            Some(id) => id.clone(),
            None => {
                println!(
                    "[Arena] Skipping task {} (slot {}) — no session_id",
                    task.id, slot
                );
                continue;
            }
        };

        // Read model_id from DB for this task
        let model_id = {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT model_id FROM tasks WHERE id = ?1",
                [&task.id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap_or(None)
        };

        manager
            .send_command(sidecar::SidecarCommand::ResumeSession {
                task_id: task.id.clone(),
                payload: sidecar::ResumeSessionPayload {
                    task_id: task.id.clone(),
                    session_id,
                    prompt: Some(prompt.clone()),
                    api_keys: Some(api_keys.clone()),
                    working_directory: working_directory.clone(),
                    model_id,
                    folder_permissions: folder_permissions.clone(),
                    custom_prompt: custom_prompt.clone(),
                    mcp_servers: mcp_servers.clone(),
                    skip_config: if slot > 0 { Some(true) } else { None },
                    arena_id: Some(arena_id.clone()),
                },
            })
            .await?;
    }

    // Return updated arena
    let updated_arena = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::arenas::get_arena_with_tasks(&conn, &arena_id)
            .ok_or_else(|| format!("Arena not found after resume: {}", arena_id))?
    };

    Ok(Arena {
        id: updated_arena.id,
        prompt: updated_arena.prompt,
        workspace_id: updated_arena.workspace_id,
        created_at: updated_arena.created_at,
        completed_at: updated_arena.completed_at,
        tasks: stored_tasks_to_tasks(updated_arena.tasks),
    })
}

/// Get an arena with its 3 tasks.
#[tauri::command]
pub async fn get_arena(arena_id: String, db_state: State<'_, DbState>) -> Result<Arena, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let stored = db::arenas::get_arena_with_tasks(&conn, &arena_id)
        .ok_or_else(|| format!("Arena not found: {}", arena_id))?;

    Ok(Arena {
        id: stored.id,
        prompt: stored.prompt,
        workspace_id: stored.workspace_id,
        created_at: stored.created_at,
        completed_at: stored.completed_at,
        tasks: stored_tasks_to_tasks(stored.tasks),
    })
}

/// List arenas for a workspace (sidebar display).
#[tauri::command]
pub async fn list_arenas(
    workspace_id: Option<String>,
    db_state: State<'_, DbState>,
) -> Result<Vec<db::arenas::ArenaListItem>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    match workspace_id {
        Some(ws_id) => Ok(db::arenas::get_arenas_by_workspace(&conn, &ws_id)),
        None => Ok(vec![]),
    }
}

/// Delete an arena and all its child tasks.
#[tauri::command]
pub async fn delete_arena(arena_id: String, db_state: State<'_, DbState>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::arenas::delete_arena(&conn, &arena_id)
}

/// Abort all running sessions in an arena.
#[tauri::command]
pub async fn abort_arena(
    arena_id: String,
    sidecar_state: State<'_, SidecarState>,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let tasks = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::tasks::get_tasks_by_arena(&conn, &arena_id)
    };

    let mut manager = sidecar_state.manager.lock().await;
    if !manager.is_running() {
        return Ok(());
    }

    for task in &tasks {
        if let Some(ref session_id) = task.session_id {
            if task.status == "running" || task.status == "starting" || task.status == "queued" {
                let _ = manager
                    .send_command(sidecar::SidecarCommand::AbortSession {
                        task_id: task.id.clone(),
                        session_id: session_id.clone(),
                    })
                    .await;
            }
        }
    }

    Ok(())
}

/// Rename an arena (update prompt for sidebar display).
#[tauri::command]
pub async fn rename_arena(
    arena_id: String,
    prompt: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::arenas::update_arena_prompt(&conn, &arena_id, &prompt)
}
