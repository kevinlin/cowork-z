// src-tauri/src/db/settings.rs
//! App settings repository

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// App settings stored in the database
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub debug_mode: bool,
    pub onboarding_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<SelectedModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ollama_config: Option<OllamaConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub litellm_config: Option<LiteLLMConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub azure_foundry_config: Option<AzureFoundryConfig>,
}

/// Selected model configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedModel {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_name: Option<String>,
}

/// Ollama configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfig {
    pub base_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<OllamaModel>>,
}

/// Ollama model info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub id: String,
    pub display_name: String,
    pub size: u64,
}

/// LiteLLM configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteLLMConfig {
    pub base_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<LiteLLMModel>>,
}

/// LiteLLM model info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiteLLMModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_length: u64,
}

/// Azure Foundry configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureFoundryConfig {
    pub base_url: String,
    pub deployment_name: String,
    pub auth_type: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_validated: Option<u64>,
}

/// Get app settings
pub fn get_app_settings(conn: &Connection) -> AppSettings {
    let result = conn.query_row(
        "SELECT debug_mode, onboarding_complete, selected_model, ollama_config, litellm_config, azure_foundry_config
         FROM app_settings WHERE id = 1",
        [],
        |row| {
            let debug_mode: i32 = row.get(0)?;
            let onboarding_complete: i32 = row.get(1)?;
            let selected_model_str: Option<String> = row.get(2)?;
            let ollama_config_str: Option<String> = row.get(3)?;
            let litellm_config_str: Option<String> = row.get(4)?;
            let azure_foundry_config_str: Option<String> = row.get(5)?;

            Ok(AppSettings {
                debug_mode: debug_mode == 1,
                onboarding_complete: onboarding_complete == 1,
                selected_model: selected_model_str.and_then(|s| serde_json::from_str(&s).ok()),
                ollama_config: ollama_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                litellm_config: litellm_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                azure_foundry_config: azure_foundry_config_str.and_then(|s| serde_json::from_str(&s).ok()),
            })
        },
    );

    result.unwrap_or(AppSettings {
        debug_mode: false,
        onboarding_complete: false,
        selected_model: None,
        ollama_config: None,
        litellm_config: None,
        azure_foundry_config: None,
    })
}

/// Get debug mode setting
pub fn get_debug_mode(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT debug_mode FROM app_settings WHERE id = 1",
        [],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val == 1)
        },
    )
    .unwrap_or(false)
}

/// Set debug mode setting
pub fn set_debug_mode(conn: &Connection, enabled: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE app_settings SET debug_mode = ?1 WHERE id = 1",
        [if enabled { 1 } else { 0 }],
    )
    .map_err(|e| format!("Failed to set debug mode: {}", e))?;
    Ok(())
}

/// Get onboarding complete status
pub fn get_onboarding_complete(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT onboarding_complete FROM app_settings WHERE id = 1",
        [],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val == 1)
        },
    )
    .unwrap_or(false)
}

/// Set onboarding complete status
pub fn set_onboarding_complete(conn: &Connection, complete: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE app_settings SET onboarding_complete = ?1 WHERE id = 1",
        [if complete { 1 } else { 0 }],
    )
    .map_err(|e| format!("Failed to set onboarding complete: {}", e))?;
    Ok(())
}

/// Get selected model
pub fn get_selected_model(conn: &Connection) -> Option<SelectedModel> {
    conn.query_row(
        "SELECT selected_model FROM app_settings WHERE id = 1",
        [],
        |row| {
            let json: Option<String> = row.get(0)?;
            Ok(json)
        },
    )
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

/// Set selected model
pub fn set_selected_model(conn: &Connection, model: Option<&SelectedModel>) -> Result<(), String> {
    let json = model.map(|m| serde_json::to_string(m).unwrap());
    conn.execute(
        "UPDATE app_settings SET selected_model = ?1 WHERE id = 1",
        params![json],
    )
    .map_err(|e| format!("Failed to set selected model: {}", e))?;
    Ok(())
}

/// Get Ollama configuration
pub fn get_ollama_config(conn: &Connection) -> Option<OllamaConfig> {
    conn.query_row(
        "SELECT ollama_config FROM app_settings WHERE id = 1",
        [],
        |row| {
            let json: Option<String> = row.get(0)?;
            Ok(json)
        },
    )
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

/// Set Ollama configuration
pub fn set_ollama_config(conn: &Connection, config: Option<&OllamaConfig>) -> Result<(), String> {
    let json = config.map(|c| serde_json::to_string(c).unwrap());
    conn.execute(
        "UPDATE app_settings SET ollama_config = ?1 WHERE id = 1",
        params![json],
    )
    .map_err(|e| format!("Failed to set Ollama config: {}", e))?;
    Ok(())
}

/// Get LiteLLM configuration
pub fn get_litellm_config(conn: &Connection) -> Option<LiteLLMConfig> {
    conn.query_row(
        "SELECT litellm_config FROM app_settings WHERE id = 1",
        [],
        |row| {
            let json: Option<String> = row.get(0)?;
            Ok(json)
        },
    )
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

/// Set LiteLLM configuration
pub fn set_litellm_config(conn: &Connection, config: Option<&LiteLLMConfig>) -> Result<(), String> {
    let json = config.map(|c| serde_json::to_string(c).unwrap());
    conn.execute(
        "UPDATE app_settings SET litellm_config = ?1 WHERE id = 1",
        params![json],
    )
    .map_err(|e| format!("Failed to set LiteLLM config: {}", e))?;
    Ok(())
}

/// Get Azure Foundry configuration
pub fn get_azure_foundry_config(conn: &Connection) -> Option<AzureFoundryConfig> {
    conn.query_row(
        "SELECT azure_foundry_config FROM app_settings WHERE id = 1",
        [],
        |row| {
            let json: Option<String> = row.get(0)?;
            Ok(json)
        },
    )
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
}

/// Set Azure Foundry configuration
pub fn set_azure_foundry_config(
    conn: &Connection,
    config: Option<&AzureFoundryConfig>,
) -> Result<(), String> {
    let json = config.map(|c| serde_json::to_string(c).unwrap());
    conn.execute(
        "UPDATE app_settings SET azure_foundry_config = ?1 WHERE id = 1",
        params![json],
    )
    .map_err(|e| format!("Failed to set Azure Foundry config: {}", e))?;
    Ok(())
}
