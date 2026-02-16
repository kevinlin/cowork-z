// src-tauri/src/workspace_validator.rs
//! Platform-aware validation of workspace folder paths

use std::path::Path;

/// Validate that a folder path is safe to use as a workspace.
/// Returns `Ok(())` if allowed, or `Err` with a human-readable reason if blocked.
pub fn validate_workspace_path(folder_path: &str) -> Result<(), String> {
    let path = Path::new(folder_path);

    // Must be absolute
    if !path.is_absolute() {
        return Err("Workspace path must be absolute".to_string());
    }

    if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
        validate_unix(folder_path)
    } else if cfg!(target_os = "windows") {
        validate_windows(folder_path)
    } else {
        Ok(())
    }
}

fn validate_unix(folder_path: &str) -> Result<(), String> {
    let path = Path::new(folder_path);

    // Blocked exact paths and prefixes
    let blocked_exact = ["/", "/System", "/usr", "/bin", "/sbin", "/etc", "/var", "/private", "/Applications"];
    for blocked in &blocked_exact {
        if folder_path == *blocked || (folder_path != "/" && folder_path.starts_with(&format!("{}/", blocked)) && *blocked != "/") {
            // Allow subfolders of home, but block system paths and their children
        }
        if folder_path == *blocked {
            return Err(format!("'{}' is a system directory and cannot be used as a workspace", blocked));
        }
    }

    // Block system directory subtrees (but not home subtrees)
    let blocked_prefixes = ["/System/", "/usr/", "/bin/", "/sbin/", "/etc/", "/var/", "/private/", "/Applications/"];
    for prefix in &blocked_prefixes {
        if folder_path.starts_with(prefix) {
            return Err(format!("Paths under '{}' cannot be used as workspaces", &prefix[..prefix.len() - 1]));
        }
    }

    // Block /Volumes mount points (but allow subdirectories of volumes)
    if folder_path == "/Volumes" {
        return Err("'/Volumes' cannot be used as a workspace".to_string());
    }
    if folder_path.starts_with("/Volumes/") {
        // /Volumes/DriveName is blocked, /Volumes/DriveName/subfolder is allowed
        let rest = &folder_path["/Volumes/".len()..];
        if !rest.contains('/') {
            return Err(format!("Volume root '{}' cannot be used as a workspace. Choose a subfolder instead.", folder_path));
        }
    }

    // Block exact home directory
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy();
        if folder_path == home_str.as_ref() {
            return Err("Your home directory cannot be used as a workspace. Choose a subfolder like ~/Downloads or ~/Projects.".to_string());
        }
        // Subfolders of home are allowed
        if path.starts_with(&home) {
            return Ok(());
        }
    }

    Ok(())
}

fn validate_windows(folder_path: &str) -> Result<(), String> {
    let normalized = folder_path.replace('/', "\\");
    let upper = normalized.to_uppercase();

    // Block drive roots (e.g., C:\, D:\)
    if upper.len() <= 3 && upper.chars().nth(1) == Some(':') {
        return Err(format!("Drive root '{}' cannot be used as a workspace", folder_path));
    }

    // Block system directories
    let blocked = ["\\WINDOWS", "\\PROGRAM FILES", "\\PROGRAM FILES (X86)", "\\PROGRAMDATA"];
    for suffix in &blocked {
        // Match C:\Windows, D:\Windows, etc.
        if upper.len() >= 3 && upper[2..].starts_with(suffix) {
            let blocked_path = &normalized[..2 + suffix.len()];
            if upper.len() == 2 + suffix.len() || upper.as_bytes()[2 + suffix.len()] == b'\\' {
                return Err(format!("'{}' is a system directory and cannot be used as a workspace", blocked_path));
            }
        }
    }

    // Block exact home directory
    if let Some(home) = dirs::home_dir() {
        let home_str = home.to_string_lossy().to_uppercase().replace('/', "\\");
        if upper == home_str {
            return Err("Your home directory cannot be used as a workspace. Choose a subfolder like Documents or Downloads.".to_string());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_blocked() {
        assert!(validate_workspace_path("/").is_err());
    }

    #[test]
    fn test_system_dirs_blocked() {
        assert!(validate_workspace_path("/System").is_err());
        assert!(validate_workspace_path("/usr").is_err());
        assert!(validate_workspace_path("/bin").is_err());
        assert!(validate_workspace_path("/sbin").is_err());
        assert!(validate_workspace_path("/etc").is_err());
        assert!(validate_workspace_path("/var").is_err());
        assert!(validate_workspace_path("/private").is_err());
        assert!(validate_workspace_path("/Applications").is_err());
    }

    #[test]
    fn test_system_subtrees_blocked() {
        assert!(validate_workspace_path("/System/Library").is_err());
        assert!(validate_workspace_path("/usr/local").is_err());
        assert!(validate_workspace_path("/private/var").is_err());
    }

    #[test]
    fn test_volumes_root_blocked() {
        assert!(validate_workspace_path("/Volumes").is_err());
        assert!(validate_workspace_path("/Volumes/MyDrive").is_err());
    }

    #[test]
    fn test_volumes_subfolder_allowed() {
        assert!(validate_workspace_path("/Volumes/MyDrive/projects").is_ok());
    }

    #[test]
    fn test_home_subdir_allowed() {
        if let Some(home) = dirs::home_dir() {
            let downloads = home.join("Downloads");
            assert!(validate_workspace_path(downloads.to_str().unwrap()).is_ok());

            let projects = home.join("Projects").join("my-app");
            assert!(validate_workspace_path(projects.to_str().unwrap()).is_ok());
        }
    }

    #[test]
    fn test_exact_home_blocked() {
        if let Some(home) = dirs::home_dir() {
            assert!(validate_workspace_path(home.to_str().unwrap()).is_err());
        }
    }

    #[test]
    fn test_relative_path_blocked() {
        assert!(validate_workspace_path("relative/path").is_err());
        assert!(validate_workspace_path("./relative").is_err());
    }
}
