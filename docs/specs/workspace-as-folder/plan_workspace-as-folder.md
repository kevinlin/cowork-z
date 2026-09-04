# Workspace-as-Folder Phase 1 Implementation Plan

**Goal:** Add a workspace-per-folder model where each workspace is a unique directory, becomes the AI agent's CWD, scopes sessions, and provides a file tree browser.

**Architecture:** Single shared sidecar process reconfigures via `PATCH /config` on workspace switch (~1s SSE reconnection). New `workspaces` DB table with FK on tasks. Sidebar gets a workspace switcher dropdown and Sessions/Files tabs. Filesystem watching via `notify` crate.

**Tech Stack:** Rust (rusqlite, notify, std::fs), TypeScript/React (Zustand, Radix UI Tabs + DropdownMenu), Tauri IPC

**Design doc:** [`design_workspace-as-folder.md`](design_workspace-as-folder.md)

---

## Implementation Summary

### Task 1: DB Migration v2

Added `migrate_v2` creating the `workspaces` table, adding `workspace_id` FK to `tasks`, and adding settings columns. Bumped `CURRENT_VERSION` from 1 to 2.

### Task 2: Workspace DB CRUD module

Created `db/workspaces.rs` with `StoredWorkspace` struct and full CRUD: `save_workspace`, `get_workspace`, `get_workspace_by_path`, `list_workspaces`, `remove_workspace`, `update_last_opened_at`, `assign_task_to_workspace`. Added `get_last_workspace_id` / `set_last_workspace_id` settings helpers.

### Task 3: Restricted path validation

Created `workspace_validator.rs` with platform-aware blocklists. macOS blocks system paths (`/System`, `/usr`, `/bin`, etc.), exact home dir, and volume mount roots. Windows blocks drive roots, system dirs, and exact home.

### Task 4: Workspace Tauri commands + types

Created `commands/workspaces.rs` with seven commands: `list_workspaces`, `get_active_workspace`, `add_workspace`, `remove_workspace`, `switch_workspace`, `read_directory`, `initialize_workspace`. Added `Workspace` and `DirectoryEntry` to `types.rs`. Bootstrap creates ~/Downloads as default workspace on first launch.

### Task 5: Sidecar integration — workspace as working_directory

Updated `start_task` and `resume_session` to pass `working_directory: Some(workspace_folder_path)` and inject the workspace folder as a read-write permission into `sidecar_perms`.

### Task 6: Sidecar config-builder — workspace permission handling

Updated `buildSessionConfig` to grant workspace-sourced folders full read-write access with no prompts, while external folders follow the existing ask/deny logic.

### Task 7: Task listing workspace filtering

Added `list_tasks_by_workspace` query and updated the `list_tasks` command to accept an optional `workspace_id` parameter.

### Task 8: Remove default folder permissions

Replaced `get_default_folder_permissions` to return an empty vec — the workspace folder replaces the legacy ~/Downloads and ~/Desktop defaults.

### Task 9: Filesystem watching with `notify` crate

Added `notify` and `notify-debouncer-mini` dependencies. Created `fs_watcher.rs` with `FsWatcherState` managing debounced watchers. Wired into `switch_workspace` and `initialize_workspace`.

### Task 10: Frontend shared types

Created `src/shared/types/workspace.ts` with `Workspace` and `DirectoryEntry` types, exported from `src/shared/index.ts`.

### Task 11: Frontend API bridge

Added workspace invoke/listen functions to `tauri-api.ts` and `tauri-api-interface.ts`: workspace CRUD, directory reading, event listeners for `workspace:changed`, `workspace:added`, `workspace:removed`, `workspace:fs_changed`.

### Task 12: Workspace Zustand store

Created `workspaceStore.ts` with `initialize`, `switchWorkspace`, `addWorkspace`, `removeWorkspace` actions. Module-level event listeners sync state on `workspace:changed`.

### Task 13: Task store workspace scoping

Updated `listTasks` API to accept optional `workspaceId`. Updated `loadTasks` to filter by active workspace. Subscribed to workspace changes to reload tasks on switch.

### Task 14: Workspace switcher UI

Created `WorkspaceSwitcher.tsx` using Radix DropdownMenu — active workspace name + chevron, dropdown ordered by recency, remove button on hover, "Add Workspace…" item opening native folder picker.

### Task 15: Sidebar restructure

Added WorkspaceSwitcher above action buttons. Replaced ScrollArea with Radix Tabs (Sessions/Files). Removed ArtifactsPanel. Renamed FoldersPanel to "External Folders". Added workspace initialization on mount and workspace-switch reset (clear task state → navigate home → reload).

### Task 16: File tree browser

Created `useFileTree` hook with lazy-load, expand/collapse, refresh, and recursive search. Created `fileIcons.ts` for extension-based icon mapping. Created `FileTreePanel.tsx` with search bar, recursive tree, `workspace:fs_changed` subscription.

