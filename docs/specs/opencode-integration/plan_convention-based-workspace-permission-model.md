# Plan: Convention-Based Workspace Permission Model

## Context

The current permission model stores folder permissions per-task (`folder_permissions` table with `task_id` FK). This means adhoc approvals don't carry across tasks, and the workspace gets blanket `edit: allow` with no protection for reference data. This plan replaces `folder_permissions` with a single `workspace_permissions` table, introduces convention-based rules (`Input/` read-only, `Output/` writable), and soft-enforces bash restrictions via system prompt.

**Key constraint:** OpenCode's `bash` permission matches command strings, not file paths. Edit/read/list permissions match file paths. Bash restriction for `Input/` is soft-enforced via system prompt; edit restriction is hard-enforced via permission rules.

**Rule precedence:** OpenCode uses "last matching pattern wins" — general rules must be inserted FIRST, specific overrides LAST in the object.

---

## Step 1: Database Migration v6

**File:** `src-tauri/src/db/migrations.rs`

- Bump `CURRENT_VERSION` from `5` to `6`
- Add `migrate_v6()`:
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

---

## Step 4: Update `respond_to_permission` — Save Adhoc to Workspace

**File:** `src-tauri/src/commands/tasks.rs` — `respond_to_permission()` (line 468)

Replace the `save_folder_permission` call (lines 492-499) with workspace-scoped save:

Remove the old `db::folder_permissions::save_folder_permission` call entirely.

---

## Step 5: Update Permission Loading in `start_task` / `resume_session` / Arena

Three places load folder permissions — all change from task-scoped to workspace-scoped:

### 5a: `start_task()` in `src-tauri/src/commands/tasks.rs` (lines 90-103)

Then convert `StoredWorkspacePermission` → `FolderPermissionPayload` (same field mapping, `workspace_id` ignored in payload).

### 5b: `resume_session()` in `src-tauri/src/commands/tasks.rs` (lines 546-558)

Same change — load from `workspace_permissions` using the task's workspace_id.

### 5c: `resolve_shared_state()` in `src-tauri/src/commands/arena.rs` (lines 81-96)

Same change — load from `workspace_permissions` using workspace_id (already available from `ws_id`).

---

## Step 6: Convention-Based Permission Rules in Config Builder

**File:** `src-tauri/sidecar-opencode/src/config-builder.ts` — `buildSessionConfig()` (lines 117-124)

Replace the current workspace block with convention-aware logic

---

## Step 7: System Prompt — Soft Bash Enforcement + Mandatory Workspace Dir

**File:** `src-tauri/sidecar-opencode/src/config-builder.ts` — `buildSystemPrompt()` (line 33)

Make `workspaceDir` a **required** parameter (reorder so it comes before the optional `customPrompt`)

