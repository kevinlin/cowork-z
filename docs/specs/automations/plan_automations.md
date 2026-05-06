# Automations Implementation Plan

**Goal:** Add scheduled, recurring AI tasks (Automations) with a Home tab for CRUD, a sidebar tab for triage, and a Rust-based cron scheduler that fires tasks through the existing sidecar pipeline.

**Architecture:** Rust scheduler (per-automation thread registry with condvar-based sleep/cancel) triggers tasks via the existing `start_task` command flow. New SQLite tables store automation definitions and run history. Frontend adds a third Home tab and a third sidebar tab. Sequential execution — one run at a time, queued when sidecar is busy.

**Tech Stack:** Rust (Tauri commands, `cron` crate, `rusqlite`), TypeScript/React (Zustand store, new components), existing sidecar IPC unchanged.

---

## File Structure

### Rust (backend)

| File | Responsibility |
|------|----------------|
| `src-tauri/src/db/automations.rs` | CRUD for `automations` and `automation_runs` tables |
| `src-tauri/src/db/migrations.rs` | Migration v7: new tables + `tasks.automation_run_id` column |
| `src-tauri/src/commands/automations.rs` | Tauri command handlers for automation CRUD + run management |
| `src-tauri/src/automation_scheduler.rs` | Per-automation thread registry: spawns/cancels threads, maintains `next_runs` map |
| `src-tauri/src/automation_dispatch.rs` | Shared dispatch logic for firing automations (used by scheduler + `run_automation_now`) |
| `src-tauri/src/commands/mod.rs` | Register `automations` module |
| `src-tauri/src/lib.rs` | Register commands, spawn scheduler at startup |
| `src-tauri/Cargo.toml` | Add `cron` dependency |

### TypeScript (frontend)

| File | Responsibility |
|------|----------------|
| `src/shared/types/automation.ts` | TypeScript types for automations and runs |
| `src/stores/automationStore.ts` | Zustand store: automation list, runs, unread count, CRUD |
| `src/lib/tauri-api.ts` | New invoke wrappers + event listeners for automations |
| `src/lib/cron-utils.ts` | Cron helpers: `buildCron`, `buildDisplay`, frequency detection, time formatting |
| `src/components/landing/AutomationsList.tsx` | Home tab list view |
| `src/components/landing/AutomationCard.tsx` | Individual automation card |
| `src/components/landing/AutomationForm.tsx` | Inline create/edit form |
| `src/components/sidebar/AutomationRunsPanel.tsx` | Sidebar tab content |
| `src/components/sidebar/AutomationRunItem.tsx` | Individual run item |
| `src/pages/Home.tsx` | Add `'automations'` tab option |
| `src/components/layout/Sidebar.tsx` | Add `'automations'` tab between Sessions and Files |

---

## Task 1: Database Schema (Migration v7)

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/automations.rs`
- Modify: `src-tauri/src/db/mod.rs`

**Step 1: Add migration v7 to migrations.rs**

- In `src-tauri/src/db/migrations.rs`, bump `CURRENT_VERSION` to 7 and add the migration function:
- Add the migration function before `run_migrations`:

**Step 2: Register migration v7 in run_migrations**

Add to the `run_migrations` function, after the `stored_version < 6` block:

**Step 3: Create db/automations.rs**

Create `src-tauri/src/db/automations.rs`:

**Step 4: Register automations module in db/mod.rs**

Add `pub mod automations;` to `src-tauri/src/db/mod.rs`.

**Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

**Step 6: Commit**

---

## Task 2: Tauri Commands for Automations

**Files:**
- Create: `src-tauri/src/commands/automations.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create commands/automations.rs**

Create `src-tauri/src/commands/automations.rs`:

**Step 2: Register in commands/mod.rs**

Add `pub mod automations;` to `src-tauri/src/commands/mod.rs`.

