// src-tauri/src/db/migrations.rs
//! Database schema migrations

use rusqlite::Connection;
use serde_json;

/// Current schema version supported by this app
const CURRENT_VERSION: i32 = 6;

/// Get the stored schema version from the database
fn get_stored_version(conn: &Connection) -> i32 {
    // Check if schema_meta table exists
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

/// Migration v1: Initial schema
fn migrate_v1(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v1 (initial schema)");

    // Create schema_meta table
    conn.execute(
        "CREATE TABLE schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| format!("Failed to create schema_meta: {}", e))?;

    // Create app_settings table
    conn.execute(
        "CREATE TABLE app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            debug_mode INTEGER NOT NULL DEFAULT 0,
            onboarding_complete INTEGER NOT NULL DEFAULT 0,
            selected_model TEXT,
            ollama_config TEXT,
            litellm_config TEXT
        )",
        [],
    )
    .map_err(|e| format!("Failed to create app_settings: {}", e))?;

    // Create provider_meta table
    conn.execute(
        "CREATE TABLE provider_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            active_provider_id TEXT,
            debug_mode INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| format!("Failed to create provider_meta: {}", e))?;

    // Create providers table
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

    // Create tasks table
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

    // Create task_messages table
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

    // Create task_attachments table
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

    // Create indexes
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

    // Insert default rows for single-row tables
    conn.execute("INSERT INTO app_settings (id) VALUES (1)", [])
        .map_err(|e| format!("Failed to insert app_settings default: {}", e))?;

    conn.execute("INSERT INTO provider_meta (id) VALUES (1)", [])
        .map_err(|e| format!("Failed to insert provider_meta default: {}", e))?;

    set_stored_version(conn, 1)?;
    println!("[Migrations] Migration v1 complete");
    Ok(())
}

/// Migration v2: Add Azure Foundry configuration column
fn migrate_v2(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v2 (Azure Foundry config)");

    conn.execute(
        "ALTER TABLE app_settings ADD COLUMN azure_foundry_config TEXT",
        [],
    )
    .map_err(|e| format!("Failed to add azure_foundry_config column: {}", e))?;

    set_stored_version(conn, 2)?;
    println!("[Migrations] Migration v2 complete");
    Ok(())
}

/// Migration v3: Add folders column to tasks table
fn migrate_v3(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v3 (task folders)");

    conn.execute("ALTER TABLE tasks ADD COLUMN folders TEXT", [])
        .map_err(|e| format!("Failed to add folders column: {}", e))?;

    set_stored_version(conn, 3)?;
    println!("[Migrations] Migration v3 complete");
    Ok(())
}

/// Migration v4: Create folder_permissions table, migrate data from tasks.folders, drop tasks.folders column
fn migrate_v4(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v4 (folder permissions)");

    // 1. Create folder_permissions table
    conn.execute(
        "CREATE TABLE folder_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            folder_path TEXT NOT NULL,
            access_level TEXT NOT NULL DEFAULT 'read-write',
            created_at TEXT NOT NULL,
            UNIQUE(task_id, folder_path)
        )",
        [],
    )
    .map_err(|e| format!("Failed to create folder_permissions: {}", e))?;

    conn.execute(
        "CREATE INDEX idx_folder_permissions_task_id ON folder_permissions(task_id)",
        [],
    )
    .map_err(|e| format!("Failed to create folder_permissions index: {}", e))?;

    // 2. Migrate existing data from tasks.folders JSON column
    // Check if folders column exists before migrating
    let has_folders_column: bool = conn
        .prepare("SELECT folders FROM tasks LIMIT 0")
        .is_ok();

    if has_folders_column {
        let mut stmt = conn
            .prepare("SELECT id, folders FROM tasks WHERE folders IS NOT NULL")
            .map_err(|e| format!("Failed to prepare migration query: {}", e))?;

        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query tasks for migration: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        let now = chrono::Utc::now().to_rfc3339();
        for (task_id, folders_json) in &rows {
            if let Ok(folders) = serde_json::from_str::<Vec<String>>(folders_json) {
                for folder in &folders {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO folder_permissions (task_id, folder_path, access_level, created_at)
                         VALUES (?1, ?2, 'read-write', ?3)",
                        rusqlite::params![task_id, folder, now],
                    );
                }
            }
        }

        // 3. Drop the folders column from tasks table
        let _ = conn.execute("ALTER TABLE tasks DROP COLUMN folders", []);
    }

    set_stored_version(conn, 4)?;
    println!("[Migrations] Migration v4 complete");
    Ok(())
}

/// Migration v5: Add source column to folder_permissions table
fn migrate_v5(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v5 (folder permission source)");

    conn.execute(
        "ALTER TABLE folder_permissions ADD COLUMN source TEXT NOT NULL DEFAULT 'user'",
        [],
    )
    .map_err(|e| format!("Failed to add source column to folder_permissions: {}", e))?;

    set_stored_version(conn, 5)?;
    println!("[Migrations] Migration v5 complete");
    Ok(())
}

/// Migration v6: Add user prompt columns to app_settings
fn migrate_v6(conn: &Connection) -> Result<(), String> {
    println!("[Migrations] Running migration v6 (user prompt)");

    conn.execute(
        "ALTER TABLE app_settings ADD COLUMN user_prompt_enabled INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .map_err(|e| format!("Failed to add user_prompt_enabled column: {}", e))?;

    conn.execute(
        "ALTER TABLE app_settings ADD COLUMN user_prompt_text TEXT",
        [],
    )
    .map_err(|e| format!("Failed to add user_prompt_text column: {}", e))?;

    set_stored_version(conn, 6)?;
    println!("[Migrations] Migration v6 complete");
    Ok(())
}

/// Run all pending migrations
pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    let stored_version = get_stored_version(conn);
    println!(
        "[Migrations] Stored version: {}, App version: {}",
        stored_version, CURRENT_VERSION
    );

    // Block if database is from a newer app version
    if stored_version > CURRENT_VERSION {
        return Err(format!(
            "Database schema version {} is newer than app version {}. Please upgrade the app.",
            stored_version, CURRENT_VERSION
        ));
    }

    // No migrations to run
    if stored_version == CURRENT_VERSION {
        println!("[Migrations] Database is up to date");
        return Ok(());
    }

    // Run pending migrations
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
    if stored_version < 5 {
        migrate_v5(conn)?;
    }
    if stored_version < 6 {
        migrate_v6(conn)?;
    }

    println!("[Migrations] All migrations complete");
    Ok(())
}