### Task 16b: File tree drag-and-drop to chat

Implemented intra-app drag-and-drop using Tauri's `onDragDropEvent` — HTML5 drag events don't fire in Tauri's webview. Module-level `pendingDragPath` bridges the drag source to drop targets in `DragDropTextarea` and `TaskInputBar`.

### Task 16c: Hidden files toggle

Added `isHiddenEntry` filter covering dotfiles, `~$` temp files, macOS system entries, and Windows system entries. Toggle button (Eye/EyeOff) in file tree header, hidden by default.

### Task 17: Cross-workspace task history

Added `workspace_id` to Rust `Task` type and all DB queries. Added `allTasks` + `loadAllTasks` to taskStore. Updated TaskLauncher to show all-workspace tasks with workspace names and auto-switch on cross-workspace selection.

### Task 18: Final verification and cleanup

Full type check, test run, and manual smoke test across all three suites (Vitest, Jest, cargo test).

---

## Critical Files

| Path | Role |
|------|------|
| `src-tauri/src/db/migrations.rs` | v2 migration (workspaces table, tasks FK) |
| `src-tauri/src/db/workspaces.rs` | Workspace CRUD |
| `src-tauri/src/workspace_validator.rs` | Restricted path blocklist |
| `src-tauri/src/commands/workspaces.rs` | Tauri workspace commands |
| `src-tauri/src/commands/files.rs` | File read + trash commands (Phase 2) |
| `src-tauri/src/fs_watcher.rs` | Filesystem watching |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | Workspace permission handling |
| `src/stores/workspaceStore.ts` | Workspace Zustand store |
| `src/stores/filePreviewStore.ts` | File preview Zustand store (Phase 2) |
| `src/hooks/useFileTree.ts` | File tree hook |
| `src/components/sidebar/FileTreePanel.tsx` | File tree + drag source |
| `src/components/sidebar/WorkspaceSwitcher.tsx` | Workspace dropdown |
| `src/components/file-preview/` | Preview panel components (Phase 2) |

---

## Changelog

- 2026-09-04 — **Compacted post-implementation.** Removed step-by-step tasks, file-by-file diffs, code snippets, and verification commands. Folded `plan_file-preview-panel.md` and `plan_unify-file-click-behavior.md` into this plan (both deleted). Preserved Goal, Implementation Summary, Critical Files, and Changelog. Original plans recoverable via git history.
- 2026-02-19 — **Fix: CodePreview theme-aware syntax highlighting.** `CodePreview` hardcoded `oneDark` style regardless of the active app theme. Fixed by using `useSyncExternalStore` + `MutationObserver` on `<html>` class changes to reactively detect dark mode. Key file: `src/components/file-preview/CodePreview.tsx`.
- 2026-02-17 — **Unify File Click Behavior to In-App Preview.** Aligned all file click paths with the in-app preview requirement (3.1, 6.4.1). Replaced `revealInFinder()` in `EnhancedLink.tsx` with `filePreviewStore.openPreviewByPath()`. Added "Open Externally" button to the preview header using `openPath` from `@tauri-apps/plugin-opener`. Added `opener:allow-open-path` permission with wildcard scope. Key files: `EnhancedLink.tsx`, `FilePreviewPanel.tsx`, `tauri-api.ts`, `default.json`. *(Folded from `plan_unify-file-click-behavior.md`.)*
- 2026-02-17 — **Phase 2: File Preview Panel.** Implemented closable, resizable right-side file preview panel (requirement 6.4). Supports code (theme-aware syntax highlighting), markdown, images, video, PDFs, HTML, plain text, and binary files. Fullscreen mode, "Add to Chat" button, symbolic link support, item actions (open externally, delete/trash), resizable 280–700px drag handle. Replaced `MediaPreviewModal` with the unified panel. Key files: `src-tauri/src/commands/files.rs`, `src/stores/filePreviewStore.ts`, `src/components/file-preview/`. See [`design_workspace-as-folder.md`](design_workspace-as-folder.md) §8. *(Folded from `plan_file-preview-panel.md`.)*
- 2026-02-17 — **Bugfix: Permission reply causes agent to hang.** Symptom: agent stopped responding after granting a permission. Root cause: (1) React Strict Mode double-mounting caused duplicate Tauri event listeners sending multiple `POST /permission/{id}/reply` calls; (2) `SessionManager.replyToPermission()` omitted `?directory=<workspace_path>`, so the server bootstrapped a new instance instead of routing to the waiting session. Fix: `cancelled` flag in `Execution.tsx`, `repliedPermissionIds` dedup in `taskStore.ts`, passed `managed.session.directory` in `session-manager.ts`. Design impact: added §3 entries in [`design_workspace-as-folder.md`](design_workspace-as-folder.md).
