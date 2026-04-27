# Plan: Convention-Based Workspace Permission Model

## Context

The current permission model stores folder permissions per-task (`folder_permissions` table with `task_id` FK). This means adhoc approvals don't carry across tasks, and the workspace gets blanket `edit: allow` with no protection for reference data. This plan replaces `folder_permissions` with a single `workspace_permissions` table, introduces convention-based rules (`input/` read-only, `output/` writable), and soft-enforces bash restrictions via system prompt.

**Key constraint:** OpenCode's `bash` permission matches command strings, not file paths. Edit/read/list permissions match file paths. Bash restriction for `input/` is soft-enforced via system prompt; edit restriction is hard-enforced via permission rules.

**Rule precedence:** OpenCode uses "last matching pattern wins" — general rules must be inserted FIRST, specific overrides LAST in the object.

---

## Step 1: Database Migration v6

**File:** `src-tauri/src/db/migrations.rs`

- Bump `CURRENT_VERSION` from `5` to `6`
- Add `migrate_v6()`:
  ```sql
  -- Create workspace-scoped permissions table
  CREATE TABLE workspace_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      folder_path TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read-write',
      source TEXT NOT NULL DEFAULT 'adhoc',
      created_at TEXT NOT NULL,
      UNIQUE(workspace_id, folder_path)
  );
  CREATE INDEX idx_workspace_permissions_workspace_id ON workspace_permissions(workspace_id);

  -- Migrate existing folder_permissions data to workspace scope
  INSERT OR IGNORE INTO workspace_permissions (workspace_id, folder_path, access_level, source, created_at)
  SELECT DISTINCT t.workspace_id, fp.folder_path, fp.access_level, fp.source, fp.created_at
  FROM folder_permissions fp
  JOIN tasks t ON fp.task_id = t.id
  WHERE t.workspace_id IS NOT NULL;

  -- Drop old table
  DROP TABLE IF EXISTS folder_permissions;
  ```
- Add `if stored_version < 6 { migrate_v6(conn)?; }` after the v5 block (line 348)

---

## Step 2: New CRUD Module — `workspace_permissions.rs`

**New file:** `src-tauri/src/db/workspace_permissions.rs`

Following the pattern in `src-tauri/src/db/folder_permissions.rs`:

- `StoredWorkspacePermission` struct: `id`, `workspace_id`, `folder_path`, `access_level`, `source`, `created_at`
- `save_workspace_permission(conn, workspace_id, folder_path, access_level, source)` — upsert with `ON CONFLICT(workspace_id, folder_path) DO UPDATE`
- `get_workspace_permissions(conn, workspace_id) -> Vec<StoredWorkspacePermission>` — returns all for workspace, ordered by folder_path
- `remove_workspace_permission(conn, workspace_id, folder_path)` — delete specific entry

**Delete file:** `src-tauri/src/db/folder_permissions.rs`

**File:** `src-tauri/src/db/mod.rs` — replace `pub mod folder_permissions;` with `pub mod workspace_permissions;`

---

## Step 3: Replace Tauri Commands

**Replace file:** `src-tauri/src/commands/folder_permissions.rs` → `src-tauri/src/commands/workspace_permissions.rs`

New commands (mirroring the old ones but using workspace_id instead of task_id):
- `save_workspace_permission(workspace_id, folder_path, access_level, source?)` — calls `db::workspace_permissions::save_workspace_permission`
- `get_workspace_permissions(workspace_id)` → `Vec<FolderPermission>` (reuse existing `FolderPermission` return type)
- `remove_workspace_permission(workspace_id, folder_path)` — calls `db::workspace_permissions::remove_workspace_permission`
- `get_default_folder_permissions()` — keep as-is (returns empty vec, could be removed later)

**File:** `src-tauri/src/commands/mod.rs` — replace `pub mod folder_permissions;` with `pub mod workspace_permissions;`

**File:** `src-tauri/src/lib.rs` (line 268-271) — swap command registrations:
```rust
commands::workspace_permissions::save_workspace_permission,
commands::workspace_permissions::get_workspace_permissions,
commands::workspace_permissions::remove_workspace_permission,
commands::workspace_permissions::get_default_folder_permissions,
```

---

## Step 4: Update `respond_to_permission` — Save Adhoc to Workspace

**File:** `src-tauri/src/commands/tasks.rs` — `respond_to_permission()` (line 468)

Replace the `save_folder_permission` call (lines 492-499) with workspace-scoped save:

