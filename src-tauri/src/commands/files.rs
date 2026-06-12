use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;
use tauri::State;

use crate::db::DbState;
use crate::path_guard;

/// Resolve and validate `path` against the allowed roots (registered
/// workspaces + granted permission folders + app-managed dirs).
/// See technical review findings #3 and #2.
fn validate_path(
    path: &str,
    state: &State<'_, DbState>,
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let mut roots = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        path_guard::allowed_roots(&conn)
    };
    roots.extend(path_guard::app_managed_roots(app));
    path_guard::validate_path_in_roots(path, &roots)
}

/// Read UTF-8 text content from a file.
///
/// Returns the file content as a string. Rejects files larger than `max_size`
/// (default 1 MB) to prevent loading huge files into memory, and paths outside
/// the workspace/granted folders.
#[tauri::command]
pub async fn read_file_content(
    path: String,
    max_size: Option<u64>,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let file_path = validate_path(&path, &state, &app)?;

    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    let metadata =
        std::fs::metadata(&file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let limit = max_size.unwrap_or(1024 * 1024); // 1 MB default
    if metadata.len() > limit {
        return Err(format!(
            "File too large: {} bytes (limit: {} bytes)",
            metadata.len(),
            limit
        ));
    }

    std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read binary content from a file and return it as a base64-encoded string.
///
/// Used for images, PDFs, and other binary formats that need to be displayed
/// in the webview. Rejects files larger than `max_size` (default 10 MB), and
/// paths outside the workspace/granted folders.
#[tauri::command]
pub fn read_binary_file(
    path: String,
    max_size: Option<u64>,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let file_path = validate_path(&path, &state, &app)?;

    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    let metadata =
        std::fs::metadata(&file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let limit = max_size.unwrap_or(10 * 1024 * 1024); // 10 MB default
    if metadata.len() > limit {
        return Err(format!(
            "File too large: {} bytes (limit: {} bytes)",
            metadata.len(),
            limit
        ));
    }

    let bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(STANDARD.encode(&bytes))
}

/// Move a file to the system trash (macOS Trash / Windows Recycle Bin / Linux freedesktop trash).
/// Restricted to the workspace/granted folders.
#[tauri::command]
pub async fn trash_file(
    path: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let file_path = validate_path(&path, &state, &app)?;
    trash::delete(&file_path).map_err(|e| format!("Failed to move to trash: {}", e))
}
