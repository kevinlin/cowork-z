// src-tauri/src/fs_watcher.rs
//! Filesystem watcher for workspace folder changes

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct FsWatcherState {
    watcher: Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
}

impl FsWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }
}

/// Directories whose internal churn should not trigger file-tree refreshes.
/// These are hidden from the sidebar tree anyway (`isHiddenEntry` filters
/// dotfiles), and `.git`/`node_modules` produce floods of events during
/// agent-driven git and package operations.
const NOISY_DIR_COMPONENTS: &[&str] = &[".git", "node_modules", ".DS_Store"];

/// True when a changed path lives inside a directory the UI never shows,
/// so a refresh would be pure overhead.
fn is_noisy_path(path: &Path) -> bool {
    path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        NOISY_DIR_COMPONENTS.contains(&name.as_ref())
    })
}

/// Start watching a folder for changes, emitting `workspace:fs_changed` events.
/// Replaces any existing watcher.
///
/// The watch is recursive (2026-06-12 review #19): agents routinely write
/// into nested folders, and a non-recursive watch left the sidebar tree and
/// artifacts panel stale for anything below the workspace root. Noise is
/// bounded by the 300ms debounce, a per-batch single emit, and skipping
/// always-hidden directories like `.git`.
pub fn watch_folder(app: &AppHandle, folder_path: &str) -> Result<(), String> {
    let state = app.state::<FsWatcherState>();
    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    // Drop existing watcher
    *watcher_guard = None;

    let app_handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = events {
                // One emit per debounce batch — the frontend refreshes the
                // whole tree root regardless of which path changed, so
                // per-path emits only multiply work.
                let changed = events.iter().find(|event| {
                    event.kind == DebouncedEventKind::Any && !is_noisy_path(&event.path)
                });
                if let Some(event) = changed {
                    let changed_path = event.path.to_string_lossy().to_string();
                    let _ = app_handle.emit(
                        "workspace:fs_changed",
                        serde_json::json!({ "changedPath": changed_path }),
                    );
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(Path::new(folder_path), notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch folder: {}", e))?;

    *watcher_guard = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noisy_paths_are_skipped() {
        assert!(is_noisy_path(Path::new("/ws/.git/objects/ab/cdef")));
        assert!(is_noisy_path(Path::new("/ws/sub/node_modules/pkg/index.js")));
        assert!(is_noisy_path(Path::new("/ws/sub/.DS_Store")));
    }

    #[test]
    fn normal_workspace_paths_are_not_skipped() {
        assert!(!is_noisy_path(Path::new("/ws/Output/report.md")));
        assert!(!is_noisy_path(Path::new("/ws/deep/nested/dir/file.txt")));
        // Similar names that are not exact components must not match
        assert!(!is_noisy_path(Path::new("/ws/gitignore-notes.md")));
        assert!(!is_noisy_path(Path::new("/ws/my_node_modules_backup/x")));
    }
}
