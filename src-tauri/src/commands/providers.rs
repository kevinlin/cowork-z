use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::secure_storage;
use crate::types::*;

#[tauri::command]
pub async fn get_selected_model(
    state: State<'_, DbState>,
) -> Result<Option<SelectedModel>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let model = db::settings::get_selected_model(&conn);
    Ok(model.map(|m| SelectedModel {
        provider: m.provider,
        model: m.model,
        base_url: m.base_url,
        deployment_name: m.deployment_name,
    }))
}

#[tauri::command]
pub async fn set_selected_model(
    model: SelectedModel,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_model = db::settings::SelectedModel {
        provider: model.provider,
        model: model.model,
        base_url: model.base_url,
        deployment_name: model.deployment_name,
    };
    db::settings::set_selected_model(&conn, Some(&db_model))
}

#[tauri::command]
pub async fn get_provider_settings(state: State<'_, DbState>) -> Result<ProviderSettings, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let settings = db::providers::get_provider_settings(&conn);

    let connected_providers: HashMap<String, ConnectedProviderResponse> = settings
        .connected_providers
        .into_iter()
        .map(|(k, v)| {
            // Build config object with both credentials and availableModels
            let config = {
                let mut map = serde_json::Map::new();
                if let Ok(creds) = serde_json::to_value(&v.credentials) {
                    map.insert("credentials".to_string(), creds);
                }
                if let Some(models) = &v.available_models {
                    if let Ok(models_val) = serde_json::to_value(models) {
                        map.insert("availableModels".to_string(), models_val);
                    }
                }
                Some(serde_json::Value::Object(map))
            };
            (
                k,
                ConnectedProviderResponse {
                    id: v.provider_id,
                    selected_model: v.selected_model_id,
                    config,
                },
            )
        })
        .collect();

    Ok(ProviderSettings {
        active_provider: settings.active_provider_id,
        connected_providers,
        debug_mode: settings.debug_mode,
    })
}

#[tauri::command]
pub async fn set_active_provider(
    provider_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::set_active_provider(&conn, provider_id.as_deref())
}

#[tauri::command]
pub async fn get_connected_provider(
    provider_id: String,
    state: State<'_, DbState>,
) -> Result<Option<ConnectedProviderResponse>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let provider = db::providers::get_connected_provider(&conn, &provider_id);

    Ok(provider.map(|p| {
        let config = {
            let mut map = serde_json::Map::new();
            if let Ok(creds) = serde_json::to_value(&p.credentials) {
                map.insert("credentials".to_string(), creds);
            }
            if let Some(models) = &p.available_models {
                if let Ok(models_val) = serde_json::to_value(models) {
                    map.insert("availableModels".to_string(), models_val);
                }
            }
            Some(serde_json::Value::Object(map))
        };
        ConnectedProviderResponse {
            id: p.provider_id,
            selected_model: p.selected_model_id,
            config,
        }
    }))
}

#[tauri::command]
pub async fn set_connected_provider(
    provider_id: String,
    provider: ConnectedProviderInput,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    // Extract available models from config.availableModels (sent by the frontend)
    let available_models = provider
        .config
        .as_ref()
        .and_then(|c| c.get("availableModels"))
        .and_then(|v| serde_json::from_value::<Vec<db::providers::AvailableModel>>(v.clone()).ok());

    // Convert input to db type
    let db_provider = db::providers::ConnectedProvider {
        provider_id: provider.id,
        connection_status: "connected".to_string(),
        selected_model_id: provider.selected_model,
        credentials: db::providers::ProviderCredentials {
            credentials_type: "api_key".to_string(),
            key_prefix: None,
            server_url: None,
            api_key: None,
            extra: HashMap::new(),
        },
        last_connected_at: chrono::Utc::now().to_rfc3339(),
        available_models,
    };

    db::providers::set_connected_provider(&conn, &provider_id, &db_provider)
}

