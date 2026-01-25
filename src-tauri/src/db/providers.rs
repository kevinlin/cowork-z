// src-tauri/src/db/providers.rs
//! Provider settings repository

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Provider settings from the database
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub active_provider_id: Option<String>,
    pub connected_providers: HashMap<String, ConnectedProvider>,
    pub debug_mode: bool,
}

/// Connected provider info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedProvider {
    pub provider_id: String,
    pub connection_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model_id: Option<String>,
    pub credentials: ProviderCredentials,
    pub last_connected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_models: Option<Vec<AvailableModel>>,
}

/// Provider credentials (stored as JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentials {
    #[serde(rename = "type")]
    pub credentials_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    // Flatten any additional fields
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Available model info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableModel {
    pub id: String,
    pub name: String,
}

/// Get all provider settings
pub fn get_provider_settings(conn: &Connection) -> ProviderSettings {
    // Get provider meta
    let meta = conn
        .query_row(
            "SELECT active_provider_id, debug_mode FROM provider_meta WHERE id = 1",
            [],
            |row| {
                let active_id: Option<String> = row.get(0)?;
                let debug_mode: i32 = row.get(1)?;
                Ok((active_id, debug_mode == 1))
            },
        )
        .unwrap_or((None, false));

    // Get all connected providers
    let mut connected_providers = HashMap::new();

    let mut stmt = conn
        .prepare(
            "SELECT provider_id, connection_status, selected_model_id, credentials_type,
                    credentials_data, last_connected_at, available_models
             FROM providers",
        )
        .expect("Failed to prepare providers query");

    let provider_iter = stmt
        .query_map([], |row| {
            let provider_id: String = row.get(0)?;
            let connection_status: String = row.get(1)?;
            let selected_model_id: Option<String> = row.get(2)?;
            let credentials_type: String = row.get(3)?;
            let credentials_data: Option<String> = row.get(4)?;
            let last_connected_at: Option<String> = row.get(5)?;
            let available_models_str: Option<String> = row.get(6)?;

            // Parse credentials
            let credentials = credentials_data
                .and_then(|s| serde_json::from_str::<ProviderCredentials>(&s).ok())
                .unwrap_or(ProviderCredentials {
                    credentials_type: credentials_type.clone(),
                    key_prefix: None,
                    server_url: None,
                    api_key: None,
                    extra: HashMap::new(),
                });

            // Parse available models
            let available_models = available_models_str
                .and_then(|s| serde_json::from_str::<Vec<AvailableModel>>(&s).ok());

            Ok(ConnectedProvider {
                provider_id: provider_id.clone(),
                connection_status,
                selected_model_id,
                credentials,
                last_connected_at: last_connected_at
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                available_models,
            })
        })
        .expect("Failed to query providers");

    for provider in provider_iter.flatten() {
        connected_providers.insert(provider.provider_id.clone(), provider);
    }

    ProviderSettings {
        active_provider_id: meta.0,
        connected_providers,
        debug_mode: meta.1,
    }
}

/// Set the active provider
pub fn set_active_provider(conn: &Connection, provider_id: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE provider_meta SET active_provider_id = ?1 WHERE id = 1",
        params![provider_id],
    )
    .map_err(|e| format!("Failed to set active provider: {}", e))?;
    Ok(())
}

/// Get the active provider ID
pub fn get_active_provider_id(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT active_provider_id FROM provider_meta WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .ok()
    .flatten()
}

