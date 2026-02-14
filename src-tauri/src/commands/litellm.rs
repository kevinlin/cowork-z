use serde::Deserialize;
use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::types::*;

#[tauri::command]
pub async fn test_litellm_connection(
    url: String,
    _api_key: Option<String>,
) -> Result<ProviderModelsResult, String> {
    let client = reqwest::Client::new();
    let models_url = format!("{}/models", url.trim_end_matches('/'));

    match client.get(&models_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                #[derive(Deserialize)]
                struct LiteLLMModelsResponse {
                    data: Vec<LiteLLMModelInfo>,
                }
                #[derive(Deserialize)]
                struct LiteLLMModelInfo {
                    id: String,
                    #[serde(default)]
                    owned_by: String,
                }

                match response.json::<LiteLLMModelsResponse>().await {
                    Ok(resp) => {
                        let models: Vec<ProviderModel> = resp
                            .data
                            .into_iter()
                            .map(|m| ProviderModel {
                                id: m.id.clone(),
                                name: m.id,
                                provider: m.owned_by,
                                context_length: 0,
                            })
                            .collect();
                        Ok(models_ok(models))
                    }
                    Err(e) => Ok(models_error(format!("Failed to parse LiteLLM response: {}", e))),
                }
            } else {
                Ok(models_error(format!("LiteLLM returned status: {}", response.status())))
            }
        }
        Err(e) => Ok(models_error(format!("Failed to connect to LiteLLM: {}", e))),
    }
}

#[tauri::command]
pub async fn fetch_litellm_models() -> Result<ProviderModelsResult, String> {
    Ok(models_error("LiteLLM not yet implemented".to_string()))
}

#[tauri::command]
pub async fn get_litellm_config(state: State<'_, DbState>) -> Result<Option<LiteLLMConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_litellm_config(&conn);
    Ok(config.map(|c| LiteLLMConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| ProviderModel {
                    id: m.id,
                    name: m.name,
                    provider: m.provider,
                    context_length: m.context_length,
                })
                .collect()
        }),
    }))
}

#[tauri::command]
pub async fn set_litellm_config(
    config: Option<LiteLLMConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::LiteLLMConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| db::settings::LiteLLMModel {
                    id: m.id,
                    name: m.name,
                    provider: m.provider,
                    context_length: m.context_length,
                })
                .collect()
        }),
    });
    db::settings::set_litellm_config(&conn, db_config.as_ref())
}
