use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::secure_storage;
use crate::types::*;

#[tauri::command]
pub async fn get_azure_foundry_config(
    state: State<'_, DbState>,
) -> Result<Option<AzureFoundryConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_azure_foundry_config(&conn);
    Ok(config.map(|c| AzureFoundryConfig {
        base_url: c.base_url,
        deployment_name: c.deployment_name,
        auth_type: c.auth_type,
        enabled: c.enabled,
        last_validated: c.last_validated,
    }))
}

#[tauri::command]
pub async fn set_azure_foundry_config(
    config: Option<AzureFoundryConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::AzureFoundryConfig {
        base_url: c.base_url,
        deployment_name: c.deployment_name,
        auth_type: c.auth_type,
        enabled: c.enabled,
        last_validated: c.last_validated,
    });
    db::settings::set_azure_foundry_config(&conn, db_config.as_ref())
}

#[tauri::command]
pub async fn test_azure_foundry_connection(
    _config: AzureFoundryTestConfig,
) -> Result<ValidationResult, String> {
    // TODO: Implement Azure Foundry connection test
    Ok(ValidationResult {
        valid: false,
        error: Some("Azure Foundry connection test not yet implemented".to_string()),
    })
}

#[tauri::command]
pub async fn save_azure_foundry_config(
    config: AzureFoundryTestConfig,
    state: State<'_, DbState>,
) -> Result<(), String> {
    // Store API key securely if present.
    // "azure-foundry" matches the frontend provider id and the keychain
    // status list in secure_storage::PROVIDERS.
    if let Some(api_key) = &config.api_key {
        secure_storage::store_api_key("azure-foundry", api_key)?;
    }

    // Store rest of config (without API key) in database
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::settings::set_azure_foundry_config(
        &conn,
        Some(&db::settings::AzureFoundryConfig {
            base_url: config.endpoint,
            deployment_name: config.deployment_name,
            auth_type: config.auth_type,
            enabled: true,
            last_validated: None,
        }),
    )
}
