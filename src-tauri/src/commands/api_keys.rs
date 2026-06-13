use std::collections::HashMap;

use crate::secure_storage;
use crate::types::*;

#[tauri::command]
pub async fn get_api_keys() -> Result<Vec<ApiKeyConfig>, String> {
    let status = secure_storage::get_all_api_key_status()?;
    let mut keys = Vec::new();

    for (provider, key_status) in status {
        if key_status.exists {
            keys.push(ApiKeyConfig {
                id: format!("apikey-{}", provider),
                provider: provider.clone(),
                label: Some(provider),
                created_at: chrono::Utc::now().to_rfc3339(),
            });
        }
    }

    Ok(keys)
}

#[tauri::command]
pub async fn add_api_key(
    provider: String,
    key: String,
    label: Option<String>,
) -> Result<ApiKeyConfig, String> {
    secure_storage::store_api_key(&provider, &key)?;

    Ok(ApiKeyConfig {
        id: format!("apikey-{}", provider),
        provider: provider.clone(),
        label,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn remove_api_key(id: String) -> Result<(), String> {
    // Extract provider from id (format: "apikey-{provider}")
    let provider = id.strip_prefix("apikey-").unwrap_or(&id);
    secure_storage::delete_api_key(provider)?;
    Ok(())
}

#[tauri::command]
pub async fn has_api_key() -> Result<bool, String> {
    // Check for default provider (anthropic)
    secure_storage::has_api_key("anthropic")
}

#[tauri::command]
pub async fn set_api_key(key: String) -> Result<(), String> {
    // Set default provider key (anthropic)
    secure_storage::store_api_key("anthropic", &key)
}

// `get_api_key` (returning the full keychain secret to the webview) was
// removed — the UI only needs existence/prefix info, which
// `get_all_api_keys` provides (technical review 2026-06-12 finding #13).
// Full secrets stay Rust-side.

#[tauri::command]
pub async fn validate_api_key(_key: String) -> Result<ValidationResult, String> {
    // Basic validation - check key format
    Ok(ValidationResult {
        valid: true,
        error: None,
    })
}

#[tauri::command]
pub async fn validate_api_key_for_provider(
    provider: String,
    key: String,
    _options: Option<HashMap<String, serde_json::Value>>,
) -> Result<ValidationResult, String> {
    // Validate API key format based on provider
    let valid = match provider.as_str() {
        "anthropic" => key.starts_with("sk-ant-"),
        "openai" => key.starts_with("sk-"),
        "google" => !key.is_empty(),
        "openrouter" => key.starts_with("sk-or-"),
        _ => !key.is_empty(),
    };

    if valid {
        Ok(ValidationResult {
            valid: true,
            error: None,
        })
    } else {
        Ok(ValidationResult {
            valid: false,
            error: Some(format!("Invalid API key format for provider: {}", provider)),
        })
    }
}

#[tauri::command]
pub async fn clear_api_key() -> Result<(), String> {
    // Clear default provider key (anthropic)
    secure_storage::delete_api_key("anthropic")?;
    Ok(())
}

#[tauri::command]
pub async fn get_all_api_keys() -> Result<HashMap<String, ApiKeyStatus>, String> {
    let status = secure_storage::get_all_api_key_status()?;
    Ok(status
        .into_iter()
        .map(|(k, v)| {
            (
                k,
                ApiKeyStatus {
                    exists: v.exists,
                    prefix: v.prefix,
                },
            )
        })
        .collect())
}

#[tauri::command]
pub async fn has_any_api_key() -> Result<bool, String> {
    secure_storage::has_any_api_key()
}
