//! Canonical path validation for filesystem Tauri commands.
//!
//! Commands reachable from the renderer must not operate on arbitrary
//! absolute paths (technical review finding #3). Every read/trash target is
//! canonicalized (resolving symlinks and `..`) and checked against the
//! allowed roots: registered workspace folders and granted permission
//! folders.

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Collect the allowed root directories: every registered workspace folder
/// plus every granted permission folder (across all workspaces). Granted
/// folders persisted by older versions are re-validated at load time so a
/// bad historical grant (e.g. `/` or `~/.ssh`) cannot re-open the sandbox.
pub fn allowed_roots(conn: &Connection) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = crate::db::workspaces::list_workspaces(conn)
        .unwrap_or_default()
        .into_iter()
        .map(|ws| PathBuf::from(ws.folder_path))
        .collect();

    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT folder_path FROM workspace_permissions") {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            roots.extend(
                rows.filter_map(|r| r.ok())
                    .filter_map(|p| validate_grant_path(&p).ok())
                    .map(PathBuf::from),
            );
        }
    }

    roots
}

/// Credential/key directories under the user's home that must never become
/// permission grants, regardless of how the grant was requested.
const SENSITIVE_HOME_DIRS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker",
    ".azure",
    "Library/Keychains",
];

/// Validate a folder path before it is persisted as a workspace permission
/// grant (technical review 2026-06-12 finding #3). Grants feed directly into
/// `allowed_roots` and the `asset:` protocol scope, so they get the same
/// system-path rules as workspaces plus a credential-directory denylist.
/// Returns the canonicalized path to persist.
///
/// The deepest existing ancestor is canonicalized (resolving symlinks and
/// `..`) and any not-yet-created tail segments are re-appended, so grants
/// for folders the agent is about to create still validate.
pub fn validate_grant_path(folder_path: &str) -> Result<String, String> {
    let path = Path::new(folder_path);
    if !path.is_absolute() {
        return Err("Permission grant paths must be absolute".to_string());
    }

    let resolved = resolve_with_missing_tail(path)?;
    let resolved_str = resolved.to_string_lossy().to_string();

    crate::workspace_validator::validate_workspace_path(&resolved_str)
        .map_err(|e| format!("Folder cannot be granted: {}", e))?;

    if let Some(home) = dirs::home_dir() {
        for sensitive in SENSITIVE_HOME_DIRS {
            let sensitive_path = home.join(sensitive);
            if resolved == sensitive_path || resolved.starts_with(&sensitive_path) {
                return Err(format!(
                    "Access to '{}' cannot be granted",
                    sensitive_path.display()
                ));
            }
        }
    }

    Ok(resolved_str)
}

/// Canonicalize the deepest existing ancestor of `path` and re-append the
/// missing tail. Rejects `.`/`..` segments in the missing tail (they cannot
/// be resolved against not-yet-existing directories).
fn resolve_with_missing_tail(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();

    while !existing.exists() {
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name.to_os_string());
                existing = parent;
            }
            _ => {
                return Err(format!(
                    "Cannot resolve path {}: traversal segments in a non-existing path",
                    path.display()
                ))
            }
        }
    }

    let mut resolved = existing
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path {}: {}", path.display(), e))?;
    for segment in tail.iter().rev() {
        let s = segment.to_string_lossy();
        if s == "." || s == ".." {
            return Err("Path traversal segments are not allowed".to_string());
        }
        resolved.push(segment);
    }
    Ok(resolved)
}

/// App-managed directories that previews may legitimately read from:
/// the app data dir (skill repo caches, packs) and the skill install
/// target folders browsed by the Skills Manager.
pub fn app_managed_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(data_dir) = app.path().app_data_dir() {
        roots.push(data_dir);
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".config/opencode/skills"));
        roots.push(home.join(".claude/skills"));
        roots.push(home.join(".agents/skills"));
    }
    roots
}

/// Extend the `asset:` protocol scope to the allowed roots (registered
/// workspaces, granted folders, app-managed dirs). The static scope in
/// `tauri.conf.json` is empty (technical review finding #2), so media
/// previews only work for directories explicitly allowed here.
pub fn sync_asset_scope(app: &tauri::AppHandle, conn: &Connection) {
    let scope = app.asset_protocol_scope();
    let mut roots = allowed_roots(conn);
    roots.extend(app_managed_roots(app));
    for root in roots {
        if let Err(e) = scope.allow_directory(&root, true) {
            eprintln!(
                "[warn] Failed to add {} to asset protocol scope: {}",
                root.display(),
                e
            );
        }
    }
}

/// Validate `path` against every allowed root: registered workspaces,
/// granted permission folders, and app-managed directories. This is the
/// single gate used by all renderer-reachable filesystem commands.
pub fn validate_path_allowed(
    path: &str,
    conn: &Connection,
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let mut roots = allowed_roots(conn);
    roots.extend(app_managed_roots(app));
    validate_path_in_roots(path, &roots)
}