```rust
// Look up task's workspace_id
let ws_id: Option<String> = conn.query_row(
    "SELECT workspace_id FROM tasks WHERE id = ?1",
    [&response.task_id],
    |row| row.get(0),
).ok().flatten();

if let Some(ref ws_id) = ws_id {
    let _ = db::workspace_permissions::save_workspace_permission(
        &conn, ws_id, &folder_path, "read-write", "adhoc",
    );
}
```

Remove the old `db::folder_permissions::save_folder_permission` call entirely.

---

## Step 5: Update Permission Loading in `start_task` / `resume_session` / Arena

Three places load folder permissions — all change from task-scoped to workspace-scoped:

### 5a: `start_task()` in `src-tauri/src/commands/tasks.rs` (lines 90-103)

Replace:
```rust
let folder_permissions = {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::folder_permissions::get_folder_permissions(&conn, &task_id)
};
```

With:
```rust
let folder_permissions = {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    if let Some(ref ws_id) = ws_id {
        db::workspace_permissions::get_workspace_permissions(&conn, ws_id)
    } else {
        vec![]
    }
};
```

Then convert `StoredWorkspacePermission` → `FolderPermissionPayload` (same field mapping, `workspace_id` ignored in payload).

### 5b: `resume_session()` in `src-tauri/src/commands/tasks.rs` (lines 546-558)

Same change — load from `workspace_permissions` using the task's workspace_id.

### 5c: `resolve_shared_state()` in `src-tauri/src/commands/arena.rs` (lines 81-96)

Same change — load from `workspace_permissions` using workspace_id (already available from `ws_id`).

---

## Step 6: Convention-Based Permission Rules in Config Builder

**File:** `src-tauri/sidecar-opencode/src/config-builder.ts` — `buildSessionConfig()` (lines 117-124)

Replace the current workspace block:
```typescript
if (fp.source === 'workspace') {
  externalDirRules[fp.path] = 'allow';
  readRules[fp.path] = 'allow';
  editRules[fp.path] = 'allow';
  continue;
}
```

With convention-aware logic:
```typescript
if (fp.source === 'workspace') {
  const wsPath = fp.path;
  const sep = process.platform === 'win32' ? '\\' : '/';
  const norm = wsPath.replace(/[\/\\]+$/, '');
  const inputDir = norm + sep + 'input';
  const outputDir = norm + sep + 'output';

  // External directory: allow workspace access
  externalDirRules[wsPath] = 'allow';

  // Read: allow everything in workspace (including input/)
  readRules[wsPath] = 'allow';

  // Edit: GENERAL rule first, SPECIFIC overrides last
  // OpenCode uses "last matching pattern wins"
  editRules[wsPath] = 'allow';                  // general: workspace writable
  editRules[inputDir] = 'deny';                 // override: input/ root denied
  editRules[inputDir + sep + '*'] = 'deny';     // override: input/ children denied
  editRules[outputDir] = 'allow';               // override: output/ explicitly allowed
  editRules[outputDir + sep + '*'] = 'allow';   // override: output/ children allowed

  continue;
}
```

---

## Step 7: System Prompt — Soft Bash Enforcement + Mandatory Workspace Dir

**File:** `src-tauri/sidecar-opencode/src/config-builder.ts` — `buildSystemPrompt()` (line 33)

Make `workspaceDir` a **required** parameter (reorder so it comes before the optional `customPrompt`):
```typescript
export function buildSystemPrompt(
  serverPort: number,
  serverPassword: string,
  workspaceDir: string,
  customPrompt?: string
): string {
```

