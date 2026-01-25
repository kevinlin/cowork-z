// src-tauri/src/db/migrations.rs
//! Database schema migrations

use rusqlite::Connection;

/// Current schema version supported by this app
const CURRENT_VERSION: i32 = 2;

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

    println!("[Migrations] All migrations complete");
    Ok(())
}