/// Canonicalize `path` and ensure it lives inside one of `roots`.
/// Returns the canonical path on success. The target must exist (read and
/// trash both operate on existing files).
pub fn validate_path_in_roots(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path {}: {}", path, e))?;

    for root in roots {
        // Canonicalize each root too so symlinked workspace folders compare
        // correctly; skip roots that no longer exist.
        let Ok(canonical_root) = root.canonicalize() else {
            continue;
        };
        if canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }

    Err(format!(
        "Access denied: {} is outside the active workspace and granted folders",
        path
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("path-guard-test-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_path_inside_root_allowed() {
        let root = temp_dir("inside");
        let file = root.join("file.txt");
        std::fs::write(&file, "x").unwrap();

        let result = validate_path_in_roots(&file.to_string_lossy(), &[root.clone()]);
        assert!(result.is_ok());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn test_path_outside_root_denied() {
        let root = temp_dir("outside-root");
        let other = temp_dir("outside-other");
        let file = other.join("file.txt");
        std::fs::write(&file, "x").unwrap();

        let result = validate_path_in_roots(&file.to_string_lossy(), &[root.clone()]);
        assert!(result.is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&other).ok();
    }

    #[test]
    fn test_dotdot_traversal_denied() {
        let root = temp_dir("traversal");
        let sibling = temp_dir("traversal-sibling");
        let secret = sibling.join("secret.txt");
        std::fs::write(&secret, "x").unwrap();

        // Path that is textually under the root but escapes via ..
        let sneaky = format!(
            "{}/../{}/secret.txt",
            root.to_string_lossy(),
            sibling.file_name().unwrap().to_string_lossy()
        );
        let result = validate_path_in_roots(&sneaky, &[root.clone()]);
        assert!(result.is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&sibling).ok();
    }

    #[cfg(unix)]
    #[test]
    fn test_symlink_escape_denied() {
        let root = temp_dir("symlink-root");
        let outside = temp_dir("symlink-outside");
        let secret = outside.join("secret.txt");
        std::fs::write(&secret, "x").unwrap();

        let link = root.join("link.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        // The symlink lives inside the root but resolves outside of it
        let result = validate_path_in_roots(&link.to_string_lossy(), &[root.clone()]);
        assert!(result.is_err());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn test_nonexistent_path_denied() {
        let root = temp_dir("nonexistent");
        let result = validate_path_in_roots(&root.join("missing.txt").to_string_lossy(), &[root.clone()]);
        assert!(result.is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn test_no_roots_denied() {
        let dir = temp_dir("no-roots");
        let file = dir.join("file.txt");
        std::fs::write(&file, "x").unwrap();

        let result = validate_path_in_roots(&file.to_string_lossy(), &[]);
        assert!(result.is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_grant_root_denied() {
        assert!(validate_grant_path("/").is_err());
    }

    #[test]
    fn test_grant_home_root_denied() {
        let home = dirs::home_dir().unwrap();
        assert!(validate_grant_path(&home.to_string_lossy()).is_err());
    }

    #[test]
    fn test_grant_system_dir_denied() {
        assert!(validate_grant_path("/etc").is_err());
        assert!(validate_grant_path("/usr/local").is_err());
    }

    #[test]
    fn test_grant_sensitive_home_dirs_denied() {
        let home = dirs::home_dir().unwrap();
        for dir in [".ssh", ".aws", ".gnupg", "Library/Keychains"] {
            let path = home.join(dir);
            assert!(
                validate_grant_path(&path.to_string_lossy()).is_err(),
                "expected {} to be denied",
                path.display()
            );
        }
        // Subdirectories of sensitive dirs are denied too
        let nested = home.join(".ssh/keys");
        assert!(validate_grant_path(&nested.to_string_lossy()).is_err());
    }

    #[test]
    fn test_grant_traversal_into_sensitive_denied() {
        let home = dirs::home_dir().unwrap();
        // Existing-ancestor traversal is canonicalized away and lands on ~/.ssh
        let sneaky = home.join("Downloads/../.ssh");
        assert!(validate_grant_path(&sneaky.to_string_lossy()).is_err());
        // Traversal through a non-existing segment is rejected outright
        let sneaky_missing = home.join("definitely-missing-dir-xyz/../.ssh");
        assert!(validate_grant_path(&sneaky_missing.to_string_lossy()).is_err());
    }

    #[test]
    fn test_grant_relative_denied() {
        assert!(validate_grant_path("relative/path").is_err());
    }

    #[test]
    fn test_grant_home_subfolder_allowed() {
        let home = dirs::home_dir().unwrap();
        let path = home.join("Downloads");
        let result = validate_grant_path(&path.to_string_lossy());
        assert!(result.is_ok());
    }

    #[test]
    fn test_grant_missing_tail_allowed_and_resolved() {
        let home = dirs::home_dir().unwrap();
        let path = home.join("Downloads/not-yet-created-dir-xyz/output");
        let result = validate_grant_path(&path.to_string_lossy());
        assert!(result.is_ok());
        assert!(result.unwrap().ends_with("not-yet-created-dir-xyz/output"));
    }
}