Unconditionally emit a `<workspace-conventions>` section after `<capabilities>` (before `<server-access>`). The block embeds the current workspace path, marks `input/` as read-only, and forces every new file under a **category subfolder** of `${workspaceDir}/output/` (the agent picks the actual subfolder name based on the file's nature):
```
<workspace-conventions>
The current workspace is: \`${workspaceDir}\`

This workspace uses a convention-based folder structure:
- **\`input/\`** — Read-only reference materials. NEVER modify, delete, move, or overwrite any files in \`input/\`. This applies to ALL tools including bash. Read from \`input/\` and write results to \`output/\`.
- **\`output/\`** — Your working area. Every new file you create MUST live under a **category subfolder** of \`${workspaceDir}/output/\` — never directly in \`output/\`, never at the workspace root, never in \`input/\`, and never elsewhere unless the user explicitly requests a different location. This applies to ALL file-creating tools including write, edit, and bash commands (e.g., \`touch\`, \`>\`, \`tee\`, \`mkdir\`, \`cp\`, \`mv\`).

**Choosing the category subfolder:**
1. **Reuse first.** Before creating a new subfolder, list \`${workspaceDir}/output/\`. If an existing subfolder already fits the file's nature, put the file there.
2. **Otherwise, pick a short, lowercase, kebab-case name that describes the *nature* of the artifact** (not the task or date). Create nested subfolders inside the category when it helps organization (e.g., \`engineering/adr/\`, \`testing/e2e/\`).
3. **Common categories** (use these names when they fit; invent new ones only when none of these apply):
   - \`executable/\` — runnable code and scripts (Python, shell, Node, etc.)
   - \`product/\` — requirement docs, feature specs, user stories, PRDs
   - \`ux-prototype/\` — UI/UX mockups, HTML prototypes, wireframes, design assets
   - \`engineering/\` — technical/solution design, architecture docs, ADRs
   - \`testing/\` — test cases, test scripts, test data, test reports
   - \`research/\` — investigation notes, comparisons, summaries of source material
   - \`data/\` — generated datasets, exports, intermediate data files

**Examples:**
- A Python utility script → \`${workspaceDir}/output/executable/<name>.py\`
- A feature requirements doc → \`${workspaceDir}/output/product/<name>.md\`
- A clickable HTML prototype → \`${workspaceDir}/output/ux-prototype/<name>/index.html\`
- An ADR → \`${workspaceDir}/output/engineering/adr/<NNN>-<title>.md\`
- A pytest suite → \`${workspaceDir}/output/testing/test_<name>.py\`
</workspace-conventions>
```

The category list and examples are soft-enforced via the system prompt only. The hard `edit: allow` rule for `${workspaceDir}/output/` and its descendants (Step 6) already permits any subfolder layout, so no permission-rule changes are needed to support categorized output.

**File:** `src-tauri/sidecar-opencode/src/session-manager.ts` — lines 365 and 421

Thread `workingDirectory` to `buildSystemPrompt` in the new argument order. Because the payload types mark `workingDirectory?: string` as optional, coalesce to an empty string defensively:
```typescript
system: buildSystemPrompt(this.serverPort, this.serverPassword, workingDirectory ?? '', customPrompt),
```

**File:** `src-tauri/sidecar-opencode/__tests__/server-isolation.test.ts`

Update all existing `buildSystemPrompt` test calls to pass a workspace path (e.g., `'/tmp/workspace'`) and add **two** new tests:
1. Asserts the prompt contains the workspace path and the `${workspaceDir}/output/` instruction.
2. Asserts the prompt contains the phrase `category subfolder` and each of the common category names (`executable/`, `product/`, `ux-prototype/`, `engineering/`, `testing/`) so the categorized-output guidance is locked in against accidental deletion.

---

## Step 8: Frontend — Switch to Workspace-Scoped API

### 8a: Tauri API functions

**File:** `src/lib/tauri-api.ts` (lines 243-257)

Replace task-scoped functions with workspace-scoped:
```typescript
saveFolderPermission(workspaceId, folderPath, accessLevel, source?)
  → invoke('save_workspace_permission', { workspaceId, folderPath, accessLevel, source })

getFolderPermissions(workspaceId)
  → invoke('get_workspace_permissions', { workspaceId })

removeFolderPermission(workspaceId, folderPath)
  → invoke('remove_workspace_permission', { workspaceId, folderPath })

getDefaultFolderPermissions()  // keep as-is
```

Keep the function names (`saveFolderPermission`, etc.) to minimize churn, but change the first parameter from `taskId` to `workspaceId` and the backend invocation targets.

### 8b: TaskStore

**File:** `src/stores/taskStore.ts`

**`addFolderPermission`** (lines 369-384): Change from `currentTask.id` to workspace ID:
```typescript
addFolderPermission: (path, accessLevel) => {
  // ... same dedup + local state update ...
  // Persist to workspace (not task)
  const { useWorkspaceStore } = await import('./workspaceStore');
  const wsId = useWorkspaceStore.getState().activeWorkspace?.id;
  if (wsId) {
    api.saveFolderPermission(wsId, path, accessLevel).catch(...);
  }
},
```

Note: `addFolderPermission` can't be async (it's a sync setter). Use the pattern already in the file at line 1123-1124 where workspace ID is fetched inline.

**`removeFolderPermission`** (lines 386-397): Same change — use workspace ID instead of `currentTask.id`.

**`loadFolderPermissions`** (lines 399-406): Currently dead code (never called). Remove entirely.

