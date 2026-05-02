use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

mod automation_dispatch;
mod automation_scheduler;
mod commands;
mod db;
mod fs_watcher;
mod git_ops;
mod secure_storage;
mod sidecar;
mod skill_discovery;
pub mod types;
mod workspace_validator;

use commands::updates::PendingUpdate;
use sidecar::SidecarState;

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize database
            let db_state = db::init_database(app.handle()).expect("Failed to initialize database");
            app.manage(db_state);

            // Initialize sidecar state
            app.manage(SidecarState::new());

            // Initialize filesystem watcher state
            app.manage(fs_watcher::FsWatcherState::new());

            // Initialize pending update state
            app.manage(PendingUpdate(Mutex::new(None)));

            // Initialize automation scheduler state
            app.manage(automation_scheduler::AutomationSchedulerState::new());

            // Initialize per-automation scheduler registry
            let registry = automation_scheduler::AutomationSchedulerRegistry::new();
            app.manage(registry);

            // Start all enabled automation scheduler threads after a delay
            let app_for_scheduler = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let registry = app_for_scheduler.state::<automation_scheduler::AutomationSchedulerRegistry>();
                registry.reload_all(&app_for_scheduler);
            });

            // Copy bundled OpenCode Server API skill to global skills directory
            // so that OpenCode discovers it automatically.
            if let Some(home) = dirs::home_dir() {
                let target_dir = home.join(".config/opencode/skills/opencode-server-api");
                let target_file = target_dir.join("SKILL.md");

                match app.path().resource_dir() {
                    Ok(resource_dir) => {
                        let source_file = resource_dir
                            .join("resources")
                            .join("skills")
                            .join("opencode-server-api")
                            .join("SKILL.md");

                        if source_file.exists() {
                            if let Err(e) = std::fs::create_dir_all(&target_dir) {
                                eprintln!(
                                    "[warn] Failed to create skill directory {:?}: {}",
                                    target_dir, e
                                );
                            } else if let Err(e) = std::fs::copy(&source_file, &target_file) {
                                eprintln!(
                                    "[warn] Failed to copy skill SKILL.md to {:?}: {}",
                                    target_file, e
                                );
                            }
                        } else {
                            eprintln!("[warn] Bundled SKILL.md not found at {:?}", source_file);
                        }
                    }
                    Err(e) => {
                        eprintln!("[warn] Failed to resolve resource directory: {}", e);
                    }
                }
            }

            // Background sync skill repos on launch
            let app_handle_for_sync = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));

                let db_state = app_handle_for_sync.state::<crate::db::DbState>();
                let repos = {
                    let conn = db_state.conn.lock().unwrap();
                    crate::db::skill_repos::list_skill_repos(&conn)
                };

                if repos.is_empty() || !crate::git_ops::is_git_available() {
                    return;
                }

                for repo in repos {
                    let cache = app_handle_for_sync
                        .path()
                        .app_data_dir()
                        .expect("app data dir")
                        .join("skill-repo-cache")
                        .join(crate::git_ops::derive_cache_dir_name(&repo.url));

                    let _ = app_handle_for_sync.emit(
                        "skills:sync_progress",
                        crate::commands::skill_repos::SyncProgress {
                            repo_id: repo.id.clone(),
                            status: "syncing".to_string(),
                            error: None,
                        },
                    );

                    let token = repo
                        .auth_token_key
                        .as_ref()
                        .and_then(|key| crate::secure_storage::get_api_key(key).ok().flatten());

                    let result = if cache.exists() {
                        crate::git_ops::pull_repo(&cache, token.as_deref())
                    } else {
                        let _ = std::fs::create_dir_all(cache.parent().unwrap());
                        crate::git_ops::clone_repo(
                            &repo.url,
                            &repo.branch,
                            &cache,
                            token.as_deref(),
                        )
                    };

                    let now = chrono::Utc::now().to_rfc3339();
                    match result {
                        Ok(()) => {
                            let discovered = crate::skill_discovery::discover_skills(
                                &repo.id, &cache, &repo.url,
                            );
                            let conn = db_state.conn.lock().unwrap();
                            let _ = crate::db::skill_repos::update_sync_status(
                                &conn,
                                &repo.id,
                                Some(&now),
                                None,
                            );
                            let _ = crate::db::skill_repos::save_repo_skills(
                                &conn,
                                &repo.id,
                                &discovered,
                            );
                            let _ = app_handle_for_sync.emit(
                                "skills:sync_progress",
                                crate::commands::skill_repos::SyncProgress {
                                    repo_id: repo.id,
                                    status: "synced".to_string(),
                                    error: None,
                                },
                            );
                        }
                        Err(e) => {
                            let conn = db_state.conn.lock().unwrap();
                            let _ = crate::db::skill_repos::update_sync_status(
                                &conn,
                                &repo.id,
                                None,
                                Some(&e),
                            );
                            let _ = app_handle_for_sync.emit(
                                "skills:sync_progress",
                                crate::commands::skill_repos::SyncProgress {
                                    repo_id: repo.id,
                                    status: "error".to_string(),
                                    error: Some(e),
                                },
                            );
                        }
                    }
                }

                let _ = app_handle_for_sync.emit("skills:changed", ());
            });

            // Build native menu bar
            let show_about_item = MenuItemBuilder::new("About Cowork-Z")
                .id("show-about")
                .build(app)?;

            let keyboard_shortcuts_item = MenuItemBuilder::new("Keyboard Shortcuts")
                .id("show-keyboard-shortcuts")
                .build(app)?;

            let check_updates_item = MenuItemBuilder::new("Check for Updates…")
                .id("check-for-updates")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Cowork-Z")
                .item(&show_about_item)
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::close_window(app, None)?)
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&keyboard_shortcuts_item)
                .separator()
                .item(&check_updates_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| match event.id().0.as_str() {
                "show-about" => {
                    let _ = app_handle.emit("show-about", ());
                }
                "show-keyboard-shortcuts" => {
                    let _ = app_handle.emit("show-keyboard-shortcuts", ());
                }
                "check-for-updates" => {
                    let _ = app_handle.emit("check-for-updates", ());
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App Info
            commands::app_info::get_version,
            commands::app_info::get_platform,
            commands::app_info::get_arch,
            commands::app_info::is_e2e_mode,
            // Task operations
            commands::tasks::start_task,
            commands::tasks::cancel_task,
            commands::tasks::abort_session,
            commands::tasks::get_session_todos,
            commands::tasks::get_task,
            commands::tasks::list_tasks,
            commands::tasks::delete_task,
            commands::tasks::clear_task_history,
            commands::tasks::save_task_message,
            commands::tasks::save_task_status,
            commands::tasks::save_task_session,
            commands::tasks::save_task_summary,
            commands::tasks::complete_task,
            commands::tasks::respond_to_permission,
            commands::tasks::reply_to_question,
            commands::tasks::resume_session,
            // Arena operations
            commands::arena::start_arena,
            commands::arena::resume_arena,
            commands::arena::get_arena,
            commands::arena::list_arenas,
            commands::arena::delete_arena,
            commands::arena::abort_arena,
            commands::arena::rename_arena,
            // Workspace permissions
            commands::workspace_permissions::save_workspace_permission,
            commands::workspace_permissions::get_workspace_permissions,
            commands::workspace_permissions::remove_workspace_permission,
            commands::workspace_permissions::get_default_folder_permissions,
            // Settings
            commands::settings::get_debug_mode,
            commands::settings::set_debug_mode,
            commands::settings::get_user_prompt,
            commands::settings::set_user_prompt,
            commands::settings::get_mcp_servers_config,
            commands::settings::set_mcp_servers_config,
            commands::settings::get_app_settings,
            commands::settings::get_theme,
            commands::settings::set_theme,
            commands::settings::get_onboarding_complete,
            commands::settings::set_onboarding_complete,
            // API Key management
            commands::api_keys::get_api_keys,
            commands::api_keys::add_api_key,
            commands::api_keys::remove_api_key,
            commands::api_keys::has_api_key,
            commands::api_keys::set_api_key,
            commands::api_keys::get_api_key,
            commands::api_keys::validate_api_key,
            commands::api_keys::validate_api_key_for_provider,
            commands::api_keys::clear_api_key,
            commands::api_keys::get_all_api_keys,
            commands::api_keys::has_any_api_key,
            // OpenCode CLI
            commands::opencode_cli::check_opencode_cli,
            commands::opencode_cli::get_opencode_version,
            // Model selection & Providers
            commands::providers::get_selected_model,
            commands::providers::set_selected_model,
            commands::providers::get_provider_settings,
            commands::providers::set_active_provider,
            commands::providers::get_connected_provider,
            commands::providers::set_connected_provider,
            commands::providers::remove_connected_provider,
            commands::providers::update_provider_model,
            commands::providers::set_provider_debug_mode,
            commands::providers::get_provider_debug_mode,
            commands::providers::fetch_provider_models,
            // Ollama
            commands::ollama::test_ollama_connection,
            commands::ollama::get_ollama_config,
            commands::ollama::set_ollama_config,
            // Azure Foundry
            commands::azure_foundry::get_azure_foundry_config,
            commands::azure_foundry::set_azure_foundry_config,
            commands::azure_foundry::test_azure_foundry_connection,
            commands::azure_foundry::save_azure_foundry_config,
            // LiteLLM
            commands::litellm::test_litellm_connection,
            commands::litellm::fetch_litellm_models,
            commands::litellm::get_litellm_config,
            commands::litellm::set_litellm_config,
            // Bedrock
            commands::bedrock::validate_bedrock_credentials,
            commands::bedrock::save_bedrock_credentials,
            commands::bedrock::get_bedrock_credentials,
            commands::bedrock::fetch_bedrock_models,
            // MCP
            commands::mcp::get_mcp_status,
            commands::mcp::get_mcp_tools,
            commands::mcp::connect_mcp_server,
            commands::mcp::disconnect_mcp_server,
            // Copilot
            commands::copilot::copilot_oauth_authorize,
            commands::copilot::copilot_get_models,
            commands::copilot::copilot_disconnect,
            // Logging
            commands::logging::log_event,
            commands::logging::write_text_file,
            // App Updates
            commands::updates::check_for_update,
            commands::updates::install_update,
            // File preview
            commands::files::read_file_content,
            commands::files::read_binary_file,
            commands::files::trash_file,
            // Workspaces
            commands::workspaces::list_workspaces,
            commands::workspaces::get_active_workspace,
            commands::workspaces::add_workspace,
            commands::workspaces::remove_workspace,
            commands::workspaces::switch_workspace,
            commands::workspaces::read_directory,
            commands::workspaces::initialize_workspace,
            // Packs
            commands::packs::packs_list,
            commands::packs::packs_install,
            commands::packs::packs_install_default,
            // Skills
            commands::skills::skills_list_with_status,
            commands::skills::skills_install,
            commands::skills::skills_get_template_path,
            commands::skills::skills_get_skill_file_path,
            // Automations
            commands::automations::create_automation,
            commands::automations::update_automation,
            commands::automations::delete_automation,
            commands::automations::list_automations,
            commands::automations::get_automation,
            commands::automations::toggle_automation_enabled,
            commands::automations::list_automation_runs,
            commands::automations::mark_run_read,
            commands::automations::mark_all_runs_read,
            commands::automations::get_automation_unread_count,
            commands::automations::run_automation_now,
            commands::automations::get_automation_next_runs,
            commands::automations::validate_cron,
            // Skill Repos (Skills Manager)
            commands::skill_repos::skill_repos_list,
            commands::skill_repos::skill_repos_add,
            commands::skill_repos::skill_repos_remove,
            commands::skill_repos::skill_repos_sync,
            commands::skill_repos::skill_repos_sync_all,
            commands::skill_repos::skill_repos_skills,
            commands::skill_repos::skills_install_from_repo,
            commands::skill_repos::skills_list_installed,
            commands::skill_repos::skills_delete_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
