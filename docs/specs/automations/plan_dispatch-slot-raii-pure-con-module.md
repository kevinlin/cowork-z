# Automation Scheduler Refactor — Dispatch Slot (RAII) + Pure Cron Module

## Context

The automation scheduler enforces a "one automation run at a time" (v1 sequential) invariant with a raw `AtomicBool is_running`. Two architecture-review findings target it:

- **§2 Give the automation dispatch slot one home (live correctness bug).** The slot is acquired in two places (`fire_automation_on_thread:316`, `process_pending_runs:416`), released in five (`mark_automation_run_complete:397`, `process_pending_runs:429/436`, `dispatch_automation_run:474/507`), and — the bug — `run_automation_now` (`commands/automations.rs:248`) **dispatches without acquiring**, yet its completion path funnels through `mark_automation_run_complete`, which unconditionally does `is_running.store(false):397`. So a manual **Run Now** finishing can free the slot while a scheduled run is mid-flight, then drain pending on top of it — two automation runs concurrently, violating the invariant. The create-task/link/assign/dispatch sequence is also copy-pasted between the scheduler and Run Now, and the copies have already diverged (Run Now omits `set_automation_run_id`, mints its own run_id, awaits vs fire-and-forget).

- **§3 Free the cron logic from the scheduler registry.** `normalize_cron`, the dow remap (cron crate is 1-indexed Sun-first; Unix is 0-indexed), and `compute_next_fire` are pure associated functions but live as private methods on `AutomationSchedulerRegistry`. `normalize_cron_public` exists only so `validate_cron` can reach the behaviour without the registry — the tell that the interface is wrong. Zero tests on either side. The frontend re-derives the cron encoding three ways (`buildCron`, `detectFrequencyFromCron`, and an independent `cron[4]` parse in `AutomationCard`).

**Outcome:** the sequential invariant becomes structurally un-leakable (RAII), Run Now crosses the same dispatch seam, the pure cron math extracts into a table-tested module, and the frontend's redundant third cron parse is deleted. No IPC/type churn.

**Decisions (confirmed with user):**
- Run Now, when the slot is busy → **return a busy `Err`** (`"An automation run is already in progress"`); frontend surfaces a toast. Not queued.
- C3 scope → **pragmatic**: Rust module = `normalize` + `next_fire` only (no backend `describe`); frontend keeps `buildDisplay`/`scheduleDisplay` as the display owner and just drops the card's redundant parse. No changes to IPC input structs or `Automation` types.

---

## Phase 1 — §2 Dispatch Slot (RAII)

### Task 1.1: New `dispatch_slot` module

Create `src-tauri/src/dispatch_slot.rs`. A deep, thread/DB-free module owning the concurrency contract:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// The single "one automation run at a time" execution slot.
pub struct DispatchSlot { running: Arc<AtomicBool> }

/// Held for the lifetime of a dispatched run. Releases the slot on drop.
pub struct SlotGuard { running: Arc<AtomicBool> }

impl DispatchSlot {
    pub fn new() -> Self { Self { running: Arc::new(AtomicBool::new(false)) } }

    /// CAS false→true. `Some(guard)` iff the slot was free; the guard releases on drop.
    pub fn try_acquire(&self) -> Option<SlotGuard> {
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| SlotGuard { running: self.running.clone() })
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) { self.running.store(false, Ordering::SeqCst); }
}
```

Add `#[cfg(test)] mod tests`: acquire→Some; second acquire→None; drop guard then acquire→Some; guard dropped on scope exit releases. No threads, no DB — satisfies "slot testable without threads or DB."

Register `mod dispatch_slot;` in `lib.rs` module declarations.

### Task 1.2: Rework `AutomationSchedulerState` to hold the slot + parked guard

In `automation_scheduler.rs:352-368`, replace the raw atomic:

```rust
pub struct AutomationSchedulerState {
    pub slot: crate::dispatch_slot::DispatchSlot,
    /// The guard for the currently-dispatched run, parked until completion,
    /// keyed by run_id so only the owning run's completion releases it.
    active: std::sync::Mutex<Option<(String, crate::dispatch_slot::SlotGuard)>>,
}
```

