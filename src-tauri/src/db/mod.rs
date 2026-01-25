// src-tauri/src/db/mod.rs
//! Database module for Cowork Z
//!
//! Provides SQLite-based persistence for tasks, settings, and provider configurations.

pub mod migrations;
pub mod providers;
pub mod settings;
pub mod tasks;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use migrations::run_migrations;

/// App state containing the database connection
pub struct DbState {
    pub conn: Mutex<Connection>,
}

/// Get the database file path based on environment
pub fn get_database_path(app: &AppHandle) -> PathBuf {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    // Ensure directory exists
    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

    // Use different database for development vs production
    #[cfg(debug_assertions)]
    let db_name = "cowork-dev.db";
    #[cfg(not(debug_assertions))]
    let db_name = "cowork.db";

    app_data_dir.join(db_name)
}

/// Initialize the database connection and run migrations
pub fn init_database(app: &AppHandle) -> Result<DbState, String> {
    let db_path = get_database_path(app);
    println!("[DB] Opening database at: {:?}", db_path);

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    // Enable WAL mode for better concurrent read/write performance
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal mode: {}", e))?;

    // Enable foreign key constraints
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    // Run migrations
    run_migrations(&conn)?;

    println!("[DB] Database initialized successfully");

    Ok(DbState {
        conn: Mutex::new(conn),
    })
}
