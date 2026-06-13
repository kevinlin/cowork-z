// src-tauri/src/workspace_validator.rs
//! Platform-aware validation of workspace folder paths

use std::path::Path;

/// Canonicalize a folder path (resolving symlinks and `..`) and validate the
/// resolved path as a workspace (technical review 2026-06-12 finding #15).
/// The path must exist. Returns the canonical path to persist, so symlinks
/// can never alias a workspace root to a different tree than was validated.
pub fn validate_and_canonicalize_workspace_path(folder_path: &str) -> Result<String, String> {
    let path = Path::new(folder_path);
    if !path.is_absolute() {
        return Err("Workspace path must be absolute".to_string());
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve workspace path '{}': {}", folder_path, e))?;

    let mut canonical_str = canonical.to_string_lossy().to_string();
    // Windows canonicalize() yields verbatim paths (\\?\C:\...); strip the
    // prefix so the drive-letter rules below apply.
    if let Some(stripped) = canonical_str.strip_prefix(r"\\?\") {
        canonical_str = stripped.to_string();
    }

    validate_workspace_path(&canonical_str)?;
    Ok(canonical_str)
}

/// Validate that a folder path is safe to use as a workspace.
/// Returns `Ok(())` if allowed, or `Err` with a human-readable reason if blocked.
///
/// Note: this checks rules against the path string as given. Callers taking
/// untrusted input should use [`validate_and_canonicalize_workspace_path`]
/// (or canonicalize themselves, as `path_guard::validate_grant_path` does)
/// so symlinks and `..` cannot dodge the rules.
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
    let blocked_exact = [
        "/",
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private",
        "/Applications",
    ];
    for blocked in &blocked_exact {
        if folder_path == *blocked
            || (folder_path != "/"
                && folder_path.starts_with(&format!("{}/", blocked))
                && *blocked != "/")
        {
            // Allow subfolders of home, but block system paths and their children
        }
        if folder_path == *blocked {
            return Err(format!(
                "'{}' is a system directory and cannot be used as a workspace",
                blocked
            ));
        }
    }

    // Block system directory subtrees (but not home subtrees)
    let blocked_prefixes = [
        "/System/",
        "/usr/",
        "/bin/",
        "/sbin/",
        "/etc/",
        "/var/",
        "/private/",
        "/Applications/",
    ];
    for prefix in &blocked_prefixes {
        if folder_path.starts_with(prefix) {
            return Err(format!(
                "Paths under '{}' cannot be used as workspaces",
                &prefix[..prefix.len() - 1]
            ));
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
            return Err(format!(
                "Volume root '{}' cannot be used as a workspace. Choose a subfolder instead.",
                folder_path
            ));
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

    // Outside the home tree, only mounted-volume subtrees and the macOS
    // shared-users folder are allowed (2026-06-12 review #15). Anything else
    // (/tmp, /opt, another user's home, ...) is rejected rather than falling
    // through to "allowed".
    if folder_path.starts_with("/Volumes/")
        || folder_path == "/Users/Shared"
        || folder_path.starts_with("/Users/Shared/")
    {
        return Ok(());
    }
    let linux_mount_prefixes = ["/media/", "/run/media/", "/mnt/"];
    for prefix in &linux_mount_prefixes {
        if folder_path.starts_with(prefix) {
            return Ok(());
        }
    }

    Err(format!(
        "'{}' is outside your home folder and mounted volumes, so it cannot be used as a workspace",
        folder_path
    ))
}

fn validate_windows(folder_path: &str) -> Result<(), String> {
    let normalized = folder_path.replace('/', "\\");
    let upper = normalized.to_uppercase();

    // Block drive roots (e.g., C:\, D:\)
    if upper.len() <= 3 && upper.chars().nth(1) == Some(':') {
        return Err(format!(
            "Drive root '{}' cannot be used as a workspace",
            folder_path
        ));
    }

    // Block system directories
    let blocked = [
        "\\WINDOWS",
        "\\PROGRAM FILES",
        "\\PROGRAM FILES (X86)",
        "\\PROGRAMDATA",
    ];
    for suffix in &blocked {
        // Match C:\Windows, D:\Windows, etc.
        if upper.len() >= 3 && upper[2..].starts_with(suffix) {
            let blocked_path = &normalized[..2 + suffix.len()];
            if upper.len() == 2 + suffix.len() || upper.as_bytes()[2 + suffix.len()] == b'\\' {
                return Err(format!(
                    "'{}' is a system directory and cannot be used as a workspace",
                    blocked_path
                ));
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

    #[test]
    fn test_non_home_non_volume_blocked() {
        assert!(validate_workspace_path("/tmp").is_err());
        assert!(validate_workspace_path("/opt/projects").is_err());
        assert!(validate_workspace_path("/home/otheruser/stuff").is_err());
    }

    #[test]
    fn test_shared_users_folder_allowed() {
        assert!(validate_workspace_path("/Users/Shared/projects").is_ok());
    }

    #[test]
    fn test_linux_mount_subtrees_allowed() {
        assert!(validate_workspace_path("/media/me/usb/projects").is_ok());
        assert!(validate_workspace_path("/run/media/me/usb").is_ok());
        assert!(validate_workspace_path("/mnt/data/projects").is_ok());
    }

    #[test]
    fn test_canonicalize_missing_path_blocked() {
        assert!(validate_and_canonicalize_workspace_path("/definitely/missing/dir-xyz").is_err());
    }

    #[cfg(unix)]
    fn symlink_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ws-validator-test-{}-{}",
            name,
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn test_canonicalize_resolves_symlink_to_allowed_target() {
        let Some(home) = dirs::home_dir() else { return };
        let target = home.join("Downloads");
        if !target.is_dir() {
            return; // environment without ~/Downloads
        }

        let dir = symlink_test_dir("allowed");
        let link = dir.join("link-to-downloads");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&target, &link).unwrap();

        // The link lives in a blocked tree (temp), but it resolves into the
        // home tree — the canonical target is what gets validated/persisted.
        let result = validate_and_canonicalize_workspace_path(&link.to_string_lossy());
        assert!(result.is_ok(), "expected symlink-to-home allowed: {:?}", result);
        assert_eq!(
            result.unwrap(),
            target.canonicalize().unwrap().to_string_lossy()
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn test_canonicalize_blocks_symlink_to_system_dir() {
        let home = match dirs::home_dir() {
            Some(h) => h,
            None => return,
        };
        // Place the link inside the home tree so only the *target* is bad.
        let dir = home.join(format!(".ws-validator-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let link = dir.join("link-to-etc");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink("/etc", &link).unwrap();

        assert!(validate_and_canonicalize_workspace_path(&link.to_string_lossy()).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