Add methods:
- `fn park(&self, run_id: &str, guard: SlotGuard)` — store `Some((run_id, guard))`.
- `fn release(&self, run_id: &str)` — if the parked run_id matches, take + drop the guard (auto-releases the slot); else no-op. **This is the leak fix**: a completion whose run_id doesn't match the parked holder releases nothing.

`app.manage(...)` at `lib.rs:62` stays (constructor now builds `DispatchSlot::new()` + `Mutex::new(None)`).

### Task 1.3: Thread acquire/release through the dispatch seam

Rewrite so every acquire yields a `SlotGuard` and every release is a guard drop (delete all raw `.store(false)` / `.compare_exchange` on `is_running`):

- **`dispatch_automation_run`** (`:446-529`) — add a `guard: SlotGuard` param (drop `scheduler_state: &AutomationSchedulerState`, or keep only to call `park`). On early-error returns (`save_task` fail `:474`, `build_dispatch_context` fail `:507`) → just `return`; the stack-local `guard` drops → slot auto-released. **Delete the two explicit `store(false)` lines.** On the success path, after emitting `automation:run_started`, call `state.park(run_id, guard)` so the guard outlives the function until completion.
- **`fire_automation_on_thread`** (`:316-340`) — `let Some(guard) = scheduler_state.slot.try_acquire() else { <write pending run, return> };` (replaces the `won_dispatch` CAS block `:316-338`). Pass `guard` into `dispatch_automation_run`.
- **`process_pending_runs`** (`:411-442`) — `let Some(guard) = scheduler_state.slot.try_acquire() else { return };` (replaces `:416-422`). On "no pending" (`:428-431`) and "automation missing" (`:433-439`), just `return` — guard drops, auto-released (delete both `store(false)`). Else pass `guard` into `dispatch_automation_run`.
- **`mark_automation_run_complete`** (`:372-409`) — after a successful transition (`did_transition == true`), replace `is_running.store(false):397` with `scheduler_state.release(run_id)`. The `Err` bail (`:382-387`) and `!did_transition` bail (`:390-394`) keep returning **without** releasing (guard stays parked) — same intent as today, now expressed as "don't call release." Preserve the impl-note #15 ordering: the DB `conn` lock is already dropped (scoped block `:373-378`) before `process_pending_runs(app):408` — keep that.

### Task 1.4: Fold `run_automation_now` into the shared seam

Rewrite `run_automation_now` (`commands/automations.rs:248-310`) to cross the same seam instead of duplicating it:

1. `let scheduler_state = app.state::<AutomationSchedulerState>();`
2. `let Some(guard) = scheduler_state.slot.try_acquire() else { return Err("An automation run is already in progress".into()); };`
3. Lock conn, `get_automation` (early `?` returns drop the guard → slot released — correct), mint `run_id`, then call the shared `dispatch_automation_run(&app, &conn, &scheduler_state, &automation, &run_id, /*create_run*/ true, guard)`.

This deletes copy B's inlined `save_task`/`create_automation_run`/`assign_task_to_workspace`/`build_dispatch_context`/emit block (`:263-307`). Behavior changes worth noting in the plan changelog:
- Run Now now **respects the sequential slot** (was: always dispatched).
- Run Now now sets `tasks.automation_run_id` via the shared path's `set_automation_run_id` (`:478`) — copy B omitted it.
- Dispatch becomes fire-and-forget (`spawn_start_task_dispatch`) rather than awaited `dispatch_start_task(...).await?`; up-front errors (automation-not-found, save_task) still surface synchronously since they happen before the spawn. `dispatch_start_task` in `automation_dispatch.rs:85-90` becomes unused → remove it (and its `use` at `commands/automations.rs:6`) if no other caller remains.

### Task 1.5: Verify Phase 1

`cd src-tauri && cargo test` (new `dispatch_slot` tests pass) and `cargo check`. Grep to confirm zero remaining `is_running` references.