**Step 3: Register commands in lib.rs invoke_handler**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` macro after the Skills block:

**Step 4: Verify compilation**

- Run: `cd src-tauri && cargo check`
Expected: compiles without errors

**Step 5: Commit**

---

## Task 3: Automation Scheduler (Rust)

**Files:**
- Create: `src-tauri/src/automation_scheduler.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add cron dependency to Cargo.toml**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

**Step 2: Create automation_scheduler.rs**

Create `src-tauri/src/automation_scheduler.rs`:

**Step 3: Register scheduler module and spawn at startup in lib.rs**

In `src-tauri/src/lib.rs`, add `mod automation_scheduler;` to the module declarations, and spawn the scheduler inside the `setup` closure (after sidecar state init):

**Step 4: Add is_busy method to SidecarState**

- In `src-tauri/src/sidecar.rs`, add a public method to `SidecarState`:
(Exact implementation depends on how `SidecarState` tracks active tasks — inspect the existing struct.)

**Step 5: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: compiles without errors

**Step 6: Commit**

---

## Task 4: Frontend Types and Tauri API

**Files:**
- Create: `src/shared/types/automation.ts`
- Modify: `src/shared/types/index.ts` (or wherever shared types are re-exported)
- Modify: `src/lib/tauri-api.ts`

**Step 1: Create shared types**

Create `src/shared/types/automation.ts`:

**Step 2: Export types from shared index**

Add to `src/shared/types/index.ts` (or the barrel file):

**Step 3: Add Tauri API functions**

Add to `src/lib/tauri-api.ts` in a new `// Automations` section:

**Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

**Step 5: Commit**

---

## Task 5: Automation Zustand Store

**Files:**
- Create: `src/stores/automationStore.ts`

**Step 1: Create automationStore.ts**

Create `src/stores/automationStore.ts`:

**Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

**Step 3: Commit**

---

## Task 6: Home Page — Automations Tab

**Files:**
- Create: `src/components/landing/AutomationsList.tsx`
- Create: `src/components/landing/AutomationCard.tsx`
- Create: `src/components/landing/AutomationForm.tsx`
- Modify: `src/pages/Home.tsx`

**Step 1: Create AutomationCard.tsx**

Create `src/components/landing/AutomationCard.tsx`.

The card displays the automation name, status badge, schedule display, and **next scheduled run time** (computed client-side from the cron expression using `getNextCronDate()`). For daily/hourly automations, only the time is shown (e.g., "9:00 AM"). For weekly automations, the weekday is prepended (e.g., "Monday 9:00 AM"). Disabled automations hide the next run time. The card also includes an inline toggle switch and a dropdown action menu (Run Now, Disable/Enable, Delete).

**Step 2: Create AutomationForm.tsx**

Create `src/components/landing/AutomationForm.tsx`.

**Schedule picker design:** The form uses a structured 3-dropdown row layout for schedule configuration:

1. **Frequency picker (Radix Select):** Hourly, Daily, Weekdays, Weekly, Custom. Controls which other pickers are visible.
2. **Weekday picker (Radix Select):** Monday–Sunday. Only shown when frequency is "Weekly".
3. **Time picker (custom scrollable dropdown):** 15-minute increments in 12-hour format (e.g., "09:00 AM"). Shows a clock icon. Hidden when frequency is "Hourly".

The grid layout adapts responsively:
- Hourly → 1 column (frequency only)
- Daily / Weekdays → 2 columns (frequency + time)
- Weekly → 3 columns (frequency + weekday + time)
- Custom → frequency dropdown + free-text cron input below

A **cron preview** is displayed below the pickers as read-only monospace text, showing the computed 5-field Unix cron expression (e.g., `0 9 * * 1`) for user verification.

Helper functions: `buildCron(frequency, time, weekday)` generates the cron expression; `buildDisplay(frequency, time, weekday)` generates human-readable text; `parseTimeTo24(time)` converts 12-hour to 24-hour for cron fields.

**Model selection approach:** Instead of a plain `<select>` dropdown, the form uses a button that displays the current model name and opens a **model picker dialog** (similar to `ArenaModelPickerDialog`). Key behaviors:

1. **Default to global model:** On mount (for new automations), reads `getActiveProvider(settings)` from `useProviderSettings()` to pre-populate `providerId`, `modelId`, and `modelDisplayName` with the globally configured provider/model.
2. **Button trigger:** A styled button shows the current model display name (or "Select model..." placeholder) with a `ChevronDown` icon. Clicking opens the picker dialog.
3. **Picker dialog (`AutomationModelPickerDialog`):** A local component that reuses `ProviderGrid` and `ProviderSettingsPanel` (same as `ArenaModelPickerDialog`) inside a `Dialog`. Title is "Select Model". On "Select Model" click, extracts `providerId` from the full model ID and calls back with `(fullModelId, displayName)`.
4. **Edit mode:** When editing an existing automation, resolves the display name from the stored `providerId`/`modelId` against `settings.connectedProviders`.

Dependencies: `useProviderSettings`, `ProviderGrid`, `ProviderSettingsPanel`, `Dialog` components, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` from `@/components/ui/select`, `getActiveProvider`, `isProviderReady` from `@/shared`, `AnimatePresence`/`motion` from framer-motion, `ChevronDown`/`Clock` from lucide-react.

**Step 3: Create AutomationsList.tsx**

Create `src/components/landing/AutomationsList.tsx`:

**Step 4: Add Automations tab to Home.tsx**

- In `src/pages/Home.tsx`, change the `HomeTab` type and add the tab button + content:
- Add the third tab button after the "Skills Catalog" button (inside the tab bar `<div>`):
- Change the tab content rendering:

**Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

**Step 6: Commit**

---

## Task 7: Sidebar — Automations Tab

**Files:**
- Create: `src/components/sidebar/AutomationRunItem.tsx`
- Create: `src/components/sidebar/AutomationRunsPanel.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Create AutomationRunItem.tsx**

Create `src/components/sidebar/AutomationRunItem.tsx`:

Single-row layout: `automationName | status (truncated) | timeAgo`. The status label sits between name and time with `truncate` so it ellipses when space is tight. See implementation note #10 above.

**Step 2: Create AutomationRunsPanel.tsx**

Create `src/components/sidebar/AutomationRunsPanel.tsx`:

**Step 3: Add Automations tab to Sidebar.tsx**

