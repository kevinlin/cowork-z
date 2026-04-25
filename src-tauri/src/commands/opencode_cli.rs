use crate::types::OpenCodeCliStatus;

/// Build an augmented PATH suitable for GUI-launched apps on all platforms.
///
/// On macOS, Finder/Dock/Spotlight give a minimal PATH. On Windows,
/// Start Menu/Explorer may omit user-installed tool directories.
/// This function merges the current PATH with login-shell PATH (Unix only)
/// and well-known tool directories for each platform.
fn get_augmented_path() -> String {
    let separator = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut dirs: Vec<String> = Vec::new();

    // Start with existing PATH entries
    for dir in current_path.split(separator).filter(|s| !s.is_empty()) {
        let key = if cfg!(target_os = "windows") {
            dir.to_lowercase()
        } else {
            dir.to_string()
        };
        if seen.insert(key) {
            dirs.push(dir.to_string());
        }
    }

    // Try to get the user's full login-shell PATH
    if cfg!(not(target_os = "windows")) {
        if let Some(user_shell) = get_safe_login_shell() {
            if let Ok(output) = std::process::Command::new(&user_shell)
                .args(["-ilc", "echo $PATH"])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .stdin(std::process::Stdio::null())
                .output()
            {
                if output.status.success() {
                    if let Ok(shell_path) = String::from_utf8(output.stdout) {
                        for dir in shell_path.trim().split(separator).filter(|s| !s.is_empty()) {
                            let key = if cfg!(target_os = "windows") {
                                dir.to_lowercase()
                            } else {
                                dir.to_string()
                            };
                            if seen.insert(key) {
                                dirs.push(dir.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Well-known directories as fallback
    let home = dirs::home_dir().unwrap_or_default();

    let well_known: Vec<String> = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let programfiles = std::env::var("ProgramFiles").unwrap_or_default();

        vec![
            format!("{}\\npm", appdata),                             // npm global
            format!("{}\\nodejs", programfiles),                     // Node.js install
            format!("{}\\Volta\\bin", localappdata),                 // Volta
            home.join("scoop\\shims").to_string_lossy().to_string(), // Scoop
            "C:\\ProgramData\\chocolatey\\bin".to_string(),          // Chocolatey
            format!("{}\\Yarn\\bin", localappdata),                  // Yarn
            format!("{}\\pnpm", localappdata),                       // pnpm
        ]
    } else {
        vec![
            "/opt/homebrew/bin".to_string(),
            "/opt/homebrew/sbin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/local/sbin".to_string(),
            home.join(".local/bin").to_string_lossy().to_string(),
            home.join(".volta/bin").to_string_lossy().to_string(),
            home.join(".npm-global/bin").to_string_lossy().to_string(),
            home.join(".yarn/bin").to_string_lossy().to_string(),
            home.join(".local/share/pnpm").to_string_lossy().to_string(),
            home.join(".local/share/fnm").to_string_lossy().to_string(),
        ]
    };

    // Add nvm/nvm-windows latest node version
    let nvm_base = if cfg!(target_os = "windows") {
        // nvm-windows: %APPDATA%\nvm or %NVM_HOME%
        let nvm_home = std::env::var("NVM_HOME").unwrap_or_else(|_| {
            let appdata = std::env::var("APPDATA").unwrap_or_default();
            format!("{}\\nvm", appdata)
        });
        std::path::PathBuf::from(nvm_home)
    } else {
        home.join(".nvm/versions/node")
    };
    if nvm_base.exists() {
        if let Ok(versions) = std::fs::read_dir(&nvm_base) {
            let mut version_dirs: Vec<String> = versions
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|name| name.starts_with('v'))
                .collect();
            version_dirs.sort();
            version_dirs.reverse();
            if let Some(latest) = version_dirs.first() {
                let nvm_bin = if cfg!(target_os = "windows") {
                    // nvm-windows puts node.exe directly in the version dir
                    nvm_base.join(latest).to_string_lossy().to_string()
                } else {
                    nvm_base
                        .join(latest)
                        .join("bin")
                        .to_string_lossy()
                        .to_string()
                };
                let key = if cfg!(target_os = "windows") {
                    nvm_bin.to_lowercase()
                } else {
                    nvm_bin.clone()
                };
                if seen.insert(key) {
                    if std::path::Path::new(&nvm_bin).exists() {
                        dirs.push(nvm_bin);
                    }
                }
            }
        }
    }

    for dir in well_known {
        let key = if cfg!(target_os = "windows") {
            dir.to_lowercase()
        } else {
            dir.clone()
        };
        if seen.insert(key) {
            if std::path::Path::new(&dir).exists() {
                dirs.push(dir);
            }
        }
    }

    dirs.join(separator)
}

fn get_safe_login_shell() -> Option<String> {
    const ALLOWED_SHELLS: &[&str] = &[
        "/bin/zsh",
        "/bin/bash",
        "/bin/sh",
        "/usr/bin/zsh",
        "/usr/bin/bash",
        "/usr/bin/sh",
        "/opt/homebrew/bin/bash",
    ];

    if let Ok(shell) = std::env::var("SHELL") {
        if ALLOWED_SHELLS.contains(&shell.as_str()) && std::path::Path::new(&shell).exists() {
            return Some(shell);
        }
    }

    ALLOWED_SHELLS
        .iter()
        .find(|shell| std::path::Path::new(*shell).exists())
        .map(|shell| shell.to_string())
}

#[tauri::command]
pub async fn check_opencode_cli() -> Result<OpenCodeCliStatus, String> {
    // Build augmented PATH for CLI lookup (macOS GUI apps get minimal PATH)
    let augmented_path = get_augmented_path();

    // Check if opencode CLI is installed using augmented PATH
    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("where")
            .arg("opencode")
            .env("PATH", &augmented_path)
            .output()
    } else {
        std::process::Command::new("which")
            .arg("opencode")
            .env("PATH", &augmented_path)
            .output()
    };

    match output {
        Ok(out) if out.status.success() => {
            // Try to get version
            let version_output = std::process::Command::new("opencode")
                .arg("--version")
                .env("PATH", &augmented_path)
                .output();

            let version = version_output.ok().and_then(|v| {
                if v.status.success() {
                    String::from_utf8(v.stdout)
                        .ok()
                        .map(|s| s.trim().to_string())
                } else {
                    None
                }
            });

            Ok(OpenCodeCliStatus {
                installed: true,
                version,
                install_command: "npm install -g opencode-ai".to_string(),
            })
        }
        _ => Ok(OpenCodeCliStatus {
            installed: false,
            version: None,
            install_command: "npm install -g opencode-ai".to_string(),
        }),
    }
}

#[tauri::command]
pub async fn get_opencode_version() -> Result<Option<String>, String> {
    let augmented_path = get_augmented_path();
    let output = std::process::Command::new("opencode")
        .arg("--version")
        .env("PATH", &augmented_path)
        .output();

    Ok(output.ok().and_then(|v| {
        if v.status.success() {
            String::from_utf8(v.stdout)
                .ok()
                .map(|s| s.trim().to_string())
        } else {
            None
        }
    }))
}
