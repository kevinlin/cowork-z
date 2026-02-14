use crate::secure_storage;
use crate::types::*;

#[tauri::command]
pub async fn validate_bedrock_credentials(credentials: String) -> Result<ValidationResult, String> {
    // Parse and validate the credentials format
    match serde_json::from_str::<BedrockCredentials>(&credentials) {
        Ok(creds) => {
            if creds.access_key_id.is_empty()
                || creds.secret_access_key.is_empty()
                || creds.region.is_empty()
            {
                Ok(ValidationResult {
                    valid: false,
                    error: Some("All credential fields are required".to_string()),
                })
            } else {
                Ok(ValidationResult {
                    valid: true,
                    error: None,
                })
            }
        }
        Err(e) => Ok(ValidationResult {
            valid: false,
            error: Some(format!("Invalid credentials format: {}", e)),
        }),
    }
}

#[tauri::command]
pub async fn save_bedrock_credentials(credentials: String) -> Result<ApiKeyConfig, String> {
    secure_storage::store_bedrock_credentials(&credentials)?;

    Ok(ApiKeyConfig {
        id: "apikey-bedrock".to_string(),
        provider: "bedrock".to_string(),
        label: Some("AWS Bedrock".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn get_bedrock_credentials() -> Result<Option<BedrockCredentials>, String> {
    match secure_storage::get_bedrock_credentials()? {
        Some(creds) => Ok(Some(BedrockCredentials {
            access_key_id: creds.access_key_id,
            secret_access_key: creds.secret_access_key,
            region: creds.region,
        })),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn fetch_bedrock_models(_credentials: String) -> Result<BedrockModelsResult, String> {
    // TODO: Implement AWS Bedrock model listing
    Ok(BedrockModelsResult {
        success: false,
        models: vec![],
        error: Some("Bedrock not yet implemented".to_string()),
    })
}
