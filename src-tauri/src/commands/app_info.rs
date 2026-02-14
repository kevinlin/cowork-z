#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub fn get_arch() -> String {
    std::env::consts::ARCH.to_string()
}

#[tauri::command]
pub async fn is_e2e_mode() -> Result<bool, String> {
    Ok(std::env::var("E2E_MODE").is_ok())
}
