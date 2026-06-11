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
/// plus every granted permission folder (across all workspaces).
pub fn allowed_roots(conn: &Connection) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = crate::db::workspaces::list_workspaces(conn)
        .into_iter()
        .map(|ws| PathBuf::from(ws.folder_path))
        .collect();

    if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT folder_path FROM workspace_permissions") {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            roots.extend(rows.filter_map(|r| r.ok()).map(PathBuf::from));
        }
    }

    roots
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
}
