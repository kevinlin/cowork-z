use crate::types::LogPayload;

#[tauri::command]
pub async fn log_event(payload: LogPayload) -> Result<(), String> {
    println!(
        "[{}] {}",
        payload.level.unwrap_or_else(|| "info".to_string()),
        payload.message
    );
    Ok(())
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| format!("Failed to write file: {}", e))
}
