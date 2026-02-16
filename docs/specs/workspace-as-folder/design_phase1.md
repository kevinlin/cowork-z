# Workspace-as-Folder — Design Document Phase 1

Date: 2026-02-16

## Overview

Cowork-Z adopts a workspace-per-folder model where each workspace is defined by a unique directory on the filesystem. The workspace folder becomes the AI agent's working directory, the root of the file tree browser, and the scope for session history. A single shared sidecar process serves all workspaces by reconfiguring on switch.

## Phasing

- **Phase 1 (this document):** Workspace lifecycle, switching, file tree browser, permission integration.
- **Phase 2 (future):** File preview panel (code highlighting, markdown rendering, images, PDF, HTML, presentations), fullscreen mode, "Add to Chat" bridge.

---

## 1. Workspace Data Model

### New DB Table: `workspaces`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `folder_path` | TEXT UNIQUE | Absolute path to the folder |
| `display_name` | TEXT | Folder basename (e.g. "my-project") |
| `created_at` | INTEGER | Unix timestamp |
| `last_opened_at` | INTEGER | Updated on each switch; used for startup restore |

### Session Scoping

Task/session records gain a `workspace_id` foreign key. The Sessions tab filters by the active workspace. Existing sessions created before this feature get assigned to a legacy workspace mapped to ~/Downloads.

### App Settings

A `last_workspace_id` setting (stored via existing settings DB) is read on app launch to restore the last-used workspace. On first-ever launch, ~/Downloads is created as the default workspace.

---

## 2. Restricted Paths

Workspace creation validates the selected folder against a platform-aware blocklist. Subfolders of the user's home directory are always allowed (e.g. ~/Downloads, ~/Documents, ~/Projects/foo).

### macOS

| Blocked Path | Reason |
|-------------|--------|
| `/` | System root |
| `/System` | System files |
| `/usr` | System binaries |
| `/bin` | System binaries |
| `/sbin` | System binaries |
| `/etc` | System configuration |
| `/var` | System data |
| `/private` | macOS system internals |
| `~` (home root exactly) | Too broad — contains Library, caches, etc. |
| `/Volumes/*` (volume mount points) | Entire drives |
| `/Applications` | Application bundles |

### Windows