#[tauri::command]
pub async fn remove_connected_provider(
    provider_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::remove_connected_provider(&conn, &provider_id)
}

#[tauri::command]
pub async fn update_provider_model(
    provider_id: String,
    model_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::update_provider_model(&conn, &provider_id, model_id.as_deref())
}

#[tauri::command]
pub async fn set_provider_debug_mode(
    enabled: bool,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::providers::set_provider_debug_mode(&conn, enabled)
}

#[tauri::command]
pub async fn get_provider_debug_mode(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(db::providers::get_provider_debug_mode(&conn))
}

// ============================================================================
// Dynamic Provider Model Discovery
// ============================================================================

/// Shared helper for providers that use the OpenAI-compatible `/v1/models` response format.
/// Used by xAI and DeepSeek.
async fn fetch_openai_compatible_models(
    api_key: &str,
    base_url: &str,
    provider_name: &str,
) -> ProviderModelsResult {
    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct ModelsResponse {
                    data: Vec<ModelInfo>,
                }
                #[derive(Deserialize)]
                struct ModelInfo {
                    id: String,
                }

                match response.json::<ModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .data
                            .into_iter()
                            .map(|m| ProviderModel {
                                name: m.id.clone(),
                                provider: provider_name.to_string(),
                                context_length: 0,
                                id: m.id,
                            })
                            .collect();
                        models_ok(models)
                    }
                    Err(e) => {
                        models_error(format!("Failed to parse {} response: {}", provider_name, e))
                    }
                }
            } else {
                models_error(format!(
                    "{} returned status: {}",
                    provider_name,
                    response.status()
                ))
            }
        }
        Err(e) => models_error(format!("Failed to connect to {}: {}", provider_name, e)),
    }
}

async fn fetch_anthropic_models(api_key: &str) -> ProviderModelsResult {
    let client = reqwest::Client::new();

    match client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct AnthropicModelsResponse {
                    data: Vec<AnthropicModelInfo>,
                }
                #[derive(Deserialize)]
                struct AnthropicModelInfo {
                    id: String,
                    #[serde(default)]
                    display_name: Option<String>,
                }

                match response.json::<AnthropicModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .data
                            .into_iter()
                            .map(|m| ProviderModel {
                                name: m.display_name.unwrap_or_else(|| m.id.clone()),
                                provider: "anthropic".to_string(),
                                context_length: 0,
                                id: m.id,
                            })
                            .collect();
                        models_ok(models)
                    }
                    Err(e) => models_error(format!("Failed to parse Anthropic response: {}", e)),
                }
            } else {
                models_error(format!("Anthropic returned status: {}", response.status()))
            }
        }
        Err(e) => models_error(format!("Failed to connect to Anthropic: {}", e)),
    }
}

async fn fetch_openai_models(api_key: &str) -> ProviderModelsResult {
    let client = reqwest::Client::new();

    match client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct OpenAIModelsResponse {
                    data: Vec<OpenAIModelInfo>,
                }
                #[derive(Deserialize)]
                struct OpenAIModelInfo {
                    id: String,
                }

                // Prefixes to exclude (non-chat models)
                let exclude_prefixes = [
                    "text-embedding",
                    "tts-",
                    "whisper",
                    "dall-e",
                    "davinci",
                    "babbage",
                    "moderation",
                    "text-",
                    "embedding",
                    "canary-",
                    "ft:",
                ];

                match response.json::<OpenAIModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .data
                            .into_iter()
                            .filter(|m| {
                                !exclude_prefixes
                                    .iter()
                                    .any(|prefix| m.id.starts_with(prefix))
                            })
                            .map(|m| ProviderModel {
                                name: m.id.clone(),
                                provider: "openai".to_string(),
                                context_length: 0,
                                id: m.id,
                            })
                            .collect();
                        models_ok(models)
                    }
                    Err(e) => models_error(format!("Failed to parse OpenAI response: {}", e)),
                }
            } else {
                models_error(format!("OpenAI returned status: {}", response.status()))
            }
        }
        Err(e) => models_error(format!("Failed to connect to OpenAI: {}", e)),
    }
}

