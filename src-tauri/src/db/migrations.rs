// src-tauri/src/db/migrations.rs
//! Database schema migrations

use rusqlite::Connection;

/// Current schema version supported by this app
const CURRENT_VERSION: i32 = 4;

/// Get the stored schema version from the database
fn get_stored_version(conn: &Connection) -> i32 {
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='schema_meta'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !table_exists {
        return 0;
    }

    conn.query_row(
        "SELECT value FROM schema_meta WHERE key = 'version'",
        [],
        |row| {
            let value: String = row.get(0)?;
            Ok(value.parse::<i32>().unwrap_or(0))
        },
    )
    .unwrap_or(0)
}

/// Set the schema version in the database
fn set_stored_version(conn: &Connection, version: i32) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?1)",
        [version.to_string()],
    )
    .map_err(|e| format!("Failed to set schema version: {}", e))?;
    Ok(())
}

/// Migration v1: Full schema
fn migrate_v1(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v1 (full schema)");

    conn.execute(
        "CREATE TABLE schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create schema_meta: {}", e))?;

    conn.execute(
        "CREATE TABLE app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            debug_mode INTEGER NOT NULL DEFAULT 0,
            onboarding_complete INTEGER NOT NULL DEFAULT 0,
            selected_model TEXT,
            ollama_config TEXT,
            litellm_config TEXT,
            azure_foundry_config TEXT,
            user_prompt_enabled INTEGER NOT NULL DEFAULT 0,
            user_prompt_text TEXT,
            mcp_servers_config TEXT,
            theme_id TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create app_settings: {}", e))?;

    conn.execute(
        "CREATE TABLE provider_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            active_provider_id TEXT,
            debug_mode INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| format!("Failed to create provider_meta: {}", e))?;

    conn.execute(
        "CREATE TABLE providers (
            provider_id TEXT PRIMARY KEY,
            connection_status TEXT NOT NULL DEFAULT 'disconnected',
            selected_model_id TEXT,
            credentials_type TEXT NOT NULL,
            credentials_data TEXT,
            last_connected_at TEXT,
            available_models TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create providers: {}", e))?;

    conn.execute(
        "CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            summary TEXT,
            status TEXT NOT NULL,
            session_id TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create tasks: {}", e))?;

    conn.execute(
        "CREATE TABLE task_messages (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_name TEXT,
            tool_input TEXT,
            timestamp TEXT NOT NULL,
            sort_order INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create task_messages: {}", e))?;

    conn.execute(
        "CREATE TABLE task_attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            label TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create task_attachments: {}", e))?;

    conn.execute(
        "CREATE TABLE folder_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            folder_path TEXT NOT NULL,
            access_level TEXT NOT NULL DEFAULT 'read-write',
            created_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'user',
            UNIQUE(task_id, folder_path)
        )",
        [],
    )
    .map_err(|e| format!("Failed to create folder_permissions: {}", e))?;

    // Indexes
    conn.execute(
        "CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC)",
        [],
    )
    .map_err(|e| format!("Failed to create tasks index: {}", e))?;

    conn.execute(
        "CREATE INDEX idx_messages_task_id ON task_messages(task_id)",
        [],
    )
    .map_err(|e| format!("Failed to create messages index: {}", e))?;

    conn.execute(
        "CREATE INDEX idx_folder_permissions_task_id ON folder_permissions(task_id)",
        [],
    )
    .map_err(|e| format!("Failed to create folder_permissions index: {}", e))?;

    // Default rows for single-row tables
    conn.execute("INSERT INTO app_settings (id) VALUES (1)", [])
        .map_err(|e| format!("Failed to insert app_settings default: {}", e))?;

    conn.execute("INSERT INTO provider_meta (id) VALUES (1)", [])
        .map_err(|e| format!("Failed to insert provider_meta default: {}", e))?;

    set_stored_version(conn, 1)?;
    println!("[Migrations] Migration v1 complete");
    Ok(())
}

/// Migration v2: Workspaces
fn migrate_v2(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v2 (workspaces)");

    conn.execute(
        "CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
            folder_path TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_opened_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create workspaces: {}", e))?;

    conn.execute(
        "CREATE INDEX idx_workspaces_last_opened ON workspaces(last_opened_at DESC)",
        [],
    )
    .map_err(|e| format!("Failed to create workspaces index: {}", e))?;

    conn.execute(
        "ALTER TABLE tasks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)",
        [],
    )
    .map_err(|e| format!("Failed to add workspace_id to tasks: {}", e))?;

    conn.execute(
        "CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id)",
        [],
    )
    .map_err(|e| format!("Failed to create tasks workspace index: {}", e))?;

    conn.execute(
        "ALTER TABLE app_settings ADD COLUMN last_workspace_id TEXT",
        [],
    )
    .map_err(|e| format!("Failed to add last_workspace_id to app_settings: {}", e))?;

    set_stored_version(conn, 2)?;
    println!("[Migrations] Migration v2 complete");
    Ok(())
}

/// Migration v3: Skill repos and repo skills
fn migrate_v3(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v3 (skill repos)");

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_repos (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            auth_token_key TEXT,
            last_synced_at TEXT,
            last_sync_error TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS repo_skills (
            repo_id TEXT NOT NULL REFERENCES skill_repos(id) ON DELETE CASCADE,
            skill_path TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'General',
            PRIMARY KEY (repo_id, skill_path)
        );

        CREATE INDEX IF NOT EXISTS idx_repo_skills_repo_id ON repo_skills(repo_id);",
    )
    .map_err(|e| format!("Migration v3 failed: {}", e))?;

    set_stored_version(conn, 3)?;
    println!("[Migrations] Migration v3 complete");
    Ok(())
}

/// Migration v4: Add tool_output column to task_messages
fn migrate_v4(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v4 (tool_output column)");

    conn.execute(
        "ALTER TABLE task_messages ADD COLUMN tool_output TEXT",
        [],
    )
    .map_err(|e| format!("Failed to add tool_output column: {}", e))?;

    set_stored_version(conn, 4)?;
    println!("[Migrations] Migration v4 complete");
    Ok(())
}

/// Run all pending migrations
pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    let stored_version = get_stored_version(conn);
    println!(
        "[Migrations] Stored version: {}, App version: {}",
        stored_version, CURRENT_VERSION
    );

    if stored_version > CURRENT_VERSION {
        return Err(format!(
            "Database schema version {} is newer than app version {}. Please upgrade the app.",
            stored_version, CURRENT_VERSION
        ));
    }

    if stored_version == CURRENT_VERSION {
        println!("[Migrations] Database is up to date");
        return Ok(());
    }

    if stored_version < 1 {
        migrate_v1(conn)?;
    }

    if stored_version < 2 {
        migrate_v2(conn)?;
    }

    if stored_version < 3 {
        migrate_v3(conn)?;
    }

    if stored_version < 4 {
        migrate_v4(conn)?;
    }

    println!("[Migrations] All migrations complete");
    Ok(())
}
