// src-tauri/src/db/settings.rs
//! App settings repository

use std::collections::HashMap;

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
    pub user_prompt_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_prompt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers_config: Option<McpServersConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_id: Option<String>,
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

/// MCP server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(rename = "type")]
    pub server_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u32>,
}

/// MCP servers configuration (map of server name to config)
pub type McpServersConfig = HashMap<String, McpServerConfig>;

/// Get app settings
pub fn get_app_settings(conn: &Connection) -> AppSettings {
    let result = conn.query_row(
        "SELECT debug_mode, onboarding_complete, selected_model, ollama_config, litellm_config, azure_foundry_config, user_prompt_enabled, user_prompt_text, mcp_servers_config, theme_id
         FROM app_settings WHERE id = 1",
        [],
        |row| {
            let debug_mode: i32 = row.get(0)?;
            let onboarding_complete: i32 = row.get(1)?;
            let selected_model_str: Option<String> = row.get(2)?;
            let ollama_config_str: Option<String> = row.get(3)?;
            let litellm_config_str: Option<String> = row.get(4)?;
            let azure_foundry_config_str: Option<String> = row.get(5)?;
            let user_prompt_enabled: i32 = row.get(6)?;
            let user_prompt_text: Option<String> = row.get(7)?;
            let mcp_servers_config_str: Option<String> = row.get(8)?;
            let theme_id: Option<String> = row.get(9)?;

            Ok(AppSettings {
                debug_mode: debug_mode == 1,
                onboarding_complete: onboarding_complete == 1,
                selected_model: selected_model_str.and_then(|s| serde_json::from_str(&s).ok()),
                ollama_config: ollama_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                litellm_config: litellm_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                azure_foundry_config: azure_foundry_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                user_prompt_enabled: user_prompt_enabled == 1,
                user_prompt_text,
                mcp_servers_config: mcp_servers_config_str.and_then(|s| serde_json::from_str(&s).ok()),
                theme_id,
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
        user_prompt_enabled: false,
        user_prompt_text: None,
        mcp_servers_config: None,
        theme_id: None,
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

/// Get user prompt enabled flag
pub fn get_user_prompt_enabled(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT user_prompt_enabled FROM app_settings WHERE id = 1",
        [],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val == 1)
        },
    )
    .unwrap_or(false)
}

/// Get user prompt text
pub fn get_user_prompt_text(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT user_prompt_text FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .ok()
    .flatten()
}

/// Set user prompt settings (enabled flag and text)
pub fn set_user_prompt(conn: &Connection, enabled: bool, text: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE app_settings SET user_prompt_enabled = ?1, user_prompt_text = ?2 WHERE id = 1",
        params![if enabled { 1 } else { 0 }, text],
    )
    .map_err(|e| format!("Failed to set user prompt: {}", e))?;
    Ok(())
}

/// Get MCP servers configuration
pub fn get_mcp_servers_config(conn: &Connection) -> Option<McpServersConfig> {
    conn.query_row(
        "SELECT mcp_servers_config FROM app_settings WHERE id = 1",
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

/// Set MCP servers configuration
pub fn set_mcp_servers_config(
    conn: &Connection,
    config: Option<&McpServersConfig>,
) -> Result<(), String> {
    let json = config.map(|c| serde_json::to_string(c).unwrap());
    conn.execute(
        "UPDATE app_settings SET mcp_servers_config = ?1 WHERE id = 1",
        params![json],
    )
    .map_err(|e| format!("Failed to set MCP servers config: {}", e))?;
    Ok(())
}

/// Get theme ID
pub fn get_theme_id(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT theme_id FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .ok()
    .flatten()
}

/// Set theme ID
pub fn set_theme_id(conn: &Connection, theme_id: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE app_settings SET theme_id = ?1 WHERE id = 1",
        params![theme_id],
    )
    .map_err(|e| format!("Failed to set theme_id: {}", e))?;
    Ok(())
}

/// Get the last active workspace ID
pub fn get_last_workspace_id(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT last_workspace_id FROM app_settings WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .ok()
    .flatten()
}

/// Set the last active workspace ID
pub fn set_last_workspace_id(conn: &Connection, id: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE app_settings SET last_workspace_id = ?1 WHERE id = 1",
        params![id],
    )
    .map_err(|e| format!("Failed to set last_workspace_id: {}", e))?;
    Ok(())
}