- In `src/components/layout/Sidebar.tsx`, Change the sidebar tab type (find where it's defined) to include `'automations'`:
- Add the Automations tab button between the Sessions and Files buttons at line ~195-216:
- Add the tab content panel (where the existing tab content is rendered):
- Get the unread count from the store at the top of the component:

**Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

**Step 5: Commit**

---

## Task 8: Filter Automation Runs from Sessions Tab

**Files:**
- Modify: `src/stores/taskStore.ts` (or wherever task list filtering happens)

**Step 1: Identify where tasks are listed for the Sessions tab**

The `taskStore` has a `tasks` array that populates the sidebar Sessions tab. When loading tasks, filter out any task that has an `automation_run_id` set.

In the `list_tasks` Tauri command (Rust side, `src-tauri/src/commands/tasks.rs`), add a WHERE clause:

```sql
WHERE automation_run_id IS NULL
```

Or, if filtering on the frontend side, add to the task list query in `src-tauri/src/db/tasks.rs` (the `list_tasks` function):

```rust
// Add to the WHERE clause of the list_tasks query
AND t.automation_run_id IS NULL
```

**Step 2: Verify that automation-triggered tasks don't appear in Sessions**

Run: `pnpm typecheck && cd src-tauri && cargo check`
Expected: both pass

**Step 3: Commit**

---

## Task 9: Integration Wiring & Event Listeners

**Files:**
- Modify: `src/lib/tauri-api-interface.ts` (add automation methods to the interface)
- Modify: `src/components/layout/Sidebar.tsx` (load unread count on workspace change)

**Step 1: Add automation methods to TauriAPI interface**

In `src/lib/tauri-api-interface.ts`, add the automation methods to the interface so that `getTauriAPI()` exposes them:

**Step 2: Wire up unread count loading on workspace change in Sidebar**

- In `Sidebar.tsx`, add an effect that loads the unread count when the active workspace changes:
- Also subscribe to automation events to refresh both the count and the runs list:

**Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: passes

**Step 4: Run formatter**

Run: `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/`
Expected: no errors

**Step 5: Commit**

---

## Task 10: Final Verification

**Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: passes with no errors

**Step 2: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: passes with no errors

**Step 3: Run formatter**

Run: `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/`
Expected: no formatting issues

**Step 4: Run frontend tests**

Run: `pnpm test --run`
Expected: existing tests pass (no regressions)

**Step 5: Commit any final fixes**

---

## Implementation Notes (Post-Implementation Corrections)

The following corrections were applied during implementation and differ from the original plan code:

1. **Cron format normalization:** The `cron` crate (v0.12) requires 6-7 field expressions (`sec min hour dom month dow [year]`). The frontend stores standard 5-field Unix cron (e.g., `0 9 * * *`). The scheduler's `normalize_cron()` prepends `"0 "` to 5-field expressions before parsing. All `Schedule::from_str` / `.parse::<Schedule>()` calls must use the normalized form.

2. **`run_automation_now` directly dispatches to sidecar:** The original plan had `run_automation_now` creating a pending run for the scheduler to pick up. This introduced a 30s delay and relied on the scheduler tick. The corrected implementation directly dispatches `StartTask` to the sidecar (same as the `start_task` command), providing immediate execution.

3. **FK ordering in `run_automation_now`:** The `automation_runs.task_id` column has a foreign key to `tasks(id)`. The task record must be created **before** the automation run record. The original plan code had these reversed.

4. **`model_id` is already provider-qualified:** The `automation.model_id` field stores the full model identifier (e.g., `github-copilot/claude-sonnet-4.6`). When passing to the sidecar, use it directly — do NOT prepend `provider_id/`.

5. **Inline toggle switch on AutomationCard:** The card includes a visible toggle switch (`role="switch"`) between the card content and the dropdown action menu. This provides quick enable/disable without opening the menu. The toggle calls `onToggleEnabled` which persists the state via `toggle_automation_enabled` → DB. The dropdown menu retains a "Disable/Enable" item as a secondary option.

6. **Run completion wiring (`complete_task` → `mark_automation_run_complete`):** The original plan omitted the critical linkage between task completion and automation run status. The `complete_task` Tauri command now queries `get_running_run_by_task_id` (added to `db/automations.rs`) to find an automation run associated with the completing task. If found, it calls `mark_automation_run_complete` which updates the run's DB status to `completed`, releases the scheduler's `is_running` lock, and emits the `automation:run_completed` event. Without this wiring, runs stayed stuck in "running" status permanently.

7. **Next scheduled run time on AutomationCard:** The card now displays the next scheduled run time alongside the schedule description. The next fire time is computed client-side from the cron expression using a lightweight parser (`getNextCronDate()`). Display format: daily/hourly automations show just the time (e.g., "9:00 AM"); weekly automations show the weekday followed by the time (e.g., "Monday 9:00 AM"). Disabled automations hide the next run time.

8. **Sidebar event subscriptions refresh the runs list:** The original plan only subscribed to `automation:run_completed` to refresh `unreadCount`. The corrected implementation subscribes to both `automation:run_started` and `automation:run_completed` in `Sidebar.tsx`, calling `loadRuns` on both events so the `AutomationRunsPanel` reactively updates run statuses without requiring page refresh.

9. **Scheduler `fire_automation` and `process_pending_runs` must create tasks and dispatch to sidecar:** The original plan's `fire_automation()` only created an `automation_run` record with `status: "running"` but never created a `task` record, linked `automation_run.task_id`, or dispatched `StartTask` to the sidecar. This caused scheduled runs to show as "Running..." in the UI with no actual task executing, and `complete_task` could never find the run (since `task_id` was `None`). The corrected implementation mirrors the `run_automation_now` command flow: creates a task record, sets `automation_run_id` on it, creates the run linked to the task, resolves workspace context (permissions, API keys, model, MCP config), and dispatches `StartTask` to the sidecar. The same fix was applied to `process_pending_runs` for queued runs. Since the scheduler runs on a `std::thread` (not Tokio), sidecar dispatch uses a spawned `tokio::runtime::Runtime` on a new thread.

10. **Single-row `AutomationRunItem` layout:** The original plan rendered each run item as a two-row card (name + time on row 1, status text on row 2). The corrected implementation collapses this into a single row: `automationName | status | timeAgo`. The status text sits between the name and time, truncating with ellipsis when space is tight. This reduces vertical space and improves scan-ability in the sidebar triage panel.

11. **Cron day-of-week numeric mismatch (`cron` crate v0.12):** The `cron` crate interprets numeric day-of-week values as 1-indexed Sunday-first (`1=Sun … 7=Sat`), whereas standard Unix cron uses 0-indexed (`0=Sun, 1=Mon … 6=Sat`). The frontend's `buildCron()` generates standard Unix format (e.g., `1-5` for Mon–Fri), but the crate treated `1-5` as Sun–Thu, silently skipping Fridays (and shifting all other days). This caused scheduled automations to never fire on the correct days. The fix converts numeric dow values to named abbreviations (`Mon`, `Tue`, etc.) in `normalize_cron()` before passing to the crate, since named days are handled unambiguously. Affected expressions: ranges (`1-5` → `Mon-Fri`), lists (`1,3,5` → `Mon,Wed,Fri`), single values (`5` → `Fri`), and step patterns (`*/2` passthrough).

12. **Cron expression validation on form save:** Invalid cron expressions (e.g., `* \5 * * 1-5`) entered in the Custom schedule mode were silently saved to the database and ignored by the scheduler. A new `validate_cron` Tauri command validates cron expressions using the same `normalize_cron()` + `cron::Schedule::from_str()` pipeline as the scheduler. The `AutomationForm` calls `validateCron` on every cron change (debounced 400ms for Custom input, immediate for structured pickers) and displays the error below the cron preview. The submit button is disabled when validation fails. The `AutomationSchedulerRegistry` exposes `normalize_cron_public()` so the validation command can reuse the exact normalization logic.

13. **Local timezone for schedule evaluation:** The scheduler previously evaluated cron expressions against UTC, causing user-selected times (e.g., "9:00 AM") to fire at 9:00 AM UTC rather than 9:00 AM in the user's local timezone. The fix changes `compute_next_fire()` to evaluate cron expressions against `chrono::Local` instead of `chrono::Utc`, then converts the result to UTC for internal storage and comparison. The frontend time picker already displays local times, so no frontend changes were needed — the fix is entirely in `automation_scheduler.rs`.

14. **`has_findings` content-based heuristic:** The original implementation set `has_findings = status == "completed"`, marking every successful run as having findings. The corrected implementation queries the last assistant message from the task's conversation and checks it against a list of "no findings" phrases (case-insensitive). Runs whose final output contains phrases like "nothing to report", "no files to", "already up to date", etc., are correctly marked as `has_findings = false`. Failed or cancelled runs always return `false`.

15. **`mark_automation_run_complete` self-deadlock on DB mutex:** `mark_automation_run_complete` acquired `db_state.conn.lock()` to update the run status, then called `process_pending_runs()` without dropping the lock. Since `process_pending_runs` also acquires `db_state.conn.lock()` and `std::sync::Mutex` is not reentrant, this caused a self-deadlock on the same thread. The deadlock permanently blocked the `complete_task` Tauri command's Tokio worker thread, which in turn prevented all subsequent Tauri commands (including `update_automation`) from executing — freezing the automation form UI. Pending runs accumulated because `process_pending_runs` never completed. The fix wraps the DB operations in `mark_automation_run_complete` in a block scope so the connection is dropped before calling `process_pending_runs`. Additionally, `AutomationForm` now tracks an `isSaving` state to prevent multiple concurrent submissions while a save is in-flight.

