# Skills Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated Skills Manager window that lets users register Git repos as skill sources, browse/install/update/delete skills, and manage installed skills across three global skill directories.

**Architecture:** Separate Tauri window (`/#/skills`) with its own three-panel layout (file tree, skills grid, file preview). Backend uses `std::process::Command` to shell out to `git` for clone/pull operations. Two new DB tables (`skill_repos`, `repo_skills`) store repo metadata and discovered skills. Cross-window sync via `skills:changed` Tauri events.

**Tech Stack:** Tauri 2.x (Rust backend), React 19, TypeScript, Zustand, Radix UI / shadcn/ui, Tailwind CSS, `std::process::Command` for Git, SQLite (rusqlite), OS Keychain (keyring crate)

**Design:** [design_skills-manager.md](design_skills-manager.md)
**Requirements:** [requirements.md section 8.3](../cowork-z/requirements.md)

---

## Phase 1: Backend Foundation

### Task 1: Database Migration v3 — `skill_repos` and `repo_skills` Tables

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/skill_repos.rs`
- Modify: `src-tauri/src/db/mod.rs`

**Step 1: Add the `skill_repos` module**

Create `src-tauri/src/db/skill_repos.rs` with the `StoredSkillRepo` struct and CRUD functions following the `workspaces.rs` pattern:

**Step 2: Register the module**

In `src-tauri/src/db/mod.rs`

**Step 3: Write migration v3**

In `src-tauri/src/db/migrations.rs`:

1. Change `CURRENT_VERSION` from `2` to `3`
2. Add the `migrate_v3` function
3. Add to `run_migrations()`

**Step 4: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

---

### Task 2: Git Operations Module

**Files:**
- Create: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` (module registration)

**Step 1: Create `git_ops.rs`**

This module wraps `std::process::Command` calls to `git`. It does NOT depend on Tauri — pure Rust, easily testable.

Key functions:
- `derive_repo_name(url)` — extracts display name from Git URL (e.g. `anthropics/knowledge-work-plugins`)
- `derive_cache_dir_name(url)` — derives filesystem-safe cache directory name by calling `derive_repo_name()` then replacing `/` with `_` (e.g. `anthropics_knowledge-work-plugins`). Used by `repo_cache_dir()` in `skill_repos.rs` and the background sync in `lib.rs`.

**Step 2: Register the module**

In `src-tauri/src/lib.rs`

**Step 3: Verify**

Run: `cd src-tauri && cargo test git_ops`
Expected: All 9 tests pass (6 original + 3 for `derive_cache_dir_name`).

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

### Task 3: Skill Discovery Module

**Files:**
- Create: `src-tauri/src/skill_discovery.rs`
- Modify: `src-tauri/src/lib.rs` (module registration)

This module scans a cloned repo directory for `SKILL.md` files and produces `StoredRepoSkill` records. It implements convention-based scanning, optional manifest override, and repo-specific adapters for `anthropics/knowledge-work-plugins` and `openai/skills`.

**Step 1: Create `skill_discovery.rs`**

**Step 2: Make `parse_frontmatter` and `derive_category` public**

In `src-tauri/src/commands/skills.rs`, ensure these functions are `pub` (not `pub(crate)` or private):

**Step 3: Register the module**

In `src-tauri/src/lib.rs`

**Step 4: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

### Task 4: Repo Management Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/skill_repos.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (command registration)

**Step 1: Create `commands/skill_repos.rs`**

This module contains all Tauri commands for repo CRUD and sync. It orchestrates `git_ops`, `skill_discovery`, and `db::skill_repos`.

Key implementation detail — **Cache directory naming:** The `repo_cache_dir(app, repo_url)` helper derives the cache directory path using `git_ops::derive_cache_dir_name(url)`, which produces a human-readable name (e.g. `anthropics_knowledge-work-plugins`) instead of a UUID. All callers pass the repo URL (not the repo ID) to this function. The DB `id` field remains a UUID for relational integrity.

**Step 2: Register commands module**

In `src-tauri/src/commands/mod.rs`

**Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` macro (after the existing skills section):

**Step 4: Add dependencies to `Cargo.toml`**

Ensure these are present in `src-tauri/Cargo.toml` (`serde_json` and `dirs` should already be present.)

**Step 5: Make `copy_dir_recursive` and `compute_dir_checksum` public**

In `src-tauri/src/commands/skills.rs`, change visibility

**Step 6: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

### Task 5: Tauri Capabilities for Skills Manager Window

**Files:**
- Create: `src-tauri/capabilities/skills.json`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Create skills window capability**

Create `src-tauri/capabilities/skills.json`

**Step 2: Share main window capabilities with skills window**

In `src-tauri/capabilities/default.json`:
1. Change `"windows": ["main"]` to `"windows": ["main", "skills"]` so both windows share the same Tauri command permissions (including `read_directory` and all custom skill repo commands).
2. Add `"core:webview:allow-create-webview-window"` to the `permissions` array.

> **Implementation note:** The `skills.json` capability alone only grants `core:default`, which does **not** include custom `#[tauri::command]` invoke permissions. Without sharing the main window's capability scope, all Tauri command calls from the Skills Manager window will silently fail.

**Step 3: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

### Task 6: Emit `skills:changed` from Existing Skills Install

**Files:**
- Modify: `src-tauri/src/commands/skills.rs`

The existing `skills_install` command (bundled catalog) should also emit `skills:changed` so the Skills Manager window refreshes.

**Step 1: Add emit to `skills_install`**

In `src-tauri/src/commands/skills.rs`, modify the `skills_install` command to take `app: AppHandle` and emit after install

Add `use tauri::Emitter;` at the top of the file if not already present.

**Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

## Phase 2: Frontend API + Store

### Task 7: Frontend Types and API Wrappers

**Files:**
- Modify: `src/lib/tauri-api.ts`
- Modify: `src/lib/tauri-api-interface.ts`

**Step 1: Add types to `tauri-api.ts`**

Add after the existing skill types (around line 1225)

**Step 2: Add invoke wrappers**

Add after the existing skill functions

**Step 3: Add to `getTauriApi()` return object**

In the `getTauriApi()` function, add to the return object

**Step 4: Update `TauriAPI` interface**

In `src/lib/tauri-api-interface.ts`, add to the interface and import the new types

In the `cachedTauriAPI` object spread section, wrap the event listeners

**Step 5: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

### Task 8: Skills Manager Zustand Store

**Files:**
- Create: `src/stores/skillsManagerStore.ts`

**Step 1: Create the store**

**Step 2: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

## Phase 3: Window & Routing Infrastructure

### Task 9: Router + SkillsManagerPage Shell

**Files:**
- Create: `src/pages/SkillsManager.tsx`
- Modify: `src/App.tsx`
- Create: `src/lib/skills-window.ts`

**Step 1: Create the window open utility**

Create `src/lib/skills-window.ts`

**Step 2: Create the `SkillsManagerPage` shell**

Create `src/pages/SkillsManager.tsx` with a minimal three-panel layout shell

**Step 3: Add route to `App.tsx`**

In `src/App.tsx`, import the page and add the route. The `/skills` route should render the page directly (no sidebar, no layout wrapper)

The `/skills` route renders without the main app layout (no `Sidebar`, no `SettingsDialog`, no `FilePreviewPanel`). This means the route check needs to happen BEFORE the layout wrapper. Check the existing `App.tsx` structure — if routes are rendered inside a layout, the `/skills` route may need to be at the top level, outside the layout.

Looking at the current `App.tsx` structure, the routes are rendered inside a layout div that includes the sidebar. The `/skills` route needs to be OUTSIDE this layout. Use a conditional check on `location.pathname`:

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

### Task 10: Entry Point in Main Window Sidebar

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Add Skills Manager button to the sidebar bottom bar**

In `src/components/layout/Sidebar.tsx`, add a button between the `FeedbackButton` and the Settings button in the bottom bar (around line 258)

**Step 2: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

## Phase 4: UI Components

### Task 11: Left Sidebar — Folder Switcher + File Tree

**Files:**
- Create: `src/components/skills-manager/SkillsSidebar.tsx`
- Create: `src/components/skills-manager/FolderSwitcher.tsx`

**Step 1: Create `FolderSwitcher.tsx`**

The `SelectTrigger` uses `border-primary/40 font-medium text-primary` to emphasize the active target folder selection.

