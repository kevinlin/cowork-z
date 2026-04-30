# Automations — Design Spec

> Scheduled, recurring AI tasks that run unattended and surface findings to the user.

Modeled after [Codex App Automations](https://developers.openai.com/codex/app/automations), adapted to Cowork-Z's architecture (Tauri + OpenCode sidecar).

## Overview

Automations let users define recurring tasks that execute on a schedule. Each automation is bound to a workspace, uses an explicit model selection, and runs through the existing task pipeline. Results with findings surface in a dedicated sidebar triage tab; empty runs are auto-archived.

## Decisions

| Decision | Choice |
|----------|--------|
| Scope | Standalone automations only (thread automations as future work) |
| Entry point | Home page "Automations" tab (third tab after Starter Packs, Skills Catalog) |
| Triage location | Sidebar "Automations" tab (between Sessions and Files) |
| Scheduling | Presets + natural language, parsed to cron internally |
| Scheduler location | Rust backend (Tauri side) |
| Workspace binding | 1:1 (one automation = one workspace) |
| Skills support | `/skill-name` in prompt text (same as regular tasks) |
| Run filtering | Smart — only runs with findings appear in triage; empty runs auto-archived |
| Model selection | Required explicit selection per automation |
| Architecture | Thin Scheduler + Existing Task Pipeline (reuse sidecar, sequential execution) |
| Automation runs in Sessions tab | Excluded — automation runs only appear under the Automations sidebar tab |

## Data Model

### `automations` table

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PK | UUID |
| `workspace_id` | TEXT FK | Bound workspace |
| `name` | TEXT | User-given name (e.g., "Daily code review") |
| `prompt` | TEXT | The task prompt (may include `/skill-name`) |
| `schedule_cron` | TEXT | Standard 5-field Unix cron (e.g., `0 9 * * *`); scheduler normalizes to 6-field internally |
| `schedule_display` | TEXT | Human-readable schedule ("every weekday at 9am") |
| `provider_id` | TEXT | Provider key (e.g., `github-copilot`) — used for display/filtering |
| `model_id` | TEXT | Full provider-qualified model ID (e.g., `github-copilot/claude-sonnet-4.6`) — passed directly to sidecar |
| `enabled` | BOOLEAN | Whether the scheduler should fire this automation |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

### `automation_runs` table

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PK | UUID |
| `automation_id` | TEXT FK | Parent automation |
| `task_id` | TEXT FK | References the task created for this run |
| `status` | TEXT | `pending` / `running` / `completed` / `failed` / `cancelled` |
| `has_findings` | BOOLEAN | Whether the run produced actionable output |
| `is_read` | BOOLEAN | For triage — has the user seen this? |
| `started_at` | DATETIME | |
| `completed_at` | DATETIME | |

### Existing table changes

The `tasks` table gains an optional `automation_run_id` column (nullable FK) to correlate automation-triggered tasks. The Sessions sidebar tab filters out tasks where `automation_run_id IS NOT NULL`.

## Scheduler Design

### `AutomationScheduler` (Rust)

A long-lived struct spawned at app startup:

- Loads all enabled automations from SQLite on init
- Maintains an in-memory priority queue ordered by next-fire-time
- Tick loop runs every 30 seconds checking if any automation is due
- On fire: creates an `automation_run` record, then calls the existing `start_task` flow
- Sequential execution (v1): if a task is already active, the run is queued as `pending`

### Concurrency model (v1)

```
[Scheduler tick] → Is anything due? → Is sidecar idle?
  → Yes/Yes: start the run immediately
  → Yes/No:  enqueue as pending, retry on next tick
  → No:      sleep until next tick
```

When a task completes, the scheduler checks for pending automation runs and starts the next one (FIFO).

### Lifecycle events

- Automation created/updated/deleted → scheduler reloads its queue
- Task complete → scheduler checks pending runs
- App quit → persists pending run states, resumes on next launch

### Determining `has_findings`

When a run completes, inspect the final task output. Heuristic: if the task produced assistant messages beyond a simple "nothing to report" acknowledgment, mark `has_findings = true`. The prompt can also instruct the agent to explicitly signal "no findings" (convention-based).

### Schedule parsing

The frontend provides preset schedule options (Hourly, Daily, Weekly) that map to standard 5-field Unix cron expressions (e.g., `0 9 * * *`). A "Custom" option allows direct cron input.

**Cron normalization:** The Rust `cron` crate (v0.12) requires 6-7 field expressions (`sec min hour dom month dow [year]`). The scheduler's `normalize_cron()` method automatically prepends `"0 "` (seconds = 0) to 5-field expressions before parsing. This allows the frontend and DB to store standard Unix cron while the scheduler handles the conversion internally.

**Model ID format:** The `model_id` field stores the full provider-qualified identifier (e.g., `github-copilot/claude-sonnet-4.6`). The `provider_id` field stores just the provider key (e.g., `github-copilot`) for filtering/display purposes. When dispatching to the sidecar, `model_id` is used directly without additional prefixing.

## IPC & Sidecar Integration

### New Tauri commands

| Command | Description |
|---------|-------------|
| `create_automation` | Validates + stores automation, notifies scheduler |
| `update_automation` | Updates fields, re-syncs scheduler queue |
| `delete_automation` | Removes automation + orphaned runs, notifies scheduler |
| `list_automations` | Returns automations for a workspace (or all) |
| `get_automation` | Single automation with recent run history |
| `list_automation_runs` | Filtered runs (by automation, by has_findings, by read state) |
| `mark_run_read` | Marks a triage item as read |
| `toggle_automation_enabled` | Quick enable/disable without full update |
| `run_automation_now` | Manual trigger — directly dispatches task to sidecar (bypasses scheduler queue) |

### Sidecar changes

None. The sidecar receives automation runs as standard `start_task` commands. It doesn't need awareness of the automation system.

### New Tauri events

| Event | Payload | Purpose |
|-------|---------|---------|
| `automation:run_started` | `{ automation_id, run_id, task_id }` | Update sidebar triage |
| `automation:run_completed` | `{ run_id, has_findings, status }` | Surface in triage if findings |
| `automation:schedule_fired` | `{ automation_id, next_run_at }` | Optional — for UI status |

## Frontend Design

### Home Page — Automations Tab

- Third tab in the Home page card (after "Starter Packs" and "Skills Catalog")
- `HomeTab` type becomes `'packs' | 'skills' | 'automations'`
- Content: list view of automation cards

**List view (automation cards):**
- Each card shows: name, schedule (human-readable), status (Active/Disabled), last run time
- Action menu per card: Edit, Run Now, Disable/Enable, Delete
- "+ New" button at the top-right of the list
- Empty state when no automations exist (with "Create your first automation" CTA)

**Inline creation/edit form:**
- Replaces the list view when creating or editing
- Fields: Name, Prompt (textarea, supports `/skill-name`), Schedule (preset chips: Hourly/Daily/Weekly/Custom + natural language text input), Model (provider + model dropdown, populated from `getProviderSettings` — same source as the main task model selector)
- Buttons: Cancel (returns to list), Create/Save
- Validation: all fields required, schedule must parse successfully, selected model must still be configured

### Sidebar — Automations Tab

- New tab between "Sessions" and "Files" in `Sidebar.tsx`
- Icon + "Automations" label with unread badge (red dot when findings exist)
- `SidebarTab` type becomes `'sessions' | 'automations' | 'files'`

**Tab content:**
- Filter chips: "Unread" (default when unread items exist) / "All"
- "Mark all read" action in the filter row
- Run items: automation name, finding summary, relative timestamp, model + schedule metadata
- Unread runs: amber left-border accent
- Read/no-findings runs: dimmed appearance
- Clicking a run → navigates to `/execution/:taskId`

**Filtering from Sessions:**
- The Sessions tab query excludes tasks where `automation_run_id IS NOT NULL`
- Automation runs are ONLY viewable under the Automations tab

### New components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AutomationsList` | `src/components/landing/` | Home tab list view |
| `AutomationForm` | `src/components/landing/` | Inline create/edit form |
| `AutomationCard` | `src/components/landing/` | Individual automation card |
| `AutomationRunsPanel` | `src/components/sidebar/` | Sidebar tab content |
| `AutomationRunItem` | `src/components/sidebar/` | Individual run item in triage |

### New store

`automationStore.ts` (Zustand) managing:
- Automation list (for Home tab)
- Automation runs (for sidebar triage)
- Unread count (drives badge)
- CRUD operations (wrapping Tauri commands)
- Event listeners for `automation:run_started`, `automation:run_completed`

## User Flows

### Creating an automation
1. Home → Automations tab → "+ New" → inline form
2. Fill name, prompt, schedule, model → "Create"
3. Saved to SQLite, scheduler picks up immediately
4. List view returns with new automation as "Active"

### Scheduled run executes
1. Scheduler tick → automation due → sidecar idle → start run
2. Task completes → `has_findings` evaluated
3. Findings: sidebar badge appears, run in triage
4. No findings: run archived (viewable under "All" filter)

### Reviewing a run (triage)
1. Red dot on Automations sidebar tab → switch to tab
2. Unread runs with amber accent → click run
3. Navigate to task view → full agent output visible
4. Return to sidebar → run marked read

### Managing automations
- **Edit:** Home tab → click card → form pre-filled
- **Disable/Enable:** Toggle on card (pauses scheduling)
- **Delete:** Action menu → confirmation → removes automation + runs
- **Run Now:** Action menu → immediate trigger (bypasses schedule)

### Sidecar busy
1. Automation fires, manual task active → run queued as `pending`
2. Manual task completes → scheduler picks up pending run
3. Multiple pending → sequential FIFO execution

### "Run Now" execution
"Run Now" directly dispatches the task to the sidecar — it does **not** enter the scheduler's pending queue. It creates a task record, an automation run linked to that task, resolves workspace permissions and API keys, then sends `StartTask` to the sidecar immediately. This mirrors the behavior of a user-initiated task from the Home page, using the automation's configured model and workspace context.

### Workspace context
- The Home tab Automations list is filtered to the currently active workspace
- Deleting a workspace cascades: associated automations and their runs are deleted
- Switching workspace updates both the Home tab list and the sidebar triage view

## Scope Boundaries

### In scope (v1)
- Automation CRUD on Home tab (inline form)
- List view with status, schedule, enable/disable, "Run Now"
- Preset schedule chips + natural language input → cron
- Required explicit model selection
- Cron-based scheduler in Rust (sequential, one-at-a-time)
- Automation runs as tasks (full sidecar pipeline reuse)
- Sidebar "Automations" tab with triage filtering
- `has_findings` heuristic
- Runs excluded from Sessions tab
- 1:1 workspace binding
- Skills via `/skill-name` in prompt

### Out of scope (future)
- Thread automations (heartbeat within a conversation)
- Multi-workspace automations
- Concurrent/parallel automation runs
- Worktree isolation for Git repos
- Agent-created automations (AI sets up automation from chat)
- Webhooks / external triggers (GitHub events, etc.)
- Automation templates / sharing
- Per-automation sandbox/permission overrides
