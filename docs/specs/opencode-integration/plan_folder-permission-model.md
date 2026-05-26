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
- **Ad-hoc granted permissions:** When a user accepts a permission prompt during a conversation, the target folder is automatically persisted as a `read-write` folder permission with `source: 'adhoc'`. The target folder is derived from the permission `patterns`: for `external_directory` permissions the pattern is the directory itself; for `edit` permissions the pattern is a file path and the parent directory is used. On session resume, adhoc-granted folders use `edit: 'allow'` (auto-allow, no re-prompts) instead of `edit: 'ask'`.

### Data Model

**New table: `folder_permissions`** (SQLite migration v4, extended in v5)

| Column         | Type       | Description                              |
| -------------- | ---------- | ---------------------------------------- |
| `id`           | INTEGER PK | Auto-increment                           |
| `task_id`      | TEXT FK    | References `tasks(id)` ON DELETE CASCADE |
| `folder_path`  | TEXT       | Absolute path to the folder              |
| `access_level` | TEXT       | `read` or `read-write`                   |
| `source`       | TEXT       | `user` (added via UI) or `adhoc` (granted from permission prompt). Default: `user`. Added in migration v5. |
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
9. **Ad-hoc persistence:** When user allows a permission, Rust derives the target folder from `patterns` and persists it as `(task_id, folder_path, "read-write", "adhoc")` in `folder_permissions`. Directory detection: if the pattern path exists as a directory on the filesystem, it is used directly; otherwise the parent directory is used (for file paths).
10. **Resume with auto-allow:** On session resume, sidecar's `buildSessionConfig()` sets `edit: 'allow'` for adhoc-granted folders, so OpenCode does not re-prompt for files in those folders

## Implementation Summary

### Layer 1: Database (Rust)

- **`src-tauri/src/db/migrations.rs`**: Migration v4 creates `folder_permissions` table, migrates data from old `tasks.folders` JSON column, drops `tasks.folders` column. Migration v5 adds `source` column (`TEXT NOT NULL DEFAULT 'user'`).
- **`src-tauri/src/db/folder_permissions.rs`**: New CRUD module with `save_folder_permission` (accepts `source` parameter), `get_folder_permissions` (returns `source`), `remove_folder_permission`, `clear_folder_permissions`
- **`src-tauri/src/db/mod.rs`**: Added `pub mod folder_permissions`

### Layer 1b: Cleanup of Old `folders` References

Removed the `folders` field and all associated code:
- `db/tasks.rs`: Removed from `StoredTask`, `TaskInput`, all SQL queries, deleted `update_task_folders()` and `get_task_folders()`
- `lib.rs`: Removed from `Task`, `TaskConfig` structs, removed `save_task_folders` command
- `sidecar.rs`: Replaced `folders` with `folder_permissions` in payload structs

### Layer 2: Tauri Commands (Rust)

New commands in `lib.rs`:
- `save_folder_permission(task_id, folder_path, access_level, source?)` -- upsert (source defaults to `"user"`)
- `get_folder_permissions(task_id)` -- list for a task (returns `source` field)
- `remove_folder_permission(task_id, folder_path)` -- delete
- `get_default_folder_permissions()` -- returns Downloads/Desktop with read-only

Updated `start_task` and `resume_session` to load folder permissions from DB and pass `source` field through to sidecar.

**`respond_to_permission`** now accepts `PermissionResponse` with `patterns` field and `db_state`. When `decision == "allow"`, derives the target folder from each pattern using `Path::is_dir()` — directory patterns (from `external_directory` permissions) are used directly, file patterns use `parent()` — and persists as adhoc grant via `save_folder_permission(..., "adhoc")`.

### Layer 3: IPC Protocol

- **`types.ts`**: Added `FolderPermission` interface with `source?: 'user' | 'adhoc'`, replaced `folders` with `folderPermissions` in payloads
- **`sidecar.rs`**: Added `FolderPermissionPayload` struct with `source: Option<String>`, updated payload structs

### Layer 4: Sidecar Config Builder

`buildSessionConfig()` now accepts `folderPermissions` (with `source`) and builds differentiated rules:
- `external_directory`: per-folder `allow`
- `read`: per-folder `allow`
- `edit`: `allow` for adhoc-granted read-write folders (auto-allow on resume), `ask` for user-added read-write folders (prompt per operation), `deny` for read-only folders

### Layer 5: Frontend Types and API

- **`permission.ts`**: Added `FolderAccessLevel`, `FolderPermissionSource`, and `FolderPermission` (with `source?`) types. Added `patterns?` field to `PermissionResponse`.
- **`task.ts`**: Removed `folders` from `Task` and `TaskConfig`
- **`tauri-api.ts`**: Added `saveFolderPermission` (with optional `source` param), `getFolderPermissions`, `removeFolderPermission`, `getDefaultFolderPermissions`
- **`tauri-api-interface.ts`** (formerly `accomplish.ts`): Removed `folders` from `resumeSession` signature

### Layer 6: Zustand Store

Replaced `folders`/`addFolder`/`removeFolder` with `folderPermissions`/`addFolderPermission`/`removeFolderPermission`/`loadFolderPermissions`.

`respondToPermission()` now attaches `patterns` from the current `permissionRequest` to the response, and on `allow` decisions, derives the target folder from each pattern and adds it to local `folderPermissions` state as an adhoc grant. For `external_directory` permissions (checked via `permissionRequest.toolName`), the pattern is the directory itself and is used directly. For other permissions (e.g., `edit`), the pattern is a file path and the parent directory is extracted.