| Blocked Path | Reason |
|-------------|--------|
| Drive roots (`C:\`, `D:\`, etc.) | Entire drives |
| `C:\Windows` | System files |
| `C:\Program Files` | Installed applications |
| `C:\Program Files (x86)` | Installed applications (32-bit) |
| `C:\ProgramData` | System-wide app data |
| `%USERPROFILE%` (home root exactly) | Too broad |
| `%SystemRoot%` | System directory |
| `%WINDIR%` | Windows directory |

Validation uses `std::env::consts::OS` in Rust to select the appropriate blocklist.

---

## 3. Workspace Switching & Sidecar Integration

### Approach: Reconfigure-on-Switch

A single sidecar process serves all workspaces. Switching workspaces reconfigures the OpenCode server via `PATCH /config`.

### Switch Flow

1. **Frontend** calls `switch_workspace(workspace_id)` Tauri command
2. **Rust** updates `last_workspace_id` in settings, updates `last_opened_at` on the workspace record
3. **Rust** sends `PATCH /config` to sidecar with the new workspace folder as the working directory and updated permission rules
4. **SSE reconnects** with the new directory scope (~1s)
5. **Rust** emits a `workspace:changed` Tauri event to the frontend
6. **Frontend** reloads: session list (filtered to new workspace), file tree (rooted at new folder), clears active task view

### New Task Flow

When starting a task in the active workspace, `start_task` sends `working_directory: Some(workspace_folder_path)` instead of `None`. The OpenCode server uses this as the session's CWD.

### SSE Directory Scoping

OpenCode scopes SSE events per-directory. The sidecar's EventStream **must** connect with a `?directory=<workspace_path>` query parameter matching the workspace folder; otherwise only global events (`server.connected`, `server.heartbeat`) are received, and session lifecycle events (`session.status`, `session.idle`, `message.updated`, `message.part.updated`) are silently dropped.

The `workingDirectory` from each task payload is passed through `initialize()` to the `EventStream` constructor. On subsequent tasks, if the directory changes (workspace switch), the EventStream disconnects and reconnects with the new directory scope via `reconnectWithDirectory()`. This ensures the sidecar receives session events for whichever workspace is currently active.

### Missing Folder Handling

On switch (or app launch), Rust checks if the workspace folder exists. If not:
- Show an error toast to the user
- Fall back to ~/Downloads (creating it as a workspace if needed)
- The missing workspace stays in the dropdown list, greyed out with a warning icon, so the user can re-mount/restore and retry

---

## 4. Workspace Switcher UI

### Location

Top of the left sidebar, above the Sessions/Files tabs.

### Default State

Shows the current workspace's `display_name` (folder basename) with a chevron-down icon. Truncated with ellipsis if the name is long. Tooltip shows the full absolute path on hover.

### Dropdown Contents

- List of all workspaces, ordered by `last_opened_at` descending (most recent first)
- Each item shows: folder basename + full path in smaller muted text
- Active workspace has a checkmark indicator
- Missing/unavailable workspaces shown greyed out with a warning icon
- Divider line
- **"Add Workspace..."** button at the bottom — opens a native folder picker

Each non-active workspace has a remove button (X) on hover.

### Adding a Workspace

1. User clicks "Add Workspace..."
2. Native folder picker opens (`@tauri-apps/plugin-dialog` with `directory: true`)
3. Path validated against the restricted blocklist
4. If blocked: error toast explaining why
5. If path already exists as a workspace: switches to it (no duplicate)
6. Otherwise: creates workspace record, switches to it

### Removing a Workspace

1. User clicks X on a workspace in the dropdown
2. Confirmation dialog: "Remove [name] from workspaces? Sessions and history will be preserved and restored if you re-add this folder."
3. On confirm: workspace removed from list; sessions preserved in DB keyed by `folder_path`
4. Cannot remove the currently active workspace — must switch away first
5. Re-adding the same folder path later restores its sessions

---

## 5. File Tree Browser (Phase 1)

### Tab Structure

The left sidebar panel gets two tabs: **Sessions** (existing session list) and **Files** (new file tree). Both tabs are always visible regardless of whether a task is active.

### Tree Root

Always the active workspace folder. No breadcrumbs or navigation above the root.

### Lazy Loading

Children are loaded on demand — a folder's contents are fetched only when the user expands it. This avoids scanning deep project trees upfront.

### Backend API

New Tauri command: `read_directory(path: String) -> Vec<DirectoryEntry>`

Each `DirectoryEntry` contains:
- `name: String` — file or folder name
- `path: String` — absolute path
- `is_directory: bool`
- `size: Option<u64>` — file size in bytes (None for directories)
- `extension: Option<String>`

Results sorted: directories first, then files, both alphabetical.

### Tree Display

- Collapse/expand chevron for directories
- Type-specific icons:
  - Directories: folder closed/open (primary app color)
  - Images (`png jpg jpeg gif svg webp`): image icon
  - Code (`ts tsx js jsx rs py java c cpp go`): code file icon
  - Data/config (`json yaml yml toml`): JSON file icon
  - Everything else: text file icon
- File name, truncated with ellipsis if too long
- File size right-aligned for files only
- Selected file highlighted with distinct background

### Search & Filter

- Search bar pinned at the top of the file tree
- Real-time, case-insensitive, name-based filtering
- Recursive: if a child matches, parent directories are shown even if their names don't match
- Only already-loaded (expanded) subtrees are searched
- "No files match your search" message when empty
- Clearing the query restores the full tree

### Filesystem Watching

Rust watches the workspace folder using the `notify` crate (or Tauri's fs-watch plugin). Changes are debounced at 200ms. On change, Rust emits a `workspace:fs_changed` Tauri event. The frontend re-reads only affected expanded directories, preserving expand/collapse state.

AI sidecar file operations also trigger a tree refresh (debounced at 150ms) to ensure the tree stays current even if OS notifications are unreliable.

### No Preview (Phase 1)

Clicking a file in the tree selects/highlights it but does not open a preview panel. Phase 2 adds the right-side file preview.

### Not Supported

- File mutations (rename, delete, move, copy, create)
- Context menus / right-click actions
- Drag-and-drop
- Multi-file selection
- List or grid view alternatives
- User-configurable sort order
- Breadcrumb navigation

---

## 6. Permissions Integration

### Workspace Folder = Trusted Zone

The workspace folder and all its descendants are always permitted with read-write access. No permission prompts are shown for file operations within the workspace. This is injected automatically into every task's permission config.

### External Folders

The current "Folders" sidebar panel is renamed to **"External Folders"**. It grants the AI agent access to folders outside the workspace, per-task, with user-selected access levels (read-only or read-write). Behavior is identical to the current Folders panel.

### Default Folders Removed

The implicit default permissions for ~/Downloads and ~/Desktop (read-only) are removed. The workspace folder replaces that concept. If the user needs access to ~/Desktop while working in ~/Projects/foo, they add it as an external folder.

### Permission Config Build Order (config-builder.ts)

1. **Workspace folder** → read-write (always, no prompt)
2. **External folders** for the active task → their configured access level
3. **Adhoc grants** from runtime permission prompts → as granted

### Artifacts Panel Removed

The existing Artifacts panel is removed from the sidebar. With the workspace folder as the CWD, files created by the AI agent appear in the file tree automatically via filesystem watching.

---

## 7. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Escape | Exit fullscreen preview (Phase 2) |

No new keyboard shortcuts in Phase 1. Cmd+N (new task) and Cmd+K (launcher) continue to work within the active workspace context.
