# Spec Lint Report — 2026-05-10

Specs root: `docs/specs/`

This report covers two consecutive passes on the same day:

- **Pass 1** — initial run after the spec-lint skill was updated to (a) seed `<SPECS_ROOT>/meta/convention.md`, and (b) consult that local copy as the project's source of truth for naming rules. Surfaced 2 warns and several carried-forward info markers.
- **Pass 2** — fix-up pass per user request: hardened § 9 acceptance criteria, reverse-engineered § 4.6 Arena from the implementation plan, and renamed the two underscore-in-topic plans.

## Summary (final state, post Pass 2)

- Files scanned: **52** (requirements: 2, design: 10, plan: 36, index: 1, meta: 3 — `convention.md` + two dated lint reports)
- Errors: **0**
- Warnings: **0** ← was 2 before Pass 2 (both renames complete)
- Info: **1** (convention seeded — a one-time event)
- Auto-fixed: **0** (Pass 2 changes are user-directed authoring, not lint auto-fixes)

## Convention Reference

- Path: `docs/specs/meta/convention.md`
- Status: **present** (in-sync with the skill's bundled `references/convention.md`)
- The local copy is the per-project source of truth. Edit it freely to add project-specific artifact types or anti-patterns; future spec-lint runs will flag drift from the bundled skill copy as `info`.

## Root Index

- Path: `docs/specs/index.md`
- Status: **present**
- All 48 spec files (2 requirements + 10 design + 36 plan) have at least one inbound link from `index.md` (whether via a table row or the introductory paragraph linking to `requirements.md`).
- All markdown links in `index.md` resolve.

---

## Pass 1 — initial audit (earlier today)

### Errors
_None._

### Warnings
- **Naming — legacy underscore-in-topic** (2): `app-ux/plan_about_panel.md` and `chat-ux/plan_chat_ui_rewrite.md`. The May 9 pass had silently dismissed these (the old skill conflated underscore-in-topic with "typos for human confirmation"). The new `convention.md` § 5 anti-pattern table cites the rule explicitly.

### Info
- Convention reference seeded into `docs/specs/meta/convention.md` for the first time.
- 4 `(TBD)` headings in `requirements.md` § 9 (Automation Definition / Scheduler / Run Triage / Lifecycle & Persistence).
- 1 carry-forward soft suggestion: `index.md:86` listed Arena as `TBD`.

---

## Pass 2 — structural cleanup (this run)

Per user request, Pass 2 closed the three outstanding items the May 9 report and the Pass 1 results had flagged.

### 1. Hardened `requirements.md` § 9.1–9.4 against the actual implementation

Replaced the four `(TBD)` placeholder sub-sections with concrete, traceable acceptance criteria sourced from `automations/design_automations.md` and cross-checked against the live Rust implementation in `src-tauri/src/{commands,db,automation_scheduler,automation_dispatch}.rs`. Highlights:

- § 9.1 expanded from 3 ACs to **7**, covering the structured schedule picker, Custom mode, real-time `validate_cron` Tauri command (debounced 400ms), required model selection, and `/skill-name` support.
- § 9.2 expanded from 3 ACs to **9**, covering the `AutomationSchedulerRegistry` per-thread design, local-timezone cron evaluation with UTC storage, the 5→6 field cron normalization (`"0 "` prepend), `get_automation_next_runs` (backend-computed, no client-side cron), the cancel-on-change protocol, `is_running` CAS-based concurrency, and `run_automation_now` bypass.
- § 9.3 expanded from 3 ACs to **8**, covering the sidebar tab placement (between Sessions and Files), the `has_findings` heuristic against "no findings" phrases, filter chips, the unread badge sourced from `get_automation_unread_count`, and the `automation:run_*` event-driven sidebar refresh.
- § 9.4 expanded from 3 ACs to **7**, covering the `try_complete_run_if_running` idempotent completion, the macOS WebView throttling robustness via `SidecarManager::handle_sidecar_event`, the `DbState.conn` mutex drop-before-`process_pending_runs` deadlock prevention, cascade-delete on workspace removal, app-quit lifecycle, and the three Tauri events (`automation:run_started`, `automation:run_completed`, `automation:schedule_fired`).
- All four sub-section headings now carry `✅` (no more `(TBD)`); the `<!-- spec-lint:added — scaffolded 2026-05-09 -->` HTML comment was removed since § 9 is now canonical.
- The "**Automations — finalize requirement IDs**" entry was removed from `## TODO Features` at the bottom of `requirements.md`.

### 2. Reverse-engineered § 4.6 Arena from `app-ux/plan_arena.md`

Inserted a new `#### 4.6 Arena — Side-by-Side Agent Comparison ✅` requirement between the existing § 4.5 User Feedback and the § 5 Platform & Security divider. Distilled the 554-line plan into **7 sub-sections, 32 acceptance criteria** organized by capability:

| Sub-section | ACs | Coverage |
|---|---|---|
| 4.6.1 Arena Entry Point | 3 | Top-right Home button, tooltip, `/arena/new` route |
| 4.6.2 Arena Configuration | 3 | Per-column model picker dialog, exactly-3 selection, full provider-qualified IDs |
| 4.6.3 Arena Execution | 6 | `arenas` table + 3 `tasks`, prompt folder-isolation prefix, `skip_config` flag, `arena_id` cleanup-skip, optional `model_id` override on `TaskConfig` |
| 4.6.4 Arena UI | 8 | Tabbed layout, `MessageBubble` reuse for full-fidelity rendering, streaming, bash filter, permission/question modals, "Stop All" |
| 4.6.5 Arena Input Bar — File References | 3 | "Add to Chat" event, drag-drop (OS + intra-app), drag-hover ring |
| 4.6.6 Arena Sidebar Integration | 6 | Chronological interleave, `arena_id IS NULL` filter on Sessions, `Columns3` icon, expandable disclosure triangle, click routing (row vs. triangle), immediate sidebar update on `start_arena` |
| 4.6.7 Arena Lifecycle & Persistence | 6 | `arenas` table + task column extensions, six Tauri commands, follow-up message persistence (`saveTaskMessage` / `saveTaskStatus` / `saveTaskSession` / `completeTask`), `resume_arena` with stored `model_id`, cascade-delete, sidebar delete |

`docs/specs/index.md` was updated to point the Arena row at requirement `4.6` instead of `TBD`. The May 9 carry-forward soft suggestion is now resolved.

### 3. Renamed the two underscore-in-topic plans

Used `git mv` to preserve history:

```bash
git mv docs/specs/app-ux/plan_about_panel.md       docs/specs/app-ux/plan_about-panel.md
git mv docs/specs/chat-ux/plan_chat_ui_rewrite.md  docs/specs/chat-ux/plan_chat-ui-rewrite.md
```

Updated all 8 inbound references:

| File | Refs updated |
|---|---|
| `docs/specs/index.md` | 2 (one per renamed plan) |
| `docs/specs/requirements.md` | 2 (one per renamed plan) |
| `docs/specs/app-ux/design_app-ux.md` | 1 (About Panel `**Plan:**` blockquote) |
| `docs/specs/chat-ux/design_chat-ux.md` | 3 (three `**Plan:**` blockquotes for Chat UI Rewrite) |

A repository-wide grep for the old filenames returns zero hits in source content (only the historical log entries in this report).

---

## Re-lint verification (post Pass 2)

Patterns scanned and confirmed clean across the entire `docs/specs/` tree:

- `plan_about_panel`, `plan_chat_ui_rewrite` → 0 active markdown link occurrences (only historical mentions in this report).
- `(TBD)` → 0 occurrences in `requirements.md` § 9 sub-section headings.
- `Arena — Side-by-Side Agent Comparison | … | TBD` → 0 occurrences in `index.md` (now reads `… | 4.6 |`).
- All 49 design / requirement / plan files remain linked from `index.md`.
- All 8 updated inbound references resolve to the renamed plan files.

The remaining `TBD` / `TODO` token mentions across the tree are all descriptive references inside plan/design prose (e.g., "Update Outstanding Feature TODO list" as a step in a plan) — none are live placeholders for missing content.

---

## Files Changed in Pass 2

| File | Change |
|---|---|
| `docs/specs/requirements.md` | § 9.1–9.4 hardened (3 → 31 ACs total); § 4.6 Arena added (32 new ACs); 1 entry removed from `## TODO Features`; 2 plan-link path updates for renames |
| `docs/specs/index.md` | Arena row Requirements column: `TBD` → `4.6`; 2 plan-link path updates for renames |
| `docs/specs/app-ux/plan_about_panel.md` → `plan_about-panel.md` | Renamed via `git mv` (preserves history) |
| `docs/specs/chat-ux/plan_chat_ui_rewrite.md` → `plan_chat-ui-rewrite.md` | Renamed via `git mv` (preserves history) |
| `docs/specs/app-ux/design_app-ux.md` | 1 plan-link path update |
| `docs/specs/chat-ux/design_chat-ux.md` | 3 plan-link path updates |
| `docs/specs/meta/lint-report-2026-05-10.md` | Rewritten to cover both passes |

---

## Recommended next pass

The spec tree is now fully clean by the new convention. A future `spec-lint` run should produce **0 errors, 0 warnings, 0 info markers** (the convention-seeded info is a one-time event). Two soft suggestions for the human author:

1. **Run reverse-consistency on the new § 4.6 ACs.** The Arena requirement is reverse-engineered from `plan_arena.md` rather than derived from a top-down user requirement — it accurately describes what the implementation does, but you may want to walk through it once and cull any ACs that document a quirk rather than an intent (notably 4.6.7.3 "follow-up message persistence" and 4.6.7.4 "resume with stored model_id" originated as bug fixes during implementation; they are now correct behavior but read more like implementation notes than user-facing requirements).
2. **Consider hoisting the "validate_cron" Tauri command to the design doc's IPC table.** It is documented in the design under "Cron validation" prose but is not in the IPC table at the top of `automations/design_automations.md`. The new § 9.1.5 references it explicitly, so the design doc IPC table now under-represents the implementation.