### Layer 7: FoldersPanel UI

- Expanded by default
- Shows access level badges (R / RW)
- Default folders (Downloads, Desktop) shown with lock icon, not removable
- Ad-hoc granted folders shown with shield-check icon, removable (revoking the grant)
- Access level picker dialog when adding folders

### Layer 8: Session Manager

Updated `startTask()` and `resumeSession()` to destructure and pass `folderPermissions`.

## Files Changed

- `src-tauri/src/db/migrations.rs` -- Migration v4, v5 (adds `source` column)
- `src-tauri/src/db/folder_permissions.rs` -- New CRUD module (with `source` field)
- `src-tauri/src/db/mod.rs` -- Module declaration
- `src-tauri/src/db/tasks.rs` -- Removed `folders` field
- `src-tauri/src/lib.rs` -- New commands, updated start/resume, respond_to_permission persists adhoc grants (with directory vs file pattern detection)
- `src-tauri/src/sidecar.rs` -- Updated payload structs (with `source` field)
- `src-tauri/sidecar-opencode/src/types.ts` -- Added FolderPermission (with `source`), updated payloads
- `src-tauri/sidecar-opencode/src/config-builder.ts` -- Differentiated permission rules (adhoc `allow` vs user `ask`)
- `src-tauri/sidecar-opencode/src/session-manager.ts` -- Updated to pass folderPermissions
- `src/shared/types/permission.ts` -- Added FolderPermission type (with `source`), FolderPermissionSource, patterns on PermissionResponse
- `src/shared/types/task.ts` -- Removed folders
- `src/lib/tauri-api.ts` -- New API functions
- `src/lib/tauri-api-interface.ts` (formerly `accomplish.ts`) -- Updated interface
- `src/stores/taskStore.ts` -- Updated state management, respondToPermission persists adhoc grants locally (with directory vs file pattern detection via `toolName`)
- `src/components/layout/FoldersPanel.tsx` -- UI overhaul, adhoc folders shown with shield-check icon

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
- [x] Folder permissions persist across app restarts for resumed conversations
- [x] Accepting a permission prompt adds the correct target folder to FoldersPanel with shield-check icon and "adhoc" source (directory patterns used directly, file patterns use parent)
- [ ] On session resume, adhoc-granted folders do not trigger edit permission prompts (OpenCode config uses `edit: 'allow'`)
- [ ] Removing an adhoc folder from FoldersPanel revokes the grant

## Extension: Four-Folder Workspace Convention (v0.7.15)

Extends the two-folder workspace convention (`Input/` + `Output/`) to four root-level convention folders, with the agent instructed to auto-create any missing folders as its first action in a fresh workspace.

### Convention folders

| Folder | Edit permission (workspace source) | Purpose |
| --- | --- | --- |
| `Input/` | `deny` (existing) | Read-only source material — datasets, reference docs |
| `Output/` | `allow` (existing) | Scratchpad; new files land under a category subfolder here |
| `Misc/` (new) | `deny` | Read-only static assets — icons, logos, images, fonts |
| `Artefacts/` (new) | `ask` | Curated deliverables, typically promoted from `Output/`; user is prompted before every write |

### Implementation notes

- **Hard rules:** `buildSessionConfig()` in `src-tauri/sidecar-opencode/src/config-builder.ts` was extended in the `fp.source === 'workspace'` branch to emit four additional edit-rule entries alongside the existing `Input/`/`Output/` pair (`Misc` + `Misc/*` → `deny`, `Artefacts` + `Artefacts/*` → `ask`). Read rules and `external_directory` are unchanged: `readRules[wsPath] = 'allow'` already covers reads under `Misc/` and `Artefacts/`.
- **Auto-creation is agent-driven, not Rust-driven.** No Rust or filesystem code creates these folders. Instead, the `<workspace-conventions>` block of the system prompt (also in `config-builder.ts`, function `buildSystemPrompt`) opens with an "ensure folders exist" instruction telling the agent to run a single idempotent `mkdir -p "<ws>/Input" "<ws>/Output" "<ws>/Misc" "<ws>/Artefacts"` (PowerShell `New-Item -ItemType Directory -Force ...` on Windows) as its very first action in a new workspace. `mkdir -p` is safe on existing folders, and bash is not gated by the `edit` permission, so the agent can create `Input/` and `Misc/` despite their `edit: deny` rules.
- **`Artefacts/` is `edit: ask`, not `edit: allow`.** This is intentional. The user must explicitly approve every write into `Artefacts/`, so the agent never silently dumps files into the curated-deliverables area. The system prompt describes the promotion workflow: when the user asks to "promote", "publish", "save as artefact", or "finalize" a file, the agent copies or moves it from `Output/<category>/...` into `Artefacts/<category>/...` (same category-subfolder layout) — OpenCode prompts on each write.
- **No DB / migration changes.** This extension lives entirely in the sidecar `config-builder.ts` (edit-rule generation + system prompt). The Rust permission model and `workspace_permissions` table are unchanged.

### Tests

- **New** `src-tauri/sidecar-opencode/__tests__/config-builder.test.ts` — asserts edit rules for all four convention folders, the workspace-root general allow, and the read-rule coverage.
- **Updated** `src-tauri/sidecar-opencode/__tests__/server-isolation.test.ts` — three new `buildSystemPrompt` assertions: prompt mentions all four folder names; prompt contains the `mkdir -p` (or PowerShell `New-Item`) auto-create instruction referencing the four folder paths; prompt describes the `promote` workflow into `Artefacts/`.
