// Template: a Tauri command in src-tauri/src/commands/<domain>.rs
// Delete the shape you don't need. Keep the file's existing import block.

use tauri::State;

use crate::db::DbState;

// ---------------------------------------------------------------------------
// Shape A — plain command (no caller-supplied path)
// ---------------------------------------------------------------------------

/// One line on what this returns and when the frontend calls it.
#[tauri::command]
pub async fn example_command(
    // TS sends camelCase (`someArg`); Tauri binds it to this snake_case param.
    some_arg: String,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let _ = &conn;

    Ok(some_arg)
}

// ---------------------------------------------------------------------------
// Shape B — command that accepts a path
//
// MANDATORY: canonicalize and check against the allowed roots before touching
// the filesystem. `validate_path_allowed` resolves symlinks and `..`, then
// checks the result against registered workspaces + granted permission folders
// + app-managed dirs. Validate the returned PathBuf, never the raw argument.
// Reference: src-tauri/src/commands/files.rs
// ---------------------------------------------------------------------------

use std::path::PathBuf;

use crate::path_guard;

fn validate_path(
    path: &str,
    state: &State<'_, DbState>,
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    path_guard::validate_path_allowed(path, &conn, app)
}

/// One line on what this does to the file at `path`.
#[tauri::command]
pub async fn example_path_command(
    path: String,
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<u64, String> {
    let target = validate_path(&path, &state, &app)?;

    // Every fs call below uses `target`, never `path`.
    let metadata =
        std::fs::metadata(&target).map_err(|e| format!("Failed to read metadata: {}", e))?;

    Ok(metadata.len())
}

// ---------------------------------------------------------------------------
// Tests — extract logic out of the command body so it runs without a State.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    #[test]
    fn placeholder() {
        assert!(true);
    }
}
