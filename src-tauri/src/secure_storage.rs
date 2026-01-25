// src-tauri/src/secure_storage.rs
//! Secure storage using OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE_NAME: &str = "com.kevinlin.cowork-z";

/// API key providers
pub const PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "google",
    "xai",
    "ollama",
    "deepseek",
    "zai",
    "azure-foundry",
    "bedrock",
    "litellm",
    "openrouter",
    "custom",
];

/// Stored API key metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyInfo {
    pub id: String,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
    /// First few characters of the key for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_prefix: Option<String>,
}

/// Store an API key in the OS keychain
pub fn store_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keychain error: {}", e))?;

    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store API key: {}", e))?;

    Ok(())
}

/// Retrieve an API key from the OS keychain
pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keychain error: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get API key: {}", e)),
    }
}

/// Delete an API key from the OS keychain
pub fn delete_api_key(provider: &str) -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keychain error: {}", e))?;

    match entry.delete_password() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to delete API key: {}", e)),
    }
}

/// Check if an API key exists for a provider
pub fn has_api_key(provider: &str) -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keychain error: {}", e))?;

    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check API key: {}", e)),
    }
}

/// Get key prefix (first few characters) for display
pub fn get_key_prefix(provider: &str) -> Result<Option<String>, String> {
    match get_api_key(provider)? {
        Some(key) => {
            let prefix_len = std::cmp::min(8, key.len());
            Ok(Some(format!("{}...", &key[..prefix_len])))
        }
        None => Ok(None),
    }
}

/// Get status of all API keys
pub fn get_all_api_key_status() -> Result<HashMap<String, ApiKeyStatus>, String> {
    let mut result = HashMap::new();

    for provider in PROVIDERS {
        let exists = has_api_key(provider)?;
        let prefix = if exists {
            get_key_prefix(provider)?
        } else {
            None
        };

        result.insert(
            provider.to_string(),
            ApiKeyStatus {
                exists,
                prefix,
            },
        );
    }

    Ok(result)
}

/// API key status for display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyStatus {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

/// Check if any API key is stored
pub fn has_any_api_key() -> Result<bool, String> {
    for provider in PROVIDERS {
        if has_api_key(provider)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Store Bedrock credentials (JSON stringified)
pub fn store_bedrock_credentials(credentials: &str) -> Result<(), String> {
    store_api_key("bedrock", credentials)
}

/// Get Bedrock credentials (returns parsed object or None)
pub fn get_bedrock_credentials() -> Result<Option<BedrockCredentials>, String> {
    match get_api_key("bedrock")? {
        Some(stored) => match serde_json::from_str(&stored) {
            Ok(creds) => Ok(Some(creds)),
            Err(_) => Ok(None),
        },
        None => Ok(None),
    }
}

/// Bedrock credentials structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockCredentials {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
}

/// Clear all stored API keys
pub fn clear_all_api_keys() -> Result<(), String> {
    for provider in PROVIDERS {
        let _ = delete_api_key(provider);
    }
    Ok(())
}