**`respondToPermission`** (lines 692-781): The adhoc local state update (lines 745-750) stays as-is since it updates in-memory `folderPermissions`. The backend persistence is now handled by `respond_to_permission` in Rust (Step 4), which already saves to workspace_permissions. No change needed in this function.

**`reset()`** (line 1181): Keep `folderPermissions: []`.

### 8c: FoldersPanel

**File:** `src/components/sidebar/FoldersPanel.tsx` (line 96)

No changes needed — `FoldersPanel` reads from `taskStore.folderPermissions` and calls `addFolderPermission` / `removeFolderPermission`. The taskStore handles the workspace ID lookup internally (Step 8b).

---

## Step 9: Update Design Document

**File:** `docs/specs/opencode-integration/design_opencode-integration.md`

In the **Folder Permission Model** section, update to describe:

1. **Convention-based defaults:** `input/` is read-only (edit: deny), `output/` is writable (edit: allow), workspace root allows read/list for everything
2. **Workspace-scoped persistence:** Replaced `folder_permissions` (task-scoped) with `workspace_permissions` (workspace-scoped). Adhoc approvals now carry across all tasks in the same workspace.
3. **Bash soft enforcement:** System prompt instructs agent not to modify `input/` via bash commands. Hard enforcement is via `edit: deny` rules.
4. **Architecture flow:** User approves permission → saved to `workspace_permissions` → loaded for all future tasks in workspace

Also update the **Key Source Locations** table to reference `workspace_permissions.rs` instead of `folder_permissions.rs`.

---

## Step 10: Update Log

**File:** `UPDATE_LOG.md` — under v0.6.5:

```
- **Convention-based workspace permissions** — Workspace `input/` folder is now read-only (agent cannot edit files there); `output/` folder is explicitly writable. Permission approvals are now remembered at the workspace level and automatically applied to all future tasks in the same workspace.
```

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/db/migrations.rs` | Migration v6: create workspace_permissions, migrate data, drop folder_permissions |
| `src-tauri/src/db/workspace_permissions.rs` | **New** — CRUD module (replaces folder_permissions.rs) |
| `src-tauri/src/db/folder_permissions.rs` | **Delete** |
| `src-tauri/src/db/mod.rs` | Swap module registration |
| `src-tauri/src/commands/workspace_permissions.rs` | **New** — Tauri commands (replaces folder_permissions.rs) |
| `src-tauri/src/commands/folder_permissions.rs` | **Delete** |
| `src-tauri/src/commands/mod.rs` | Swap module registration |
| `src-tauri/src/lib.rs` | Swap command registrations |
| `src-tauri/src/commands/tasks.rs` | respond_to_permission saves to workspace; start_task/resume_session load from workspace |
| `src-tauri/src/commands/arena.rs` | resolve_shared_state loads from workspace |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | Convention edit rules + workspace prompt in buildSystemPrompt |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Pass workingDirectory to buildSystemPrompt |
| `src/lib/tauri-api.ts` | Switch save/get/remove to workspace_id parameter |
| `src/stores/taskStore.ts` | Use workspace ID for save/remove; remove dead loadFolderPermissions |
| `docs/specs/opencode-integration/design_opencode-integration.md` | Update permission model sections |
| `UPDATE_LOG.md` | Changelog entry |

---

## Verification

1. `cd src-tauri && cargo check` — Rust compiles with new migration + module swap
2. `cd src-tauri/sidecar-opencode && pnpm build` — Sidecar compiles
3. `cd src-tauri/sidecar-opencode && pnpm test` — Existing tests pass
4. `pnpm typecheck` — Frontend compiles
5. **Manual — Convention enforcement:**
   - Create workspace with `input/data.txt` and `output/`
   - Start task: "Edit the file at input/data.txt" → agent denied by OpenCode
   - Start task: "Create a summary in output/" → succeeds without prompt, file lands under a category subfolder (e.g., `output/research/` or `output/product/`), not directly in `output/`
   - Start task: "Write a Python script that prints today's date and an ADR explaining the choice of Python" → script lands in `output/executable/`, ADR lands in `output/engineering/` (or `output/engineering/adr/`)
   - Follow-up task in same workspace: "Add unit tests for the script" → tests land in `output/testing/`; the script remains in `output/executable/` (agent reused the existing category)
6. **Manual — Workspace-scoped persistence:**
   - In task A, approve an external folder permission
   - Start task B in same workspace → external folder auto-allowed (no prompt)
7. **Manual — Arena:**
   - Start arena in workspace with input/output → all 3 agents get convention rules
   - Approve permission in arena → persists for workspace
