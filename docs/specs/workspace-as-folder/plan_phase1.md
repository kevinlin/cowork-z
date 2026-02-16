# Workspace-as-Folder Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a workspace-per-folder model where each workspace is a unique directory, becomes the AI agent's CWD, scopes sessions, and provides a file tree browser.

**Architecture:** Single shared sidecar process reconfigures via `PATCH /config` on workspace switch (~1s SSE reconnection). New `workspaces` DB table with FK on tasks. Sidebar gets a workspace switcher dropdown and Sessions/Files tabs. Filesystem watching via `notify` crate.

**Tech Stack:** Rust (rusqlite, notify, std::fs), TypeScript/React (Zustand, Radix UI Tabs + DropdownMenu), Tauri IPC

**Design doc:** `docs/specs/workspace-as-folder/design_phase1.md`

---

## Task 1: DB Migration v2 — workspaces table + tasks FK + settings column

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`

**Step 1: Write `migrate_v2` function**

Add after `migrate_v1`:

**Step 2: Wire into `run_migrations`**

Change `CURRENT_VERSION` from `1` to `2`. Add after the `if stored_version < 1` block:

**Step 3: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 2: Workspace DB CRUD module

**Files:**
- Create: `src-tauri/src/db/workspaces.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod workspaces;`)
- Modify: `src-tauri/src/db/settings.rs` (add `get_last_workspace_id` / `set_last_workspace_id`)

**Step 1: Create `db/workspaces.rs`**

Define `StoredWorkspace` struct (same pattern as `StoredFolderPermission` in `db/folder_permissions.rs`):

Add CRUD functions:
- `save_workspace(conn, ws: &StoredWorkspace) -> Result<(), String>` — `INSERT OR REPLACE`
- `get_workspace(conn, id: &str) -> Option<StoredWorkspace>`
- `get_workspace_by_path(conn, folder_path: &str) -> Option<StoredWorkspace>`
- `list_workspaces(conn) -> Vec<StoredWorkspace>` — `ORDER BY last_opened_at DESC`
- `remove_workspace(conn, id: &str) -> Result<(), String>` — first `UPDATE tasks SET workspace_id = NULL WHERE workspace_id = ?1`, then `DELETE FROM workspaces WHERE id = ?1`
- `update_last_opened_at(conn, id: &str, ts: i64) -> Result<(), String>`
- `assign_task_to_workspace(conn, workspace_id: &str, task_id: &str) -> Result<(), String>` — `UPDATE tasks SET workspace_id = ?1 WHERE id = ?2`

**Step 2: Add settings helpers in `db/settings.rs`**

Follow the existing single-row pattern (e.g., `get_user_prompt_text` / `set_user_prompt_text`):

**Step 3: Register module in `db/mod.rs`**

Add `pub mod workspaces;` to the existing module list.

**Step 4: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 3: Restricted path validation

**Files:**
- Create: `src-tauri/src/workspace_validator.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod workspace_validator;`)

**Step 1: Implement `validate_workspace_path`**

```rust
pub fn validate_workspace_path(folder_path: &str) -> Result<(), String> {
    let path = std::path::Path::new(folder_path);
    let canonical = path.to_path_buf(); // Use as-is; canonical requires the path to exist

    if cfg!(target_os = "macos") {
        validate_macos(folder_path)
    } else if cfg!(target_os = "windows") {
        validate_windows(folder_path)
    } else {
        // Linux: minimal blocklist
        validate_linux(folder_path)
    }
}
```

macOS blocklist: `/`, `/System`, `/usr`, `/bin`, `/sbin`, `/etc`, `/var`, `/private`, `/Applications`, exact home dir, `/Volumes` direct children (volume mount roots). Use `dirs::home_dir()` to resolve home. Check with `starts_with` for prefix-blocked paths and exact match for others.

Windows blocklist: drive roots (single letter + `:\`), `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`, exact home dir. Resolve `%USERPROFILE%` etc. via `dirs::home_dir()`.

**Step 2: Add unit tests**

**Step 3: Register module**

Add `mod workspace_validator;` in `src-tauri/src/lib.rs` (after `pub mod types;`).

**Step 4: Verify**

Run: `cd src-tauri && cargo test` and `cd src-tauri && cargo check`

---

## Task 4: Workspace Tauri commands + types

**Files:**
- Create: `src-tauri/src/commands/workspaces.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod workspaces;`)
- Modify: `src-tauri/src/types.rs` (add `Workspace`, `DirectoryEntry` structs)
- Modify: `src-tauri/src/lib.rs` (register commands in `invoke_handler`)

**Step 1: Add types to `types.rs`**

**Step 2: Create `commands/workspaces.rs`**

Commands (all follow existing pattern from `commands/folder_permissions.rs`):

- `list_workspaces(state: State<'_, DbState>) -> Result<Vec<Workspace>, String>`
- `get_active_workspace(state: State<'_, DbState>) -> Result<Option<Workspace>, String>` — reads `last_workspace_id` from settings, fetches workspace
- `add_workspace(folder_path: String, state: State<'_, DbState>, app: AppHandle) -> Result<Workspace, String>` — validates path, checks for existing, creates UUID, saves, emits `workspace:added`
- `remove_workspace(workspace_id: String, state: State<'_, DbState>, app: AppHandle) -> Result<(), String>` — checks not active, calls `db::workspaces::remove_workspace`, emits `workspace:removed`
- `switch_workspace(workspace_id: String, state: State<'_, DbState>, app: AppHandle) -> Result<Workspace, String>` — fetches workspace, checks folder exists (fall back to ~/Downloads if missing), updates `last_opened_at` + `last_workspace_id`, emits `workspace:changed`
- `read_directory(path: String) -> Result<Vec<DirectoryEntry>, String>` — uses `std::fs::read_dir`, sorts dirs first then files alphabetically
- `initialize_workspace(state: State<'_, DbState>, app: AppHandle) -> Result<Workspace, String>` — startup bootstrap: if `last_workspace_id` is set and workspace exists, return it; otherwise create ~/Downloads workspace, assign orphaned tasks, return it

**Step 3: Register in `commands/mod.rs` and `lib.rs`**

Add `pub mod workspaces;` to `commands/mod.rs`. Add all 7 commands to `invoke_handler` in `lib.rs`.

**Step 4: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 5: Sidecar integration — pass workspace as working_directory

**Files:**
- Modify: `src-tauri/src/commands/tasks.rs` (lines ~60-73 and ~124 for `start_task`; lines ~474-528 for `resume_session`)

**Step 1: Update `start_task` to pass workspace folder**

After creating the task record in DB (line 73), add workspace assignment:

Replace `working_directory: None` (line 124) with `working_directory`.

Also inject workspace folder as a read-write permission into `sidecar_perms`:

**Step 2: Same changes for `resume_session`**

Apply identical workspace lookup and permission injection pattern around line 478-528.

**Step 3: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 6: Sidecar config-builder — workspace permission handling

**Files:**
- Modify: `src-tauri/sidecar-opencode/src/config-builder.ts` (lines 90-131)

**Step 1: Handle workspace source permissions**

In `buildSessionConfig`, within the `for (const fp of options.folderPermissions)` loop (line 108), add special handling for workspace-sourced permissions:

This ensures the workspace folder gets full read-write access with no prompts, while external folders follow the existing ask/deny logic.

**Step 2: Verify**

Run: `cd src-tauri/sidecar-opencode && pnpm build`

---

## Task 7: Update task listing to support workspace filtering

**Files:**
- Modify: `src-tauri/src/commands/tasks.rs` (`list_tasks` command)
- Modify: `src-tauri/src/db/tasks.rs` (add workspace-filtered query)

**Step 1: Add `list_tasks_by_workspace` to `db/tasks.rs`**

Follow the existing `list_tasks` pattern but with `WHERE workspace_id = ?1`:

```rust
pub fn list_tasks_by_workspace(conn: &Connection, workspace_id: &str) -> Vec<StoredTask> {
    // Same as list_tasks but with WHERE workspace_id = ?1
}
```

**Step 2: Update `list_tasks` command**

Add optional `workspace_id` parameter:

**Step 3: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 8: Remove default folder permissions

**Files:**
- Modify: `src-tauri/src/commands/folder_permissions.rs` (`get_default_folder_permissions`)

**Step 1: Return empty defaults**

The `get_default_folder_permissions` function currently returns hardcoded ~/Downloads and ~/Desktop with read access. Replace with empty vec:

```rust
#[tauri::command]
pub async fn get_default_folder_permissions() -> Result<Vec<FolderPermission>, String> {
    Ok(vec![])
}
```

The workspace folder now replaces the default permissions concept.

**Step 2: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 9: Add `notify` crate for filesystem watching

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/fs_watcher.rs`
- Modify: `src-tauri/src/lib.rs` (add module, manage state)

**Step 1: Add dependency**

In `Cargo.toml` under `[dependencies]`:

```toml
notify = "7"
notify-debouncer-mini = "0.5"
```

**Step 2: Create `fs_watcher.rs`**

**Step 3: Register in `lib.rs`**

Add `mod fs_watcher;` and in `setup`:
```rust
app.manage(fs_watcher::FsWatcherState::new());
```

**Step 4: Wire into `switch_workspace` command**

In `commands/workspaces.rs` `switch_workspace`, after updating settings, call:
```rust
fs_watcher::watch_folder(&app, &workspace.folder_path)?;
```

Also call it from `initialize_workspace` for the initial workspace.

**Step 5: Verify**

Run: `cd src-tauri && cargo check`

---

## Task 10: Frontend shared types

**Files:**
- Create: `src/shared/types/workspace.ts`
- Modify: `src/shared/index.ts` (re-export)

**Step 1: Define types**

**Step 2: Export from `src/shared/index.ts`**

Add `export * from './types/workspace';`

**Step 3: Verify**

Run: `pnpm typecheck`

---

## Task 11: Frontend API bridge — workspace commands

**Files:**
- Modify: `src/lib/tauri-api.ts` (add workspace invoke/listen functions)
- Modify: `src/lib/tauri-api-interface.ts` (add to `TauriAPI` interface + `getTauriApi()`)

**Step 1: Add functions to `tauri-api.ts`**

Follow existing patterns (e.g., `startTask`, `listTasks`, `onTaskUpdate`):

**Step 2: Add to `TauriAPI` interface and `getTauriApi()`**

Add method signatures to the interface, and include in the return object of `getTauriApi()`.

**Step 3: Verify**

Run: `pnpm typecheck`

--

## Task 12: Workspace Zustand store

**Files:**
- Create: `src/stores/workspaceStore.ts`

**Step 1: Create store**

**Step 2: Set up event listeners at module level**

Subscribe to `workspace:changed` to sync state (same pattern as `taskStore.ts` lines 1126-1182).

**Step 3: Verify**

Run: `pnpm typecheck`


---

## Task 13: Update taskStore to scope tasks by workspace

**Files:**
- Modify: `src/stores/taskStore.ts`
- Modify: `src/lib/tauri-api.ts` (update `listTasks` to accept optional `workspaceId`)

**Step 1: Update `listTasks` API call**

In `tauri-api.ts`, update the existing `listTasks`:

```typescript
export async function listTasks(workspaceId?: string): Promise<Task[]> {
  return invoke('list_tasks', { workspaceId: workspaceId ?? null });
}
```

**Step 2: Update `loadTasks` in `taskStore.ts`**

Import `useWorkspaceStore` and pass `activeWorkspace.id`:

```typescript
loadTasks: async () => {
  const api = getTauriAPI();
  const workspaceId = useWorkspaceStore.getState().activeWorkspace?.id;
  const tasks = await api.listTasks(workspaceId ?? undefined);
  set({ tasks });
},
```

**Step 3: Subscribe to workspace changes**

In the module-level event setup section of `taskStore.ts`, add:

```typescript
useWorkspaceStore.subscribe(
  (state) => state.activeWorkspace?.id,
  () => { useTaskStore.getState().loadTasks(); }
);
```

(Or use `subscribe` with a selector if using Zustand's `subscribeWithSelector` middleware; alternatively call `loadTasks` from the workspace store's `switchWorkspace` action directly.)

**Step 4: Verify**

Run: `pnpm typecheck`

---

## Task 14: Workspace switcher UI component

**Files:**
- Create: `src/components/sidebar/WorkspaceSwitcher.tsx`

**Step 1: Build dropdown component**

Use Radix `DropdownMenu` (already available via shadcn). Structure:

- Trigger: button showing `activeWorkspace.displayName` + `ChevronDown` icon, full width, truncated text, `title` tooltip with full path
- Content: list of workspaces ordered by `lastOpenedAt`, each showing `displayName` (bold) + `folderPath` (muted, smaller); active has `Check` icon; non-active has X remove button on hover
- Separator + "Add Workspace..." item with `FolderPlus` icon at bottom
- Add workspace: calls `pickFolder()` from tauri-api → `addWorkspace(path)` → `switchWorkspace(id)`
- Remove: confirmation via `window.confirm()` → `removeWorkspace(id)`

**Step 2: Verify**

Run: `pnpm typecheck`

---

## Task 15: Sidebar restructure — add switcher, tabs, remove ArtifactsPanel

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Add WorkspaceSwitcher above action buttons**

Import and render `<WorkspaceSwitcher />` as the first element inside the sidebar div (after the resize handle, before action buttons). Add a border-bottom.

**Step 2: Replace ScrollArea conversation list with tabs**

Replace the `<ScrollArea>` block (lines 170-192) with Radix `Tabs`:

**Step 3: Remove ArtifactsPanel**

Remove the `CollapsibleSection` wrapping `ArtifactsPanel` (lines 199-206), the `artefactsOpen`/`setArtefactsOpen` state (lines 41-46), the `currentTaskArtifacts`/`hasArtifacts` selectors (lines 37-38), and the `ArtifactsPanel` import (line 7).

**Step 4: Rename FoldersPanel title**

In `src/components/sidebar/FoldersPanel.tsx`, change the `<CollapsibleSection>` title from `"Folders"` to `"External Folders"`.

**Step 5: Initialize workspace on mount**

In Sidebar's existing `useEffect` (line 115-117), add workspace initialization:

```typescript
useEffect(() => {
  useWorkspaceStore.getState().initialize();
  loadTasks();
}, [loadTasks]);
```

**Step 6: Verify**

Run: `pnpm typecheck`

---

## Task 16: File tree browser — hook and component

**Files:**
- Create: `src/hooks/useFileTree.ts`
- Create: `src/components/sidebar/fileIcons.ts`
- Create: `src/components/sidebar/FileTreePanel.tsx`

**Step 1: Create `useFileTree` hook**

State shape:

```typescript
interface FileTreeNode {
  entry: DirectoryEntry;
  children?: FileTreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
}
```

Actions: `loadRoot(rootPath)`, `toggleExpand(path)`, `refreshPath(path)`, `selectPath(path)`, search query state.

- `loadRoot`: calls `readDirectory(rootPath)`, creates root-level nodes
- `toggleExpand`: if expanding + no children, call `readDirectory(node.path)` and set children; else toggle `isExpanded`
- `refreshPath`: re-read directory, merge children preserving `isExpanded` state
- Search: computed filtered view — walk loaded tree, include node if `name.toLowerCase().includes(query)` or any descendant matches; include ancestors of matching nodes

**Step 2: Create `fileIcons.ts` helper**

Map extensions to Lucide icons:
- Directories → `Folder` / `FolderOpen`
- Images (png, jpg, jpeg, gif, svg, webp) → `ImageIcon`
- Code (ts, tsx, js, jsx, rs, py, java, c, cpp, go) → `FileCode`
- Data/config (json, yaml, yml, toml) → `FileJson`
- Default → `FileText`

**Step 3: Create `FileTreePanel` component**

- Uses `useWorkspaceStore` for `activeWorkspace`
- Uses `useFileTree` hook
- Renders search input at top, then recursive tree in `ScrollArea`
- Each tree row: indent based on depth, chevron (animated) for dirs, file icon, name (truncated), size right-aligned for files
- Selected row highlighted
- Empty states: "No files found", spinner while loading root
- Subscribe to `workspace:fs_changed` events → debounce 150ms → `refreshPath(parentDir)`

**Step 4: Verify**

Run: `pnpm typecheck`

---

## Task 17: Cross-workspace task history and auto-switch

**Goal:** Task History page and Task Launcher show tasks from all workspaces with workspace names. Selecting a task from a different workspace auto-switches before navigation.

**Files:**
- Modify: `src-tauri/src/db/tasks.rs` (add `workspace_id` to `StoredTask`, include in all queries)
- Modify: `src-tauri/src/types.rs` (add `workspace_id: Option<String>` to `Task`)
- Modify: `src-tauri/src/commands/tasks.rs` (pass `workspace_id` through in all `Task` constructors)
- Modify: `src/shared/types/task.ts` (add `workspaceId?: string` to `Task` interface)
- Modify: `src/stores/taskStore.ts` (add `allTasks: Task[]` state, `loadAllTasks()` action)
- Modify: `src/components/TaskLauncher/TaskLauncher.tsx` (use `allTasks`, widen modal, auto-switch)
- Modify: `src/components/TaskLauncher/TaskLauncherItem.tsx` (show workspace icon + name)

**Step 1: Add `workspace_id` to Rust types and DB queries**

In `db/tasks.rs`, add `pub workspace_id: Option<String>` to `StoredTask`. Update all three query functions (`get_tasks`, `get_tasks_by_workspace`, `get_task`) to SELECT and map `workspace_id`.

In `types.rs`, add `pub workspace_id: Option<String>` to `Task` (with `skip_serializing_if`).

In `commands/tasks.rs`, pass `workspace_id: t.workspace_id` in all `StoredTask` → `Task` mappings. For `start_task` and `resume_session`, read `last_workspace_id` from settings for the response.

**Step 2: Add `workspaceId` to frontend Task type**

In `src/shared/types/task.ts`, add `workspaceId?: string` to the `Task` interface.

**Step 3: Add `allTasks` and `loadAllTasks` to taskStore**

In `src/stores/taskStore.ts`:
- Add `allTasks: Task[]` to state interface and initial state
- Add `loadAllTasks: () => Promise<void>` action that calls `api.listTasks()` (no workspace filter)
- Update `deleteTask` and `clearHistory` to also clear from `allTasks`

**Step 4: Update TaskLauncher**

- Use `allTasks` and `loadAllTasks` instead of `tasks`
- Widen modal from `max-w-lg` to `max-w-2xl`
- Build workspace lookup, pass `workspace` and `activeWorkspaceId` to `TaskLauncherItem`
- In `handleSelect`: if selected task is from different workspace, call `switchWorkspace()` before navigating
- Update search placeholder to "Search tasks across all workspaces..."

**Step 5: Update TaskLauncherItem**

- Accept `workspace?: Workspace` and `activeWorkspaceId?: string` props
- Show `FolderOpen` icon + `workspace.displayName` between task prompt and date
- Highlight workspace name in primary color if it differs from active workspace

**Step 6: Verify**

Run: `pnpm typecheck` + `cd src-tauri && cargo check`

---

## Task 18: Final verification and cleanup

**Files:**
- All modified files

**Step 1: Full type check**

Run: `pnpm typecheck` (frontend) and `cd src-tauri && cargo check` (Rust)

**Step 2: Run tests**

Run: `pnpm test --run` (frontend) and `cd src-tauri && cargo test` (Rust) and `cd src-tauri/sidecar-opencode && pnpm test`

**Step 3: Fix any test failures**

Update existing tests that may break due to:
- `list_tasks` now accepting optional `workspaceId` parameter
- `get_default_folder_permissions` returning empty vec
- Sidebar component tests (if any) needing workspace store mocking

**Step 4: Manual smoke test**

Run: `pnpm tauri dev`
- App should launch with ~/Downloads as default workspace
- Workspace switcher should show in sidebar header
- Sessions tab should show existing conversations
- Files tab should show ~/Downloads file tree
- Adding a new workspace via folder picker should work
- Switching workspaces should update session list and file tree
- Starting a task should use workspace folder as CWD
- File tree should update when AI creates files
- Task Launcher (Cmd+K) should show tasks from all workspaces with workspace names
- Task History page should show tasks from all workspaces with workspace names
- Selecting a task from a different workspace should auto-switch and navigate to it

---

## Verification

1. **Type checks pass:** `pnpm typecheck` + `cd src-tauri && cargo check`
2. **Tests pass:** `pnpm test --run` + `cd src-tauri && cargo test` + `cd src-tauri/sidecar-opencode && pnpm test`
3. **Manual test:** `pnpm tauri dev` — verify workspace switcher, file tree, session scoping, CWD passed to sidecar
4. **Edge cases:** missing folder fallback, restricted path rejection, re-adding removed workspace restores sessions
