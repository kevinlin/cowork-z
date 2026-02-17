# Workspace Starter Packs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Workspace Starter Packs feature where Home.tsx becomes a packs browser that lets users install guided, copyable workspace folders and auto-start an AI task.

**Architecture:** Verbatim port of [`frumu-ai/tandem src-tauri/src/packs.rs`](https://github.com/frumu-ai/tandem/blob/main/src-tauri/src/packs.rs) into `src-tauri/src/commands/packs.rs` (3 adaptations: 6-pack catalog, "Cowork-Z Packs" default dir, `println!`/`eprintln!` instead of `tracing`). Wire up three Tauri commands (`packs_list`, `packs_install`, `packs_install_default`), add TypeScript IPC wrappers matching [`frumu-ai/tandem src/lib/tauri.ts`](https://github.com/frumu-ai/tandem/blob/main/src/lib/tauri.ts#L1346-L1376), then rewrite `Home.tsx` to replace the "Example prompts" section with a 2-column packs grid.

**Tech Stack:** Rust (serde, tauri, dirs, std::fs), TypeScript, React, Tauri `invoke()`, `@tauri-apps/plugin-dialog` (via existing `pickFolder()`), Zustand (`useWorkspaceStore`, `useTaskStore`).

---

## Task 1: Create the Rust packs module

**Source:** Verbatim port of [`src-tauri/src/packs.rs` from `frumu-ai/tandem`](https://github.com/frumu-ai/tandem/blob/main/src-tauri/src/packs.rs) with three cowork-z adaptations:
1. Catalog trimmed to the 6 packs that have on-disk content (3 stubs removed)
2. Default install dir changed from `"Tandem Packs"` → `"Cowork-Z Packs"`
3. `tracing::info!`/`tracing::warn!` replaced with `println!`/`eprintln!` (tracing crate not in cowork-z)

**Files:**
- Create: `src-tauri/src/commands/packs.rs`

### Step 1: Create the file

### Step 2: Verify it compiles

```bash
cd src-tauri && cargo check
```

Expected: 0 errors. (`dirs` crate is already in `Cargo.toml`.)

---

## Task 2: Wire the module into the Tauri app

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:15`
- Modify: `src-tauri/src/lib.rs:231`
- Modify: `src-tauri/tauri.conf.json:45`

### Step 1: Register the module in `commands/mod.rs`

In `src-tauri/src/commands/mod.rs`, add `pub mod packs;` after line 15 (`pub mod workspaces;`):

```rust
pub mod workspaces;
pub mod packs;
```

### Step 2: Register the three Tauri commands in `lib.rs`

In `src-tauri/src/lib.rs`, after the `// Workspaces` block (lines 224–231), add:

```rust
            // Packs
            commands::packs::packs_list,
            commands::packs::packs_install,
            commands::packs::packs_install_default,
```

### Step 3: Create symlinks for production resource bundling

`workspace-packs/` at the repo root is the single source of truth. Rather than duplicating content into `src-tauri/resources/`, create symlinks so Tauri's bundler follows them at build time. In dev, `resolve_pack_sources()` already falls back to `CARGO_MANIFEST_DIR/../workspace-packs/` directly — the symlinks are only needed for production bundles.

```bash
cd src-tauri/resources
ln -s ../../workspace-packs/packs packs
ln -s ../../workspace-packs/pack-docs pack-docs
```

Verify the symlinks resolve correctly:

```bash
ls src-tauri/resources/packs/
```

Expected: lists the 6 pack directories (`micro-drama-script-studio-pack`, `research-synthesis-pack`, etc.).

### Step 4: Add pack resources to `tauri.conf.json`

In `src-tauri/tauri.conf.json` line 45, change:
```json
"resources": ["resources/skills/**/*"],
```
to:
```json
"resources": [
  "resources/skills/**/*",
  "resources/packs/**/*",
  "resources/pack-docs/**/*"
],
```

At runtime, `resolve_pack_sources()` searches these paths (among others):
- `{resource_dir}/resources/packs/` ← production bundle path
- `CARGO_MANIFEST_DIR/../workspace-packs/packs/` ← dev fallback (debug builds only)

### Step 5: Verify compilation

```bash
cd src-tauri && cargo check
```

Expected: 0 errors.

---

## Task 3: Add TypeScript IPC wrappers

**Files:**
- Modify: `src/lib/tauri-api.ts` (after line 1170, before the `// Compatibility Helpers` section)
- Modify: `src/lib/tauri-api-interface.ts` (after line 284, in the `TauriAPI` interface)

### Step 1: Add types and functions to `tauri-api.ts`

After the `// Workspaces` section (after line 1170), insert a new `// Packs` section:

### Step 2: Add to the `TauriAPI` interface in `tauri-api-interface.ts`

First, add the import at the top of `tauri-api-interface.ts` alongside the other type imports. Find the existing import line that brings in types from `tauri-api.ts` and add `PackMeta` and `PackInstallResult` to it. If types are imported individually, add:

```typescript
import type { PackMeta, PackInstallResult } from './tauri-api';
```

Then, in the `TauriAPI` interface (after the `onWorkspaceFsChanged` line 284), add:

```typescript
  // Packs
  listPacks(): Promise<PackMeta[]>;
  installPack(packId: string, destinationDir: string): Promise<PackInstallResult>;
  installPackDefault(packId: string): Promise<PackInstallResult>;
```

> **Note:** `getTauriAPI()` uses `{ ...tauriApi, ...overrides }` spread. Since `listPacks`, `installPack`, and `installPackDefault` are not event listeners (no async-to-sync conversion needed), they are automatically included in the spread and do not require explicit overrides in the `cachedTauriAPI` object.

Also add `listPacks`, `installPack`, `installPackDefault` to the return object in `getTauriApi()` in `tauri-api.ts` (in the final return block around line 1354–1363):

```typescript
    // Packs
    listPacks,
    installPack,
    installPackDefault,
```

### Step 3: Verify types

```bash
pnpm typecheck
```

Expected: 0 errors.

---

## Task 4: Rewrite Home.tsx

**Files:**
- Modify: `src/pages/Home.tsx`

### Step 1: Read the current file

Read the full `src/pages/Home.tsx` to confirm current state before editing.

### Step 2: Write the new file

Replace the entire file with:

### Step 3: Check types

```bash
pnpm typecheck
```

Expected: 0 errors. Fix any type errors before continuing.

---

## Task 5: Update tests

**Files:**
- Modify: `src/pages/__tests__/Home.test.tsx` (if it exists — check first)

### Step 1: Check for existing tests

```bash
ls src/pages/__tests__/
```

If `Home.test.tsx` exists, read it and update any snapshot tests or assertions that reference the old `USE_CASE_EXAMPLES` content, `showExamples`, or the example prompts DOM structure.

If `Home.test.tsx` does not exist, skip this task.

### Step 2: Run the test suite

```bash
pnpm test --run
```

Expected: all tests pass. Fix any failures caused by the Home.tsx rewrite.

---

## Task 6: Smoke test in dev

### Step 1: Run the app

```bash
pnpm tauri dev
```

### Step 2: Verify

1. Home screen shows "Starter Packs" section below the prompt bar (not "Example prompts")
2. All 6 pack cards render with title, description, complexity pill, time, tags, Install button
3. Searching filters cards correctly
4. Clicking Install opens a native folder picker
5. Cancelling the picker dismisses without error
6. Successful install → workspace added → task started → navigate to `/execution/:id`

---

## Completion Checklist

- [ ] `cargo check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test --run` passes
- [ ] All 6 packs visible on Home screen
- [ ] Install flow works end-to-end in `pnpm tauri dev`
- [ ] Update `docs/specs/cowork-z/requirements.md` with feature completion
- [ ] Append entry to `UPDATE_LOG.md`

---

## Implementation Log

### 2026-02-17 — Extract StarterPacks component

**Task:** Extract the inline packs catalog from `Home.tsx` (lines 202–267) into a self-contained `StarterPacks` component.

**Changes:**

| File | Change |
|------|--------|
| `src/components/landing/StarterPacks.tsx` | **New** — Self-contained packs catalog component extracted from `Home.tsx`. Owns all packs-specific state: catalog loading (`listPacks`), search filtering, install flow (folder picker → `installPack` → `addWorkspace` → `switchWorkspace` → `executeTask`), and per-card error display. Follows the same pattern as `SkillsCatalog`. |
| `src/pages/Home.tsx` | Removed packs-specific state (`packs`, `packsLoading`, `installingId`, `packErrors`, `query`), `filteredPacks` memo, `handleInstall` callback, and `COMPLEXITY_COLORS` constant. Removed unused imports (`pickFolder`, `PackMeta`, `useWorkspaceStore`). Replaced inline packs JSX with `<StarterPacks />`. |
| `docs/specs/workspace-packs/design.md` | Updated Architecture layer 3 description, Home.tsx layout diagram, and Files Changed table to reflect the extraction. |

**Verification:** `pnpm typecheck` passes with 0 errors. No lint errors.
