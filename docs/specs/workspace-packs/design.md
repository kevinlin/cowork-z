# Design: Workspace Starter Packs

**Date:** 2026-02-17
**Branch:** main

---

## Overview

Add a Workspace Starter Packs feature to cowork-z. Packs are guided, copyable workspace folders that ship pre-loaded sample inputs, documentation, and prompts for specific real-world tasks. The Home screen (`src/pages/Home.tsx`) becomes the entry point for packs: the existing "Example Prompts" section is replaced by a browsable, installable pack catalog.

---

## Approved Design

### Architecture (3 layers)

1. **Rust backend** — New `src-tauri/src/commands/packs.rs`, a direct port of Tandem's `packs.rs`. Exposes three Tauri commands: `packs_list`, `packs_install`, `packs_install_default`. Registered in `commands/mod.rs` and `lib.rs`.

2. **Resource bundling** — `tauri.conf.json` gains two resource globs:
   ```json
   "workspace-packs/packs/**/*"
   "workspace-packs/pack-docs/**/*"
   ```
   Dev path resolves via `CARGO_MANIFEST_DIR/../workspace-packs/`. Prod reads from bundled `resources/packs/` and `resources/pack-docs/`.

3. **Frontend** — `tauri-api.ts` and `tauri-api-interface.ts` gain `PackMeta`, `PackInstallResult`, `listPacks()`, `installPack()`, `installPackDefault()`. `Home.tsx` is rewritten with a wider container and a packs grid replacing `USE_CASE_EXAMPLES`.

---

### Data & Catalog

Include only the **6 packs with on-disk content**. No stubs for packs without content.

| Pack ID | Title | Complexity | Time |
|---------|-------|------------|------|
| `micro-drama-script-studio-pack` | Micro-Drama Script Studio | Intermediate | 15-20 min |
| `research-synthesis-pack` | Research Synthesis | Intermediate-Advanced | 20-25 min |
| `web-research-refresh-pack` | Web Research Refresh | Beginner-Intermediate | 15-20 min |
| `security-playbook-pack` | Security Playbook | Intermediate | 20-25 min |
| `legal-research-pack` | Legal Research | Intermediate-Advanced | 20-25 min |
| `web-starter-audit-pack` | Web Starter Audit | Beginner-Intermediate | 15-20 min |

The Rust catalog is a hardcoded `Vec<PackMeta>` (same pattern as Tandem). `pack_id` is validated against this catalog before any filesystem operation, preventing path traversal.

---

### Home.tsx Layout

**Container width:** `max-w-2xl` → `max-w-4xl`

**Structure** (preserving the existing Card shell):

```
Card
├── CardContent (p-6 pb-4)
│   └── TaskInputBar  ← unchanged
└── border-t section  ← replaces "Example prompts" toggle
    ├── Header row
    │   ├── Left: "Starter Packs" label + subtitle
    │   └── Right: search input (filters by title/description/tags)
    └── ScrollArea (max-h ~400px, overflow-y-auto)
        └── 2-column grid of PackCard components
            Each card:
            ├── Title (bold)
            ├── Description (muted, 2 lines)
            ├── Complexity pill + time estimate
            ├── Tag pills (up to 4, runtime-aware coloring for python/node/bash)
            └── Install button (right-aligned)
```

The `AnimatePresence` collapse from the old "Example prompts" section is removed. The packs section is always visible (no toggle).

**Removed:** `USE_CASE_EXAMPLES` array and all use-case image imports.

---

### Install Flow

1. User clicks **Install** on a pack card.
2. `installingId` state is set to `packId` (shows spinner on that card only).
3. Native folder picker opens via `@tauri-apps/plugin-dialog` `open({ directory: true })`.
4. If user cancels (returns `null`): no-op, clear `installingId`.
5. `installPack(packId, destinationDir)` is called via IPC.
6. Rust copies `workspace-packs/packs/<id>/` recursively, then individually copies `START_HERE.md`, `PACK_INFO.md`, `PROMPTS.md`, `EXPECTED_OUTPUTS.md` from `workspace-packs/pack-docs/<id>/`.
7. Returns `PackInstallResult { installed_path }`.
8. Frontend calls `addWorkspace(installedPath)` via `workspaceStore.addWorkspace()`, receiving the new `Workspace` object.
9. Frontend calls `switchWorkspace(workspace.id)` to activate the new workspace (reconnects SSE, reloads file tree and session list).
10. Task input is seeded: `"Open \`START_HERE.md\` and follow it step-by-step."`.
11. `startTask({ prompt, taskId })` is called and the app navigates to `/task/:id`.

---

### Post-Install State

- The installed pack folder becomes a registered cowork-z workspace.
- A task is immediately started with the `START_HERE.md` prompt.
- The user lands on the Execution page with the AI ready to guide them through the pack.

---

### Error Handling

| Scenario | Behavior |
|----------|----------|
| User cancels folder picker | `null` returned, no-op, `installingId` cleared |
| Rust install fails (missing source dir, IO error) | Error string shown in pack card error state; `installingId` cleared |
| `addWorkspace` fails | Toast error shown; pack files are already copied — user can manually add the folder |
| `startTask` fails after install | Workspace is registered; user lands on Home with new workspace active and can type manually |

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/commands/packs.rs` | **New** — port of Tandem's packs module (PackMeta, PackInstallResult, list_packs, install_pack, install_pack_default, resolve_pack_sources, copy_dir_recursive, choose_destination_dir, default_pack_root) |
| `src-tauri/src/commands/mod.rs` | Add `pub mod packs;` |
| `src-tauri/src/lib.rs` | Add `commands::packs::packs_list`, `commands::packs::packs_install`, `commands::packs::packs_install_default` to `generate_handler!` |
| `src-tauri/tauri.conf.json` | Add `"workspace-packs/packs/**/*"` and `"workspace-packs/pack-docs/**/*"` to `bundle.resources` |
| `src/lib/tauri-api.ts` | Add `PackMeta`, `PackInstallResult` interfaces; `listPacks()`, `installPack()`, `installPackDefault()` functions |
| `src/lib/tauri-api-interface.ts` | Add `listPacks`, `installPack`, `installPackDefault` to `TauriAPI` interface and implementation |
| `src/pages/Home.tsx` | Rewrite: widen container, remove USE_CASE_EXAMPLES + image imports, add packs section with search + 2-col grid |

---

## Out of Scope

- Adding new pack content for the 3 stub packs (data-visualization, finance-analysis, bio-informatics)
- Pack update/sync mechanism (one-time copy only, same as Tandem)
- Remote pack registry
- User-created packs
