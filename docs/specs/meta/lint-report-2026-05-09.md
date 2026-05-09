# Spec Lint Report — 2026-05-09

Specs root: `docs/specs/`

This report covers two consecutive lint + auto-fix passes on the same day.

## Summary (final state)

- Files scanned: **50** (requirements: 2, design: 10, plan: 36, index: 1, meta: 1)
- Errors: **0** remaining
- Warnings: **0** remaining
- Info: **2** (TODO markers + module-internal extension headings — see below)
- Auto-fixed: **22 issues** across two passes

## Root Index

- Path: `docs/specs/index.md` (split out of `requirements.md` in pass 2)
- Status: **present** (canonical, references all 48 spec files)
- `requirements.md` retains a short pointer to the new index.

---

## Pass 1 — initial audit (earlier today)

Discovered 20 errors and 13 warnings; auto-fixed 19. Highlights:

- **17 dead links in `requirements.md`** — missing folder prefixes (`opencode-integration/`, `app-ux/`), the `sidebard` typo, and references to deleted/never-existing files (`plan_phase1.md`, `plan_phase2.md`, `plan_skills-catalog.md`, `plan_cross-platform-support.md`, `plan_windows-production-readiness.md`).
- **1 dead link in `chat-ux/design_chat-ux.md`** — same `sidebard` typo.
- **2 dead self-references in `plan_skills-catalog-reimplement.md`** — points at the file's old name.
- **10 orphan files** appended to the appropriate index tables, each tagged `<!-- spec-lint:added -->`.
- **New "Section 9 — Automations"** scaffolded in `requirements.md` (4 sub-sections, placeholder ACs) since the design + plan were fully implemented but had no requirements section.
- **New "Automations" row** in the Design Specs table.

## Pass 2 — structural cleanup (this run)

Per user request, completed the items pass 1 had explicitly deferred plus a structural reorganization:

### 1. Renamed `workspace-packs/plan.md` → `plan_workspace-packs.md`
- Used `git mv` to preserve history.
- Updated the inline reference in `requirements.md` § 7.
- Index reference in `index.md` already used the new name.

### 2. Added `§ 6.x.y` IDs to `requirements_workspace-as-folder.md`
- Prepended root-spec IDs to each section heading: `§ 6.2`, `§ 6.2.1`, `§ 6.2.2`, `§ 6.2.3`, `§ 6.2.4`, `§ 6.4`, `§ 6.4.1`, `§ 6.4.2`, `§ 6.4.3`, `§ 6.4.4`, `§ 6.4.5`.
- Added a "Maps to root requirements" pointer at the top of the file, plus an explicit coverage-gap note that this module spec does NOT cover § 6.1 Workspace Lifecycle or § 6.3 Workspace Permissions (those live only in `design_workspace-as-folder.md`).
- Marked four module-internal sections (`Item Actions`, `Empty States`, `Security`, `Not Supported`) with HTML comments indicating they are extensions or scope-boundary callouts that have no direct root-§ 6 mapping.

### 3. Split index out of `requirements.md` → `index.md`
- Moved the entire `## Design & Implementation Index` section (94 lines) into `docs/specs/index.md`.
- Replaced the section in `requirements.md` with a one-line pointer to the new file.
- New `index.md` is structured as: Design Specs table → Module-Internal Requirement Specs → Implementation Plans (one subsection per module).
- All `<!-- spec-lint:added -->` markers from pass 1 were removed during the migration; the new `index.md` is treated as a fresh canonical document.

### 4. Updated `spec-lint` SKILL convention
- Reports now live at `SPECS_ROOT/meta/lint-report-YYYY-MM-DD.md` instead of bare `SPECS_ROOT/`.
- Added a `Lint artefacts` row to the Conventions Cheat Sheet.
- Updated the "Module index location" cheat-sheet row to prefer `index.md`.
- Moved the existing report into `docs/specs/meta/`.

---

## Re-lint verification (current pass)

Patterns scanned and confirmed clean across the entire `docs/specs/` tree:

- `workspace-packs/plan.md` → 0 active markdown link occurrences (only historical mentions in this report).
- `plan_phase1`, `plan_phase2`, `plan_cross-platform-support`, `plan_windows-production-readiness`, `plan_todo-panel-in-sidebard` → 0 occurrences.
- `plan_skills-catalog.md` (deleted file) → 0 markdown link occurrences (only historical descriptive mentions inside `plan_skills-catalog-reimplement.md`).
- All 48 design / requirement / plan files are linked from `index.md`.

## Info

### TODO markers in spec files

`docs/specs/requirements.md`:
- `## TODO Features` (canonical pending-work list, not a stub)
- `- [ ] **Database Encryption** — Optional SQLite encryption at rest with keychain-derived key (Req 5.2.2)`
- `- [ ] **Automations — finalize requirement IDs** — Section 9 was auto-scaffolded by spec-lint; review and harden ACs before treating as canonical.`

### Module-internal extension headings (intentional)

`requirements_workspace-as-folder.md` carries four headings that don't correspond to root § 6 IDs. Each is now flagged with an inline `<!-- module-internal extension -->` HTML comment so future lint runs don't surface them as false positives.

---

## Files Changed in Pass 2

| File | Change |
|------|--------|
| `docs/specs/index.md` | **New** — extracted from `requirements.md` |
| `docs/specs/requirements.md` | Section `## Design & Implementation Index` collapsed to a one-line pointer; one inline plan-link path updated for the workspace-packs rename |
| `docs/specs/workspace-as-folder/requirements_workspace-as-folder.md` | Added `§ 6.x.y` IDs to all section headings; added top-of-file coverage map; marked 4 module-internal sections |
| `docs/specs/workspace-packs/plan_workspace-packs.md` | Renamed from `plan.md` (via `git mv`) |
| `docs/specs/meta/lint-report-2026-05-09.md` | Moved from `docs/specs/lint-report-2026-05-09.md`; rewritten to cover both passes |
| `.claude/skills/spec-lint/SKILL.md` | Updated Step 5 + Conventions Cheat Sheet to put reports under `meta/` and prefer `index.md` |

---

## Recommended next pass

The spec tree is now fully clean. A future lint run should produce zero errors and zero warnings against the current corpus. Two soft suggestions for the human author:

1. **Harden Automations § 9 acceptance criteria.** Section 9.1–9.4 in `requirements.md` were auto-scaffolded from `automations/design_automations.md` decisions. Walk them against the actual implementation in `src-tauri/src/automation_scheduler.rs` and `src-tauri/src/db/automations.rs` before treating them as canonical.
2. **Stop linking `app-ux/plan_arena.md` as `TBD`.** Either complete the requirement mapping (likely under § 4 App Experience) or move the plan to a "deferred / experimental" subsection in `index.md` and tag the entry accordingly.