/// Get a connected provider by ID
pub fn get_connected_provider(conn: &Connection, provider_id: &str) -> Option<ConnectedProvider> {
    conn.query_row(
        "SELECT provider_id, connection_status, selected_model_id, credentials_type,
                credentials_data, last_connected_at, available_models
         FROM providers WHERE provider_id = ?1",
        [provider_id],
        |row| {
            let provider_id: String = row.get(0)?;
            let connection_status: String = row.get(1)?;
            let selected_model_id: Option<String> = row.get(2)?;
            let credentials_type: String = row.get(3)?;
            let credentials_data: Option<String> = row.get(4)?;
            let last_connected_at: Option<String> = row.get(5)?;
            let available_models_str: Option<String> = row.get(6)?;

            let credentials = credentials_data
                .and_then(|s| serde_json::from_str::<ProviderCredentials>(&s).ok())
                .unwrap_or(ProviderCredentials {
                    credentials_type: credentials_type.clone(),
                    key_prefix: None,
                    server_url: None,
                    api_key: None,
                    extra: HashMap::new(),
                });

            let available_models = available_models_str
                .and_then(|s| serde_json::from_str::<Vec<AvailableModel>>(&s).ok());

            Ok(ConnectedProvider {
                provider_id,
                connection_status,
                selected_model_id,
                credentials,
                last_connected_at: last_connected_at
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                available_models,
            })
        },
    )
    .ok()
}

/// Set/update a connected provider
pub fn set_connected_provider(
    conn: &Connection,
    provider_id: &str,
    provider: &ConnectedProvider,
) -> Result<(), String> {
    let credentials_json = serde_json::to_string(&provider.credentials)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;

    let models_json = provider
        .available_models
        .as_ref()
        .map(|m| serde_json::to_string(m).unwrap());

    conn.execute(
        "INSERT OR REPLACE INTO providers
         (provider_id, connection_status, selected_model_id, credentials_type,
          credentials_data, last_connected_at, available_models)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            provider_id,
            provider.connection_status,
            provider.selected_model_id,
            provider.credentials.credentials_type,
            credentials_json,
            provider.last_connected_at,
            models_json,
        ],
    )
    .map_err(|e| format!("Failed to set connected provider: {}", e))?;

    Ok(())
}

/// Remove a connected provider
pub fn remove_connected_provider(conn: &Connection, provider_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM providers WHERE provider_id = ?1", [provider_id])
        .map_err(|e| format!("Failed to remove provider: {}", e))?;

    // If this was the active provider, clear it
    let active_id = get_active_provider_id(conn);
    if active_id.as_deref() == Some(provider_id) {
        set_active_provider(conn, None)?;
    }

    Ok(())
}

/// Update the selected model for a provider
pub fn update_provider_model(
    conn: &Connection,
    provider_id: &str,
    model_id: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE providers SET selected_model_id = ?1 WHERE provider_id = ?2",
        params![model_id, provider_id],
    )
    .map_err(|e| format!("Failed to update provider model: {}", e))?;
    Ok(())
}

/// Set provider debug mode
pub fn set_provider_debug_mode(conn: &Connection, enabled: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE provider_meta SET debug_mode = ?1 WHERE id = 1",
        [if enabled { 1 } else { 0 }],
    )
    .map_err(|e| format!("Failed to set provider debug mode: {}", e))?;
    Ok(())
}

/// Get provider debug mode
pub fn get_provider_debug_mode(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT debug_mode FROM provider_meta WHERE id = 1",
        [],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val == 1)
        },
    )
    .unwrap_or(false)
}

/// Clear all provider settings
pub fn clear_provider_settings(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM providers", [])
        .map_err(|e| format!("Failed to clear providers: {}", e))?;
    conn.execute(
        "UPDATE provider_meta SET active_provider_id = NULL, debug_mode = 0 WHERE id = 1",
        [],
    )
    .map_err(|e| format!("Failed to reset provider meta: {}", e))?;
    Ok(())
}

/// Check if there's a ready provider (connected with a selected model)
pub fn has_ready_provider(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM providers
         WHERE connection_status = 'connected' AND selected_model_id IS NOT NULL",
        [],
        |row| {
            let count: i32 = row.get(0)?;
            Ok(count > 0)
        },
    )
    .unwrap_or(false)
}

/// Get all connected provider IDs
pub fn get_connected_provider_ids(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT provider_id FROM providers WHERE connection_status = 'connected'")
        .expect("Failed to prepare query");

    stmt.query_map([], |row| row.get(0))
        .expect("Failed to query")
        .filter_map(|r| r.ok())
        .collect()
}