async fn fetch_google_models(api_key: &str) -> ProviderModelsResult {
    let client = reqwest::Client::new();
    let url = "https://generativelanguage.googleapis.com/v1beta/models";

    match client
        .get(url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct GoogleModelsResponse {
                    models: Vec<GoogleModelInfo>,
                }
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct GoogleModelInfo {
                    name: String,
                    #[serde(default)]
                    display_name: Option<String>,
                    #[serde(default)]
                    supported_generation_methods: Vec<String>,
                }

                match response.json::<GoogleModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .models
                            .into_iter()
                            .filter(|m| {
                                m.supported_generation_methods
                                    .iter()
                                    .any(|method| method == "generateContent")
                            })
                            .map(|m| {
                                // Strip "models/" prefix from name
                                let id = m
                                    .name
                                    .strip_prefix("models/")
                                    .unwrap_or(&m.name)
                                    .to_string();
                                ProviderModel {
                                    name: m.display_name.unwrap_or_else(|| id.clone()),
                                    provider: "google".to_string(),
                                    context_length: 0,
                                    id,
                                }
                            })
                            .collect();
                        models_ok(models)
                    }
                    Err(e) => models_error(format!("Failed to parse Google response: {}", e)),
                }
            } else {
                models_error(format!("Google returned status: {}", response.status()))
            }
        }
        Err(e) => models_error(format!("Failed to connect to Google: {}", e)),
    }
}

async fn fetch_openrouter_models(api_key: &str) -> ProviderModelsResult {
    let client = reqwest::Client::new();

    match client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://cowork-z.app")
        .header("X-Title", "Cowork-Z")
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct OpenRouterApiResponse {
                    data: Vec<OpenRouterApiModel>,
                }
                #[derive(Deserialize)]
                struct OpenRouterApiModel {
                    id: String,
                    name: String,
                    #[serde(default)]
                    context_length: Option<u64>,
                }

                match response.json::<OpenRouterApiResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .data
                            .into_iter()
                            .map(|m| {
                                let provider =
                                    m.id.split('/').next().unwrap_or("unknown").to_string();
                                ProviderModel {
                                    id: m.id,
                                    name: m.name,
                                    provider,
                                    context_length: m.context_length.unwrap_or(0),
                                }
                            })
                            .collect();
                        models_ok(models)
                    }
                    Err(e) => models_error(format!("Failed to parse OpenRouter response: {}", e)),
                }
            } else {
                models_error(format!("OpenRouter returned status: {}", response.status()))
            }
        }
        Err(e) => models_error(format!("Failed to connect to OpenRouter: {}", e)),
    }
}

#[tauri::command]
pub async fn fetch_provider_models(provider: String) -> Result<ProviderModelsResult, String> {
    // Retrieve API key from OS keychain
    let api_key = match secure_storage::get_api_key(&provider) {
        Ok(Some(key)) => key,
        Ok(None) => {
            return Ok(models_error(format!("No {} API key configured", provider)));
        }
        Err(e) => {
            return Ok(models_error(format!("Failed to retrieve API key: {}", e)));
        }
    };

    let result = match provider.as_str() {
        "anthropic" => fetch_anthropic_models(&api_key).await,
        "openai" => fetch_openai_models(&api_key).await,
        "google" => fetch_google_models(&api_key).await,
        "xai" => fetch_openai_compatible_models(&api_key, "https://api.x.ai/v1", "xai").await,
        "deepseek" => {
            fetch_openai_compatible_models(&api_key, "https://api.deepseek.com", "deepseek").await
        }
        "openrouter" => fetch_openrouter_models(&api_key).await,
        _ => models_error(format!(
            "Dynamic model discovery not supported for provider: {}",
            provider
        )),
    };

    Ok(result)
}
