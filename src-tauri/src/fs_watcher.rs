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

/// Start watching a folder for changes, emitting `workspace:fs_changed` events.
/// Replaces any existing watcher.
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
                for event in events {
                    if event.kind == DebouncedEventKind::Any {
                        let changed_path = event.path.to_string_lossy().to_string();
                        let _ = app_handle.emit(
                            "workspace:fs_changed",
                            serde_json::json!({ "changedPath": changed_path }),
                        );
                    }
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(Path::new(folder_path), notify::RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch folder: {}", e))?;

    *watcher_guard = Some(debouncer);
    Ok(())
}
