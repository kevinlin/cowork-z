# Sidecar Folder Permission Model

## Current State

Today, the sidecar builds an OpenCode config via `buildSessionConfig()` in `config-builder.ts` that grants blanket `allow` on `external_directory`, `edit`, and `read` for any folder the user adds to the sidebar. There is no default restriction, no per-conversation persistence of granted permissions, and no distinction between read-only vs read-write access. The FoldersPanel in `FoldersPanel.tsx` is collapsed by default and only shows user-added folders without any access-level indication.

## Design

### Permission Model

Each conversation (task) has its own set of folder permissions:

- **Default permissions (auto-granted, no prompt):**
  - `~/Downloads` -- read-only
  - `~/Desktop` -- read-only
  - `~/.local/share/opencode` -- read-write (OpenCode working directory, implicit)
- **User-granted permissions:** Any additional folder the user adds via FoldersPanel, with an explicit access level:
  - `read` -- read-only access
  - `read-write` -- full access (read + edit + create)
- **File operations requiring approval:** Any `update` (edit/modify/overwrite) or `delete` operation on files in external folders MUST trigger a permission prompt to the user, regardless of folder access level. Creating new files does NOT require a prompt.

### Data Model

**New table: `folder_permissions`** (SQLite migration v4)

| Column         | Type       | Description                              |
| -------------- | ---------- | ---------------------------------------- |
| `id`           | INTEGER PK | Auto-increment                           |
| `task_id`      | TEXT FK    | References `tasks(id)` ON DELETE CASCADE |
| `folder_path`  | TEXT       | Absolute path to the folder              |
| `access_level` | TEXT       | `read` or `read-write`                   |
| `created_at`   | TEXT       | ISO timestamp                            |

Unique constraint on `(task_id, folder_path)`.

### Architecture Flow

1. User adds folder with access level via FoldersPanel
2. Store calls `save_folder_permission` Tauri command -> persisted in SQLite
3. When task starts or resumes, Rust backend loads `folder_permissions` from DB
4. Permissions are passed to sidecar as `folderPermissions` array in StartTask/ResumeSession payload
5. Sidecar's `buildSessionConfig()` generates differentiated OpenCode permission rules:
   - `external_directory`: allow access to permitted folders
   - `read`: allow read for all permitted folders
   - `edit`: `ask` for read-write folders (prompts before every edit/delete), `deny` for read-only folders
6. When agent tries to edit/delete files, OpenCode emits `permission.asked` SSE event
7. Permission request flows through sidecar -> Rust -> frontend permission modal
8. User response flows back: frontend -> Rust -> sidecar -> OpenCode server

## Implementation Summary

### Layer 1: Database (Rust)

- **`src-tauri/src/db/migrations.rs`**: Migration v4 creates `folder_permissions` table, migrates data from old `tasks.folders` JSON column, drops `tasks.folders` column
- **`src-tauri/src/db/folder_permissions.rs`**: New CRUD module with `save_folder_permission`, `get_folder_permissions`, `remove_folder_permission`, `clear_folder_permissions`
- **`src-tauri/src/db/mod.rs`**: Added `pub mod folder_permissions`

### Layer 1b: Cleanup of Old `folders` References

Removed the `folders` field and all associated code:
- `db/tasks.rs`: Removed from `StoredTask`, `TaskInput`, all SQL queries, deleted `update_task_folders()` and `get_task_folders()`
- `lib.rs`: Removed from `Task`, `TaskConfig` structs, removed `save_task_folders` command
- `sidecar.rs`: Replaced `folders` with `folder_permissions` in payload structs

### Layer 2: Tauri Commands (Rust)

New commands in `lib.rs`:
- `save_folder_permission(task_id, folder_path, access_level)` -- upsert
- `get_folder_permissions(task_id)` -- list for a task
- `remove_folder_permission(task_id, folder_path)` -- delete
- `get_default_folder_permissions()` -- returns Downloads/Desktop with read-only

Updated `start_task` and `resume_session` to load folder permissions from DB.

### Layer 3: IPC Protocol

- **`types.ts`**: Added `FolderPermission` interface, replaced `folders` with `folderPermissions` in payloads
- **`sidecar.rs`**: Added `FolderPermissionPayload` struct, updated payload structs

### Layer 4: Sidecar Config Builder

`buildSessionConfig()` now accepts `folderPermissions` and builds differentiated rules:
- `external_directory`: per-folder `allow`
- `read`: per-folder `allow`
- `edit`: `ask` for read-write folders, `deny` for read-only folders

### Layer 5: Frontend Types and API

- **`permission.ts`**: Added `FolderAccessLevel` and `FolderPermission` types
- **`task.ts`**: Removed `folders` from `Task` and `TaskConfig`
- **`tauri-api.ts`**: Added `saveFolderPermission`, `getFolderPermissions`, `removeFolderPermission`, `getDefaultFolderPermissions`
- **`accomplish.ts`**: Removed `folders` from `resumeSession` signature

### Layer 6: Zustand Store

Replaced `folders`/`addFolder`/`removeFolder` with `folderPermissions`/`addFolderPermission`/`removeFolderPermission`/`loadFolderPermissions`.

### Layer 7: FoldersPanel UI

- Expanded by default
- Shows access level badges (R / RW)
- Default folders (Downloads, Desktop) shown with lock icon, not removable
- Access level picker dialog when adding folders

### Layer 8: Session Manager

Updated `startTask()` and `resumeSession()` to destructure and pass `folderPermissions`.

## Files Changed

- `src-tauri/src/db/migrations.rs` -- Migration v4
- `src-tauri/src/db/folder_permissions.rs` -- New CRUD module
- `src-tauri/src/db/mod.rs` -- Module declaration
- `src-tauri/src/db/tasks.rs` -- Removed `folders` field
- `src-tauri/src/lib.rs` -- New commands, updated start/resume
- `src-tauri/src/sidecar.rs` -- Updated payload structs
- `src-tauri/sidecar-opencode/src/types.ts` -- Added FolderPermission, updated payloads
- `src-tauri/sidecar-opencode/src/config-builder.ts` -- Differentiated permission rules
- `src-tauri/sidecar-opencode/src/session-manager.ts` -- Updated to pass folderPermissions
- `src/shared/types/permission.ts` -- Added FolderPermission type
- `src/shared/types/task.ts` -- Removed folders
- `src/lib/tauri-api.ts` -- New API functions
- `src/lib/accomplish.ts` -- Updated interface
- `src/stores/taskStore.ts` -- Updated state management
- `src/components/layout/FoldersPanel.tsx` -- UI overhaul

## Verification

### Automated
- `pnpm build` -- Frontend compiles
- `pnpm typecheck` -- TypeScript checks pass
- `pnpm test --run` -- Frontend tests pass
- `cd src-tauri && cargo check` -- Rust compiles
- `cd src-tauri/sidecar-opencode && pnpm build` -- Sidecar compiles
- `cd src-tauri/sidecar-opencode && pnpm test` -- Sidecar tests pass

### Manual
- [x] Permission modals appear when agent tries to edit/delete files in external folders
- [x] Question modals appear and responses work
- [x] FoldersPanel shows default folders (Downloads, Desktop) and user-added folders with access badges
- [x] FoldersPanel is expanded by default
- [ ] Folder permissions persist across app restarts for resumed conversations