**Step 2: Create `SkillsSidebar.tsx`**

This component uses `useFileTree` to display the installed skills folder tree. Clicking a file opens it in the preview store.

Key implementation details:
- **Hidden file filter toggle:** Uses the shared `isHiddenEntry()` from `FileTreePanel.tsx` with a `useMemo`-based `hiddenFilter` predicate passed to `useFileTree`. An eye icon button (Eye/EyeOff from lucide-react) toggles `showHidden` state. Hidden files are filtered by default (matching the main window's file tree behavior). The search bar and toggle button are laid out inline with the same styling as `FileTreePanel` (Search icon, rounded-md border, ring focus state).
- **Auto-refresh on `skills:changed`:** A `useEffect` subscribes to `skills:changed` via `getTauriAPI().onSkillsChanged()` and calls `refreshRoot()` (debounced 200ms via `setTimeout` + `useRef`) to reload the file tree after any skill install, update, or delete. The cleanup function calls `unlisten()` and clears the debounce timer.

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

### Task 12: Center Panel — Repo Toolbar + Skills Grid

**Files:**
- Create: `src/components/skills-manager/RepoToolbar.tsx`
- Create: `src/components/skills-manager/RepoSkillsGrid.tsx`
- Create: `src/components/skills-manager/SkillCard.tsx`
- Create: `src/components/skills-manager/AddRepoDialog.tsx`

**Step 1: Create `RepoToolbar.tsx`**

The toolbar with: repo filter dropdown, "Add Repo" button, "Sync" button, last-synced time. When a specific repo is selected (not "All Repos"), the `SelectTrigger` is styled with `border-primary/40 font-medium text-primary` to visually emphasize the active filter.

**Step 2: Create `AddRepoDialog.tsx`**

**Step 3: Create `RepoSkillsGrid.tsx` and `SkillCard.tsx`**

This is the center panel grid, modeled after `SkillsCatalog.tsx`. The `SkillCard` is extracted to its own component file (`src/components/skills-manager/SkillCard.tsx`) for reusability and separation of concerns.

Key implementation details:
- **`SkillCard` is a standalone component** — it owns its own "View" handler and category color map, receiving `skill`, `installing`, `deleting`, `error`, `onInstall`, and `onDelete` as props.
- **View points to the local cloned repo cache**, not the installed skills folder. The path is constructed as `{appDataDir}/skill-repo-cache/{repoCacheName}/{skill.skillPath}/SKILL.md` where `repoCacheName` is `skill.repoName.replaceAll('/', '_')` (matching the Rust `derive_cache_dir_name()` convention). Uses `appDataDir()` from `@tauri-apps/api/path`. This ensures "View" works even before a skill is installed.
- **`RepoSkillsGrid` handles install and delete logic** and passes callbacks down to `SkillCard`.
- **Delete functionality:** `SkillCard` shows a trash icon (Trash2 from lucide-react) next to installed skills (both "Installed" and "Needs Update" states). Clicking it calls `onDelete`, which triggers `skillsDeleteInstalled(skill.skillId, targetFolder)` in `RepoSkillsGrid`. A `deleting` boolean prop disables the card during deletion. The backend emits `skills:changed` after deletion, which triggers the sidebar file tree refresh and store re-fetch.

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

### Task 13: Assemble the Full SkillsManagerPage

**Files:**
- Modify: `src/pages/SkillsManager.tsx`
- Create: `src/components/skills-manager/SkillsStatusBar.tsx`

**Step 1: Create `SkillsStatusBar.tsx`**

**Step 2: Assemble the full page**

Update `src/pages/SkillsManager.tsx` to wire all components together with the three-panel layout, including the resizable right file preview pane and theme initialization:

Key implementation details:
- **Theme:** Call `useTheme()` on mount so the Skills Manager window loads and applies the persisted theme (the Skills Manager bypasses the main `App.tsx` layout, so theme must be initialized independently).
- **Resizable preview pane:** Same drag-resize pattern as the main window's `FilePreviewPanel` (min 280px, max 700px, default 400px). The drag handle uses `startX - ev.clientX` (inverse delta) since the panel is anchored to the right edge.
- **Resizable sidebar:** Min 200px, max 400px, default 250px. Uses `ev.clientX - startX` (forward delta).
- Both resize handlers set `document.body.style.cursor` and `userSelect` during drag for smooth UX.
- `FilePreviewPanel` is called WITHOUT `onAddToChat` — this hides the "Add to Chat" button since the prop is optional.

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

## Phase 5: Integration & Polish

### Task 14: Background Sync on App Launch

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add background sync in the `setup` closure**

In `src-tauri/src/lib.rs`, after the existing setup code (opencode-server-api skill deploy), add a background task that iterates registered repos and pulls updates. The cache directory path is derived using `crate::git_ops::derive_cache_dir_name(&repo.url)` (human-readable name, not UUID).

**Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

---

### Task 15: Cross-Window Sync in Main Window

**Files:**
- Modify: `src/components/landing/SkillsCatalog.tsx`
- Modify: `src/stores/skillsStore.ts`

The main window's `SkillsCatalog` and `useSkillsStore` (autocomplete) need to listen for `skills:changed` events from the Skills Manager.

**Step 1: Add event listener to `SkillsCatalog`**

In `src/components/landing/SkillsCatalog.tsx`, add a `useEffect` that subscribes to `skills:changed`

**Step 1b: Add Skills Manager footer link to `SkillsCatalog`**

Add a `border-t` footer below the skill grid with text: "For full control of your skills, use **Skills Manager**" where "Skills Manager" is a `<button>` styled as an inline text link (`font-medium text-primary underline hover:no-underline`) that calls `openSkillsManagerWindow()` from `@/lib/skills-window`. This provides a contextual entry point from the bundled skills catalog to the full Skills Manager window.

**Step 2: Add event listener to `skillsStore`**

This is trickier since the store doesn't own a lifecycle. The best approach is to have the `App.tsx` (main window) subscribe and call `fetchInstalledSkills` on the store. Add to the main `App.tsx` effect that handles other event subscriptions

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

---

### Task 16: Final Verification and Cleanup

**Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors.

**Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 3: Lint**

Run: `pnpm ultracite:fix src/ src-tauri/sidecar-opencode/`
Expected: Auto-fixes applied.

**Step 4: Run existing tests**

Run: `pnpm test --run`
Expected: All existing tests pass.

Run: `cd src-tauri && cargo test`
Expected: All existing tests pass (including new `git_ops` tests).

---

## Implementation Log

- Phases 1–5 implemented (Tasks 1–16)
- **Post-implementation fixes (2026-02-21):**
  - **SkillsSidebar auto-refresh:** Added `skills:changed` event subscription with debounced `refreshRoot()` call so the file tree updates after skill install/update/delete
  - **Hidden file filter toggle:** Added Eye/EyeOff toggle button to SkillsSidebar search bar, reusing `isHiddenEntry()` from `FileTreePanel.tsx` with `useMemo`-based filter predicate
  - **Delete functionality:** Added `onDelete` prop and trash icon to `SkillCard` for installed skills; wired `handleDelete` in `RepoSkillsGrid` calling `skillsDeleteInstalled()` (backend command already existed)
  - **Human-readable cache dir names:** Changed `repo_cache_dir()` to use `derive_cache_dir_name(url)` (repo name with `/` → `_`) instead of UUID. Added `derive_cache_dir_name()` to `git_ops.rs` with 3 tests. Updated all callers in `skill_repos.rs`, `lib.rs` background sync, and frontend `SkillCard.tsx` View handler.
  - **Skills Manager entry point in SkillsCatalog:** Added footer link in `SkillsCatalog.tsx` — "For full control of your skills, use Skills Manager" — that calls `openSkillsManagerWindow()` to open the Skills Manager window.
  - **`openai/skills` repo adapter:** Added `discover_openai_skills()` in `skill_discovery.rs` to handle repos that organize skills under dotfile-prefixed subdirectories (`skills/.curated/`, `skills/.system/`, `skills/.experimental/`). The convention-based scanner skips dotfile directories, so this adapter explicitly enumerates the known subdirectories via the `OPENAI_SKILL_SUBDIRS` constant. Detected via URL match on `github.com/openai/skills`. Skill IDs use directory names directly (no category prefix). Falls back to convention scan if `skills/` root is absent.