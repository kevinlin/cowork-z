use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;

/// Read UTF-8 text content from a file.
///
/// Returns the file content as a string. Rejects files larger than `max_size`
/// (default 1 MB) to prevent loading huge files into memory.
#[tauri::command]
pub async fn read_file_content(path: String, max_size: Option<u64>) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let limit = max_size.unwrap_or(1024 * 1024); // 1 MB default
    if metadata.len() > limit {
        return Err(format!(
            "File too large: {} bytes (limit: {} bytes)",
            metadata.len(),
            limit
        ));
    }

    std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read binary content from a file and return it as a base64-encoded string.
///
/// Used for images, PDFs, and other binary formats that need to be displayed
/// in the webview. Rejects files larger than `max_size` (default 10 MB).
#[tauri::command]
pub fn read_binary_file(path: String, max_size: Option<u64>) -> Result<String, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

    let limit = max_size.unwrap_or(10 * 1024 * 1024); // 10 MB default
    if metadata.len() > limit {
        return Err(format!(
            "File too large: {} bytes (limit: {} bytes)",
            metadata.len(),
            limit
        ));
    }

    let bytes = std::fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(STANDARD.encode(&bytes))
}

/// Move a file to the system trash (macOS Trash / Windows Recycle Bin / Linux freedesktop trash).
#[tauri::command]
pub async fn trash_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    trash::delete(file_path).map_err(|e| format!("Failed to move to trash: {}", e))
}