---

## Phase 2 — §3 Pure Cron Module

### Task 2.1: New `cron_schedule` module (Rust)

Create `src-tauri/src/cron_schedule.rs` (named to avoid confusion with the extern `cron` crate). Move, as free `pub fn`s, from `automation_scheduler.rs`:
- `normalize(expr: &str) -> String` ← `normalize_cron:84-95` + helpers `convert_dow_to_named:97-115`, `convert_dow_segment:117-128`, `dow_to_name:130-135` (make helpers private module fns).
- `next_fire(expr: &str) -> Option<DateTime<Utc>>` ← `compute_next_fire:137-141` (calls `normalize`, uses `cron::Schedule` + `chrono::Local`→`Utc`).

Add `#[cfg(test)] mod tests` — table-driven, the point of the whole candidate:
- normalize: 5-field prepends `"0 "`; 6/7-field passthrough unchanged.
- dow remap: `1-5`→`Mon-Fri`, `1,3,5`→`Mon,Wed,Fri`, `5`→`Fri`, `0`→`Sun`, `7`→`Sun`, `*/2`→`*/2`, `*`→`*`, already-named passthrough.
- next_fire: valid expr → `Some`; invalid (`"* \\5 * * 1-5"`) → `None`.

Register `mod cron_schedule;` in `lib.rs`.

### Task 2.2: Point callers at the module; kill the escape hatch

- `automation_scheduler.rs`: delete `normalize_cron_public:36-38`, `normalize_cron` + 3 dow helpers, and `compute_next_fire`. Replace the three `Self::compute_next_fire(...)` call sites (`:66`, `:150`, `:209`) with `cron_schedule::next_fire(...)`. (`get_next_runs`, `start_automation`, thread loop, `next_runs` map — all `&self`/state — stay in the registry.)
- `commands/automations.rs:13` (`validate_cron`): replace `AutomationSchedulerRegistry::normalize_cron_public(&cron_expression)` with `cron_schedule::normalize(&cron_expression)`. Adjust the `use` (drop the `AutomationSchedulerRegistry` import if now unused there).

### Task 2.3: Delete the frontend's redundant third parse + add tests

- `src/components/landing/AutomationCard.tsx:16-31` — `formatNextRun` currently splits `cron` and reads `fields[4]` (`:22-23`) to gate the weekday prefix. Replace that inline parse: import `detectFrequencyFromCron` from `@/lib/cron-utils` and gate on `detectFrequencyFromCron(cron).frequency === 'Weekly'` — one cron reader instead of a redundant third. The weekday name still comes from the next-run timestamp (`WEEKDAY_NAMES[date.getDay()]`), which is timestamp formatting, not cron parsing. `scheduleDisplay` remains the primary label (`:63`, unchanged).
- Create `src/lib/__tests__/cron-utils.test.ts` (Vitest) — table tests for `buildCron`, `detectFrequencyFromCron` (round-trip: `buildCron` output re-parses to the same frequency/weekday/time), `buildDisplay`, `parseTimeTo24`, covering the Unix 0-indexed weekday convention (Sunday=`'0'`). This is the "cron-utils gains its own tests" half of the candidate.

### Task 2.4: Verify Phase 2

`cd src-tauri && cargo test && cargo check`; `pnpm test --run src/lib/__tests__/cron-utils.test.ts` and `pnpm typecheck`.

---

## Phase 3 — Documentation (mandatory checklist)

