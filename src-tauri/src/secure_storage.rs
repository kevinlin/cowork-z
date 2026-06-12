// src-tauri/src/secure_storage.rs
//! Secure storage using OS Keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Service name for keychain entries.
/// In dev profile (debug_assertions), append `-dev` so dev and release
/// keychain entries never collide.
fn service_name() -> &'static str {
    if cfg!(debug_assertions) {
        "com.kevinlin.cowork-z-dev"
    } else {
        "com.kevinlin.cowork-z"
    }
}

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

/// One-time migration: move an Azure Foundry key stored under the legacy
/// `azureFoundry` keychain id (used before the provider id was standardized
/// to `azure-foundry`) to the canonical id, then delete the legacy entry.
///
/// Without this, deleting the key via the UI (which only knows the canonical
/// id) would leave the legacy entry behind, and any read-time fallback would
/// silently resurrect a key the user believes is removed.
pub fn migrate_legacy_azure_foundry_key() {
    let legacy_key = match get_api_key("azureFoundry") {
        Ok(Some(key)) => key,
        _ => return,
    };

    // A key already stored under the canonical id wins; never overwrite it.
    let canonical_exists = matches!(has_api_key("azure-foundry"), Ok(true));
    if !canonical_exists && store_api_key("azure-foundry", &legacy_key).is_err() {
        // Copy failed — keep the legacy entry so the key is not lost.
        return;
    }

    if let Err(e) = delete_api_key("azureFoundry") {
        eprintln!("[warn] Failed to delete legacy azureFoundry keychain entry: {}", e);
    }
}

/// Store an API key in the OS keychain
pub fn store_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let entry =
        Entry::new(service_name(), provider).map_err(|e| format!("Keychain error: {}", e))?;

    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store API key: {}", e))?;

    Ok(())
}

/// Retrieve an API key from the OS keychain
pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    let entry =
        Entry::new(service_name(), provider).map_err(|e| format!("Keychain error: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get API key: {}", e)),
    }
}

/// Delete an API key from the OS keychain
pub fn delete_api_key(provider: &str) -> Result<bool, String> {
    let entry =
        Entry::new(service_name(), provider).map_err(|e| format!("Keychain error: {}", e))?;

    match entry.delete_password() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to delete API key: {}", e)),
    }
}

/// Check if an API key exists for a provider
pub fn has_api_key(provider: &str) -> Result<bool, String> {
    let entry =
        Entry::new(service_name(), provider).map_err(|e| format!("Keychain error: {}", e))?;

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

        result.insert(provider.to_string(), ApiKeyStatus { exists, prefix });
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
