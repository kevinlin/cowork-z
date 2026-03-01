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
   "resources/packs/**/*"
   "resources/pack-docs/**/*"
   ```
   `src-tauri/resources/packs` and `src-tauri/resources/pack-docs` are **direct copies** of `workspace-packs/packs` and `workspace-packs/pack-docs` from the repo root, checked into git. Both locations contain the same content; `workspace-packs/` is the authoring directory and the copies under `src-tauri/resources/` are what Tauri bundles. This avoids cross-platform symlink issues (git symlinks are stored as plain text files on Windows and do not resolve as directories). `resolve_pack_sources()` looks for packs at `<resource_dir>/resources/packs` — a single deterministic path for both dev and prod.

3. **Frontend** — `tauri-api.ts` and `tauri-api-interface.ts` gain `PackMeta`, `PackInstallResult`, `listPacks()`, `installPack()`, `installPackDefault()`. `Home.tsx` uses a tabbed layout (`packs` | `skills`). The packs tab renders `StarterPacks` (`src/components/landing/StarterPacks.tsx`), a self-contained component that owns its own state (catalog loading, search filtering, install flow, error display) — mirroring the `SkillsCatalog` component pattern. `Home.tsx` no longer contains packs-specific state or logic.

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
├── Tab bar (border-t)
│   ├── "Starter Packs" tab  → renders <StarterPacks />
│   └── "Skills Catalog" tab → renders <SkillsCatalog />
└── Tab content
    └── <StarterPacks /> (src/components/landing/StarterPacks.tsx)
        ├── Header row
        │   ├── Left: subtitle text
        │   └── Right: search input (filters by title/description/tags)
        └── ScrollArea (max-h ~400px, overflow-y-auto)
            └── 2-column grid of pack cards
                Each card:
                ├── Title (bold)
                ├── Description (muted, 2 lines)
                ├── Complexity pill + time estimate
                ├── Tag pills (up to 4)
                └── Install button (right-aligned)
```

`StarterPacks` is a self-contained component (same pattern as `SkillsCatalog`) that owns all packs-specific state: catalog loading, search filtering, install flow with folder picker, workspace registration, and error display. `Home.tsx` only manages the tab selection and delegates entirely to these child components.

**Removed:** `USE_CASE_EXAMPLES` array, all use-case image imports, and inline packs state/logic from `Home.tsx`.

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
10. A success toast is shown via `sonner` (e.g. "Research Synthesis installed — Workspace created — edit the prompt below and press Enter to begin.").
11. Task input is seeded via `onPromptSeed`: `"Open \`START_HERE.md\` and follow it step-by-step."`. The task is **not** auto-started — the user stays on the Home page with the prompt pre-filled and can review or edit before submitting.

---

### Post-Install State

- The installed pack folder becomes a registered cowork-z workspace.
- A success toast confirms installation with the pack title and a hint to press Enter.
- The task input bar is pre-filled with the `START_HERE.md` prompt but the task is **not** auto-started.
- The user stays on the Home page and can review, edit, or submit the seeded prompt at their discretion.

---

### Error Handling

| Scenario | Behavior |
|----------|----------|
| User cancels folder picker | `null` returned, no-op, `installingId` cleared |
| Rust install fails (missing source dir, IO error) | Error string shown in pack card error state; `installingId` cleared |
| `addWorkspace` fails | Toast error shown; pack files are already copied — user can manually add the folder |

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/commands/packs.rs` | **New** — port of Tandem's packs module (PackMeta, PackInstallResult, list_packs, install_pack, install_pack_default, resolve_pack_sources, copy_dir_recursive, choose_destination_dir, default_pack_root) |
| `src-tauri/src/commands/mod.rs` | Add `pub mod packs;` |
| `src-tauri/src/lib.rs` | Add `commands::packs::packs_list`, `commands::packs::packs_install`, `commands::packs::packs_install_default` to `generate_handler!` |
| `src-tauri/resources/packs/` | **Copied directory** from `workspace-packs/packs/` (tracked in git; Tauri bundles via `resources/packs/**/*`) |
| `src-tauri/resources/pack-docs/` | **Copied directory** from `workspace-packs/pack-docs/` (tracked in git; Tauri bundles via `resources/pack-docs/**/*`) |
| `src-tauri/tauri.conf.json` | Add `"resources/packs/**/*"` and `"resources/pack-docs/**/*"` to `bundle.resources` |
| `src/lib/tauri-api.ts` | Add `PackMeta`, `PackInstallResult` interfaces; `listPacks()`, `installPack()`, `installPackDefault()` functions |
| `src/lib/tauri-api-interface.ts` | Add `listPacks`, `installPack`, `installPackDefault` to `TauriAPI` interface and implementation |
| `src/components/landing/StarterPacks.tsx` | **New** — Self-contained packs catalog component (search, grid, install flow, success toast via `sonner`, error display). Mirrors `SkillsCatalog` pattern. |
| `src/pages/Home.tsx` | Rewrite: widen container, remove USE_CASE_EXAMPLES + image imports, add tab bar (`packs` / `skills`), delegate to `<StarterPacks />` and `<SkillsCatalog />` |
| `src/App.tsx` | Add `<Toaster>` from `sonner` (theme-aware, bottom-right) for app-wide toast notifications |
| `package.json` | Add `sonner` dependency |

---

## Out of Scope

- Adding new pack content for the 3 stub packs (data-visualization, finance-analysis, bio-informatics)
- Pack update/sync mechanism (one-time copy only, same as Tandem)
- Remote pack registry
- User-created packs