Unconditionally emit a `<workspace-conventions>` section after `<capabilities>` (before `<server-access>`). The block embeds the current workspace path, marks `Input/` as read-only, and forces every new file under a **category subfolder** of `${workspaceDir}/Output/` (the agent picks the actual subfolder name based on the file's nature):

The category list and examples are soft-enforced via the system prompt only. The hard `edit: allow` rule for `${workspaceDir}/Output/` and its descendants (Step 6) already permits any subfolder layout, so no permission-rule changes are needed to support categorized output.

**File:** `src-tauri/sidecar-opencode/src/session-manager.ts` — lines 365 and 421

Thread `workingDirectory` to `buildSystemPrompt` in the new argument order. Because the payload types mark `workingDirectory?: string` as optional, coalesce to an empty string defensively

**File:** `src-tauri/sidecar-opencode/__tests__/server-isolation.test.ts`

Update all existing `buildSystemPrompt` test calls to pass a workspace path (e.g., `'/tmp/workspace'`) and add **two** new tests:
1. Asserts the prompt contains the workspace path and the `${workspaceDir}/Output/` instruction.
2. Asserts the prompt contains the phrase `category subfolder` and each of the common category names (`executable/`, `product/`, `ux-prototype/`, `engineering/`, `testing/`) so the categorized-output guidance is locked in against accidental deletion.

---

## Step 8: Frontend — Switch to Workspace-Scoped API

### 8a: Tauri API functions

**File:** `src/lib/tauri-api.ts` (lines 243-257)

Replace task-scoped functions with workspace-scoped

Keep the function names (`saveFolderPermission`, etc.) to minimize churn, but change the first parameter from `taskId` to `workspaceId` and the backend invocation targets.

### 8b: TaskStore

**File:** `src/stores/taskStore.ts`

**`addFolderPermission`** (lines 369-384): Change from `currentTask.id` to workspace ID

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

1. **Convention-based defaults:** `Input/` is read-only (edit: deny), `Output/` is writable (edit: allow), workspace root allows read/list for everything
2. **Workspace-scoped persistence:** Replaced `folder_permissions` (task-scoped) with `workspace_permissions` (workspace-scoped). Adhoc approvals now carry across all tasks in the same workspace.
3. **Bash soft enforcement:** System prompt instructs agent not to modify `Input/` via bash commands. Hard enforcement is via `edit: deny` rules.
4. **Architecture flow:** User approves permission → saved to `workspace_permissions` → loaded for all future tasks in workspace

Also update the **Key Source Locations** table to reference `workspace_permissions.rs` instead of `folder_permissions.rs`.

---

## Step 10: Update Log

**File:** `UPDATE_LOG.md` — under v0.6.5:

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
   - Create workspace with `Input/data.txt` and `Output/`
   - Start task: "Edit the file at Input/data.txt" → agent denied by OpenCode
   - Start task: "Create a summary in Output/" → succeeds without prompt, file lands under a category subfolder (e.g., `Output/research/` or `Output/product/`), not directly in `Output/`
   - Start task: "Write a Python script that prints today's date and an ADR explaining the choice of Python" → script lands in `Output/executable/`, ADR lands in `Output/engineering/` (or `Output/engineering/adr/`)
   - Follow-up task in same workspace: "Add unit tests for the script" → tests land in `Output/testing/`; the script remains in `Output/executable/` (agent reused the existing category)
6. **Manual — Workspace-scoped persistence:**
   - In task A, approve an external folder permission
   - Start task B in same workspace → external folder auto-allowed (no prompt)
7. **Manual — Arena:**
   - Start arena in workspace with Input/Output → all 3 agents get convention rules
   - Approve permission in arena → persists for workspace

---

---

## Extension: Four-Folder Workspace Convention (v0.7.15)

Extends the two-folder workspace convention (`Input/` + `Output/`) to four root-level convention folders, with the agent instructed to auto-create any missing folders as its first action in a fresh workspace. **Aligned with the `rfp-daily` folder-governance model** (see `~/dev/ai-sdlc/zapac-agent-skills/rfp-daily/assets/folder_governance.md`).

### Convention folders

| Folder | Edit permission (workspace source) | Purpose |
| --- | --- | --- |
| `Input/` | `deny` (existing) | Immutable source-of-truth material — user-provided datasets, reference docs, governance documents, reusable templates |
| `Output/` | `allow` (existing) | The agent's writable working area; the only folder it may write to freely. New files land under a category subfolder here |
| `Misc/` (new in v0.7.14, **rule changed in v0.7.15**) | `ask` | Default read-only — static user-provided assets (icons, logos, brand images, fonts) **plus** curated supporting scripts and prompt experiments promoted from `Output/` after human review; user is prompted before every write |
| `Artefacts/` (new) | `ask` | Governed, versioned deliverables promoted from `Output/` after human review; user is prompted before every write |

### Alignment with `rfp-daily` Folder Governance

This convention is intentionally aligned with the four-tier governance model used in the `rfp-daily` skill (see `~/dev/ai-sdlc/zapac-agent-skills/rfp-daily/assets/folder_governance.md`). Both share the same four root-level folders (`Input/`, `Misc/`, `Artefacts/`, `Output/`), the same access tiers (read-only, default-read-only-with-approval, read/write), and the same promotion model:

```text
Output/ ──(human review)──┬──▶ Artefacts/<domain sub-folder>/   (governed deliverables)
                          └──▶ Misc/                            (curated scripts, prompt experiments)
```

- The agent generates new artefacts and utilities in `Output/`.
- The user reviews and decides whether to promote each file.
- Governed deliverables → `Artefacts/<category>/...` (mirrors the `Output/` category-subfolder layout).
- Curated supporting scripts / prompt experiments → `Misc/<topic>/...` (e.g., `Misc/scripts/`, `Misc/prompt-experiments/`).
- The agent must not auto-promote — both `Artefacts/` and `Misc/` are `edit: ask`, so OpenCode prompts on each write.

### Implementation notes

- **Hard rules:** `buildSessionConfig()` in `src-tauri/sidecar-opencode/src/config-builder.ts` was extended in the `fp.source === 'workspace'` branch to emit four additional edit-rule entries alongside the existing `Input/`/`Output/` pair (`Misc` + `Misc/*` → `ask` *(was `deny` in v0.7.14, changed to `ask` in v0.7.15 for rfp-daily alignment)*, `Artefacts` + `Artefacts/*` → `ask`). Read rules and `external_directory` are unchanged: `readRules[wsPath] = 'allow'` already covers reads under `Misc/` and `Artefacts/`.
- **Auto-creation is agent-driven, not Rust-driven.** No Rust or filesystem code creates these folders. Instead, the `<workspace-conventions>` block of the system prompt (also in `config-builder.ts`, function `buildSystemPrompt`) opens with an "ensure folders exist" instruction telling the agent to run a single idempotent `mkdir -p "<ws>/Input" "<ws>/Output" "<ws>/Misc" "<ws>/Artefacts"` (PowerShell `New-Item -ItemType Directory -Force ...` on Windows) as its very first action in a new workspace. `mkdir -p` is safe on existing folders. It is the *only* path the agent has to create `Input/` (blocked by `edit: deny`). For `Misc/` and `Artefacts/` (both `edit: ask`), the bash mkdir also bypasses the per-file permission prompt on workspace bootstrap, since bash isn't gated by the `edit` permission.
- **`Misc/` is `edit: ask`, not `edit: deny` (v0.7.15 change).** Aligns with `rfp-daily` governance: `Misc/` holds curated supporting scripts and prompt experiments promoted from `Output/`, in addition to static user assets. Hard-denying writes would block the promotion workflow. The `ask` rule preserves the read-only default while letting the user explicitly approve each promotion.
- **`Artefacts/` is `edit: ask`, not `edit: allow`.** This is intentional. The user must explicitly approve every write into `Artefacts/`, so the agent never silently dumps files into the curated-deliverables area.
- **Dual promotion workflow.** The system prompt describes two promotion targets:
  - **Governed deliverables → `Artefacts/<category>/...`** — mirrors the `Output/` category-subfolder layout (e.g., `Output/product/spec.md` → `Artefacts/product/spec.md`).
  - **Curated utilities → `Misc/<topic>/...`** — e.g., `Output/executable/<name>.py` → `Misc/scripts/<name>.py`, `Output/research/<name>.md` → `Misc/prompt-experiments/<name>.md`.

  Triggers include "promote", "publish", "save as artefact", "save as utility", or "finalize". Promotion is explicit and per-request — the agent never copies into `Artefacts/` or `Misc/` proactively without being asked.
- **No DB / migration changes.** This extension lives entirely in the sidecar `config-builder.ts` (edit-rule generation + system prompt). The Rust permission model and `workspace_permissions` table are unchanged.

### Tests

- **`src-tauri/sidecar-opencode/__tests__/config-builder.test.ts`** — asserts edit rules for all four convention folders (`Input/` → `deny`, `Output/` → `allow`, `Misc/` → `ask`, `Artefacts/` → `ask`), the workspace-root general allow, and the read-rule coverage.
- **`src-tauri/sidecar-opencode/__tests__/server-isolation.test.ts`** — `buildSystemPrompt` assertions: prompt mentions all four folder names; prompt contains the `mkdir -p` (or PowerShell `New-Item`) auto-create instruction referencing the four folder paths; prompt describes the promote workflow into `Artefacts/`.
