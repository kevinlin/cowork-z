# Skills Catalog Re-implementation — Curated Repo Browser

> **Requirements:** [`requirements.md` §8.1–8.2](../requirements.md)
> **Design:** [`design_skills-catalog.md`](design_skills-catalog.md)

## Context

**Previously:** the Home tab "Skills Catalog" listed every individual skill bundled under `src-tauri/resources/skill-templates/` (71 folders) with per-skill Install / Re-install buttons. Skills were bundled into the app binary via `tauri.conf.json` `bundle.resources`, sync'd from upstream by `scripts/sync-skills.mjs`, and surfaced through `skills_list_with_status` / `skills_install` in [`src-tauri/src/commands/skills.rs`](../../../src-tauri/src/commands/skills.rs).

**Why change:** bundled-template installs were a parallel install path to the Skills Manager (which clones Git repos and installs via symlink). Maintaining two install models doubled the surface area, bloated the binary, and forced a manual `sync-skills.mjs` ritual to stay current. The Skills Manager already does discovery, install, sync, and update — so the Home Catalog is best repurposed as a curated *discovery* surface that points users at it.

**Outcome:** the Home tab "Skills Catalog" presents a hand-picked list of Git skill repositories. Clicking a card opens the Skills Manager and auto-adds (or selects) that repo, then filters the toolbar dropdown to it. Bundled templates and the entire `skills_install` code path are removed.

## Design

The full design — curated catalog shape, UI, click-to-Skills-Manager handoff, store changes, the 16-entry initial catalog table, and the error-handling matrix — lives in [`design_skills-catalog.md`](design_skills-catalog.md), which is the single source of truth going forward.

## Cleanup of the Old Implementation

One-time historical record of what this plan removed. Future readers needing to know "did we ever have a bundled-template install path?" land here.

| Path | Change |
|---|---|
| `src-tauri/resources/skill-templates/` | Deleted (71 bundled skill folders) |
| `scripts/sync-skills.mjs` | Deleted (bundled-skill sync script) |
| `src-tauri/tauri.conf.json` | Removed `"resources/skill-templates/**/*"` from `bundle.resources` |
| [`src-tauri/src/commands/skills.rs`](../../../src-tauri/src/commands/skills.rs) | Removed `resolve_templates_dir`, `install_skill`, `skills_install`, `skills_get_template_path`, the bundled-template fallback in `skills_get_skill_file_path`, and the corresponding `#[cfg(test)]` block. `list_skills_with_status` now scans only `~/.config/opencode/skills/`. |
| [`src-tauri/src/lib.rs`](../../../src-tauri/src/lib.rs) | Unregistered `skills_install` and `skills_get_template_path` from `invoke_handler!` |
| [`src/lib/tauri-api.ts`](../../../src/lib/tauri-api.ts), [`src/lib/tauri-api-interface.ts`](../../../src/lib/tauri-api-interface.ts) | Removed `installSkill` and `getSkillTemplatePath` from the frontend bridge |

The Rust helpers `derive_category`, `parse_frontmatter`, `compute_dir_checksum`, `copy_dir_recursive`, and `opencode_skills_dir` were intentionally retained (still used by `skill_repos.rs` and `skill_discovery.rs`).

## Implementation Plan

Implementation order: cleanup first (delete dead code), then build the new surface, then re-test.

### Task 1 — Backend cleanup

Removed the bundled-template surface area from the Rust crate and refactored `list_skills_with_status` to scan only `~/.config/opencode/skills/` (the existing custom-skill loop), dropping the bundled-template enumeration pass. Unregistered the two removed commands from `lib.rs`'s `invoke_handler!` and dropped the bundled directory and `sync-skills.mjs` from the build.

### Task 2 — Frontend API cleanup

Removed `installSkill` and `getSkillTemplatePath` from the `tauri-api.ts` bridge and the `TauriAPI` interface so the frontend can no longer reach the deleted Rust commands.

### Task 3 — Skills Manager store: `addRepo` + pending-focus consumption

Centralised repo-add logic in `skillsManagerStore.ts` so the Skills Catalog handoff and the existing AddRepoDialog share a single code path. The new `addRepo({ url, branch?, authToken? })` action wraps `skillReposAdd`, awaits `refreshAll`, and returns the new repo. Added `prefillAddRepoUrl` and `addRepoDialogOpen` state to the store so `AddRepoDialog` can be opened from outside `RepoToolbar` — the cross-window handoff (Task 4) needs this when an auto-clone fails.

### Task 4 — Window helper + cross-window handoff

Built the cross-window protocol that lets the Skills Catalog (main window) hand off a repo URL to the Skills Manager (its own window). `openSkillsManagerForRepo` writes the URL to a `localStorage` key (`skills:pendingFocusRepo`) and opens (or focuses) the Skills Manager window. `SkillsManagerPage` consumes the key both on mount *and* via `storage` event listeners, so the flow works whether the window was already open or had to be launched. On match it calls `setSelectedRepoId`; on miss it calls the new `addRepo` action; on clone failure it surfaces an error toast and opens `AddRepoDialog` prefilled with the URL so the user can supply an auth token for private repos.