1. **`docs/specs/automations/design_automations.md` — update inline** (not a changelog):
   - "Scheduler Design → Concurrency model (v1)" (§around L134-143): rewrite to describe the `DispatchSlot`/`SlotGuard` RAII model — `try_acquire()` returns a guard, the guard is parked in `AutomationSchedulerState` keyed by run_id until completion, release is a guard drop keyed to the run_id (so a foreign completion releases nothing). Note Run Now now acquires the slot and returns a busy error when the slot is held.
   - "Rust-side completion" / "Lifecycle events" (§L119-132): replace mentions of `is_running` store/CAS with the guard model; `mark_automation_run_complete` calls `state.release(run_id)`.
   - "Schedule parsing → Cron normalization / Cron validation" (§L165-169): note `normalize`/`next_fire` now live in the pure `cron_schedule` module (Rust) with table tests; `validate_cron` calls `cron_schedule::normalize` directly; `normalize_cron_public` removed.
   - "Run Now execution" (§L301-302): amend — Run Now still bypasses the pending queue, but now acquires the shared slot and returns a busy error if a run is already in progress (rather than dispatching concurrently).
   - Add a short "Cron logic ownership" note: Rust owns `normalize`/`next_fire`; the frontend `cron-utils.ts` owns cron *construction* (`buildCron`) and *display* (`buildDisplay`/`scheduleDisplay`); the card no longer independently parses `cron[4]`.

2. **`docs/specs/automations/plan_automations.md` — append changelog entries** under "Implementation Notes (Post-Implementation Corrections)" (continue the numbered list, currently ends at #17):
   - `18. Dispatch slot RAII (§2)` — the leak (Run Now released a slot it never acquired), the `DispatchSlot`/`SlotGuard` module, run_id-keyed parked-guard release, Run Now folded into `dispatch_automation_run` + busy-error behavior, `dispatch_start_task` removed.
   - `19. Pure cron_schedule module (§3)` — extracted `normalize`/`next_fire` with table tests, removed `normalize_cron_public` escape hatch, `validate_cron` calls the module, frontend `AutomationCard` third-parse deleted, `cron-utils.test.ts` added.

3. **`UPDATE_LOG.md` — add a new `## v0.8.7` section** (suggested version; adjust if the user prefers to fold into v0.8.6) with two bullets:
   - **Fix: manual "Run Now" could disrupt a scheduled automation mid-run** — a manual run finishing released the shared single-run execution slot even though it never claimed it, so it could free (and start draining onto) a scheduled run that was still in progress. Manual runs now claim the same slot and cleanly decline with a message when an automation is already running.
   - **Refactor: automation dispatch slot + cron logic** — the sequential-execution slot is now an RAII guard (release-on-drop, keyed to the owning run) so the invariant can't leak, and the cron normalization / next-fire math moved into a standalone, table-tested module shared by the scheduler and validation, with the frontend's redundant cron re-parse removed.

Run the `declaude` skill loop over the three prose deliverables before finalizing (per user global instructions).

---

## Verification (end-to-end)

- `cd src-tauri && cargo test` — `dispatch_slot` + `cron_schedule` unit tests green.
- `cd src-tauri && cargo check` — clean, no `is_running` / `normalize_cron_public` / `dispatch_start_task` leftovers (grep).
- `pnpm test --run` — `cron-utils.test.ts` green, no regressions.
- `pnpm typecheck` — clean.
- `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/` — no issues.
- Manual smoke (`pnpm tauri dev`): create an automation on a short cron; while it runs, hit **Run Now** on another → expect the busy error toast, scheduled run unaffected. Let the scheduled run finish → pending drains normally. Trigger Run Now while idle → runs immediately, `tasks.automation_run_id` populated.

## Critical files

- Create: `src-tauri/src/dispatch_slot.rs`, `src-tauri/src/cron_schedule.rs`, `src/lib/__tests__/cron-utils.test.ts`
- Modify: `src-tauri/src/automation_scheduler.rs`, `src-tauri/src/commands/automations.rs`, `src-tauri/src/automation_dispatch.rs` (remove `dispatch_start_task` if unused), `src-tauri/src/lib.rs`, `src/components/landing/AutomationCard.tsx`
- Docs: `docs/specs/automations/design_automations.md`, `docs/specs/automations/plan_automations.md`, `UPDATE_LOG.md`
- Reuse (unchanged): `automation_dispatch.rs::build_dispatch_context` / `spawn_start_task_dispatch`, `db::automations::try_complete_run_if_running` / `get_running_run_by_task_id`, `src/lib/cron-utils.ts::buildCron`/`buildDisplay`/`detectFrequencyFromCron`.
