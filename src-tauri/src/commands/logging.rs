use serde::Deserialize;
use tauri_plugin_dialog::DialogExt;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// Open a native save dialog and write `contents` to the user-chosen path.
///
/// The destination path is chosen through the OS dialog Rust-side and never
/// supplied by the renderer, so this cannot be used as an arbitrary
/// file-write primitive (replaces the unscoped `write_text_file` command —
/// technical review finding #3). Returns the saved path, or `None` if the
/// user cancelled.
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    contents: String,
    default_filename: Option<String>,
    title: Option<String>,
    filters: Option<Vec<ExportFileFilter>>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(name) = default_filename {
        builder = builder.set_file_name(name);
    }
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    for filter in filters.unwrap_or_default() {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(filter.name.clone(), &extensions);
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let Some(file_path) = rx.await.map_err(|e| format!("Save dialog failed: {}", e))? else {
        return Ok(None);
    };
    let path = file_path
        .into_path()
        .map_err(|e| format!("Invalid save path: {}", e))?;

    std::fs::write(&path, &contents).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