### Task 5 — Rewrite `SkillsCatalog.tsx` + tests

Replaced the bundled-skill catalog UI with a curated Git-repo browser. The catalog source is a static `CURATED_SKILL_REPOS` constant in `src/components/landing/curatedSkillRepos.ts`. Multi-category packs render multiple pill badges via the existing `CATEGORY_COLORS` map; the category filter uses `Array.includes` so a pack appears under each of its categories. Each card has a single Open action that calls `openSkillsManagerForRepo`. Test suite rewritten to assert the curated UI behaviour (filter, search, badge rendering, click handoff) instead of the per-skill install flow.

### Task 6 — Docs + UPDATE_LOG

Rewrote `design_skills-catalog.md`, replaced the old `plan_skills-catalog.md` with this file (`plan_skills-catalog-reimplement.md`), and appended a v0.7.7 entry to `UPDATE_LOG.md`.

### Task 7 — Final verification

End-to-end manual test of the full handoff flow: clicking a card whose repo is not yet added clones it and selects it; clicking again on the same card just selects the existing repo; clicking a card with a private/invalid URL opens AddRepoDialog prefilled with the URL; slash-command autocomplete still resolves installed skills (regression check on `skillsStore.ts`).

## Critical Files — Summary

| File | Role |
|---|---|
| [`src/components/landing/curatedSkillRepos.ts`](../../../src/components/landing/curatedSkillRepos.ts) | Static curated list — the catalog source of truth |
| [`src/components/landing/SkillsCatalog.tsx`](../../../src/components/landing/SkillsCatalog.tsx) | Curated-card UI on the Home tab |
| [`src/lib/skills-window.ts`](../../../src/lib/skills-window.ts) | Cross-window handoff: `openSkillsManagerForRepo`, `readAndClearPendingFocusRepo`, `PENDING_FOCUS_REPO_KEY` |
| [`src/pages/SkillsManager.tsx`](../../../src/pages/SkillsManager.tsx) | On-mount + `storage`-event consumption of the pending-focus key |
| [`src/stores/skillsManagerStore.ts`](../../../src/stores/skillsManagerStore.ts) | `addRepo` action plus `prefillAddRepoUrl` / `addRepoDialogOpen` state used by the handoff |
| [`src/components/skills-manager/AddRepoDialog.tsx`](../../../src/components/skills-manager/AddRepoDialog.tsx) | Reads the prefill state; driven by store-level open/close so the cross-window flow can trigger it |
| [`src/components/skills-manager/RepoToolbar.tsx`](../../../src/components/skills-manager/RepoToolbar.tsx) | Opens AddRepoDialog via the store flag |
| [`src-tauri/src/commands/skills.rs`](../../../src-tauri/src/commands/skills.rs) | `list_skills_with_status` now scans only `~/.config/opencode/skills/`; bundled-template surface removed |

## Confirmed Design Choices

1. **On-click flow:** auto-clone silently. Skills Manager opens, `skill_repos_add(url)` runs in the background, dropdown selects on success. On clone failure (private / network), fall back to `AddRepoDialog` prefilled with the URL.
2. **Catalog scope:** 16 curated skill repos (full table in [`design_skills-catalog.md`](design_skills-catalog.md#curated-catalog--initial-entries)). Skips awesome-lists, the security scanner, and the MCP server — they aren't standard SKILL.md repos.
3. **Catalog source:** static TypeScript constant in `src/components/landing/curatedSkillRepos.ts`. No remote fetch; updates ship with app releases.
4. **Categories:** drawn from a closed taxonomy (Marketing, Sales, Finance, Legal, Product, Support, Data, Design, Document, Productivity, Enterprise, General) — re-uses the existing `CATEGORY_COLORS` map. No company names. Each pack carries 1–3 categories, derived from its README.
5. **Summaries:** authored from each repo's README, not invented.

## Changelog

- 2026-05-10 — **Compacted post-implementation.** Folded the embedded "Design — `design_skills-catalog.md` (rewritten)" section into a one-line pointer to the sibling [`design_skills-catalog.md`](design_skills-catalog.md), since the sibling is now the canonical home for the curated catalog shape, UI, store changes, initial-entries table, and error-handling matrix. Hoisted "Cleanup of the Old Implementation" out of that wrapper into its own top-level section as a `path | change` table. Thinned the seven-task `## Implementation Plan` to one paragraph per task — kept each task heading and intent, dropped code snippets, `Files:` / `Steps:` / `Verify:` lines, and per-test-case-name lists. Trimmed `Critical Files — Summary` from 18 rows to 8 forward-looking ones (dropped one-time config edits, the deleted bundled directory, `sync-skills.mjs`, and the docs/spec rewrites this plan did during its own run). Tightened Context to past tense. Preserved `## Confirmed Design Choices` verbatim. Original plan is recoverable via git history.
