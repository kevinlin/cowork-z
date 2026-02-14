use serde::Deserialize;
use tauri::State;

use crate::db;
use crate::db::DbState;
use crate::types::*;

#[tauri::command]
pub async fn test_ollama_connection(url: String) -> Result<ConnectionResult, String> {
    // Try to connect to Ollama and list models
    let client = reqwest::Client::new();
    let tags_url = format!("{}/api/tags", url.trim_end_matches('/'));

    match client.get(&tags_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                // Parse models from response
                #[derive(Deserialize)]
                struct OllamaTagsResponse {
                    models: Vec<OllamaModelInfo>,
                }
                #[derive(Deserialize)]
                struct OllamaModelInfo {
                    name: String,
                    size: u64,
                }

                match response.json::<OllamaTagsResponse>().await {
                    Ok(tags) => {
                        let models: Vec<OllamaModel> = tags
                            .models
                            .into_iter()
                            .map(|m| OllamaModel {
                                id: m.name.clone(),
                                display_name: m.name,
                                size: m.size,
                            })
                            .collect();

                        Ok(ConnectionResult {
                            success: true,
                            models: Some(models),
                            error: None,
                        })
                    }
                    Err(e) => Ok(ConnectionResult {
                        success: false,
                        models: None,
                        error: Some(format!("Failed to parse Ollama response: {}", e)),
                    }),
                }
            } else {
                Ok(ConnectionResult {
                    success: false,
                    models: None,
                    error: Some(format!("Ollama returned status: {}", response.status())),
                })
            }
        }
        Err(e) => Ok(ConnectionResult {
            success: false,
            models: None,
            error: Some(format!("Failed to connect to Ollama: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn get_ollama_config(state: State<'_, DbState>) -> Result<Option<OllamaConfig>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let config = db::settings::get_ollama_config(&conn);
    Ok(config.map(|c| OllamaConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| OllamaModel {
                    id: m.id,
                    display_name: m.display_name,
                    size: m.size,
                })
                .collect()
        }),
    }))
}

#[tauri::command]
pub async fn set_ollama_config(
    config: Option<OllamaConfig>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let db_config = config.map(|c| db::settings::OllamaConfig {
        base_url: c.base_url,
        enabled: c.enabled,
        last_validated: c.last_validated,
        models: c.models.map(|models| {
            models
                .into_iter()
                .map(|m| db::settings::OllamaModel {
                    id: m.id,
                    display_name: m.display_name,
                    size: m.size,
                })
                .collect()
        }),
    });
    db::settings::set_ollama_config(&conn, db_config.as_ref())
}
