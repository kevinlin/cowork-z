# Fix: Stop Button Does Not Work

## Problem

Clicking the Stop button (or pressing Escape) during a running task has no effect. The agent continues executing and the UI stays in the "running" state.

## Root Cause

The `sessionId` is never available on the task during the running phase, so `interruptTask` falls through to `cancelTask`, which is a **no-op** in server mode.

### The chain of failure

1. **`startTask` returns `session_id: None`** — The Rust command at `src-tauri/src/commands/tasks.rs` returns `session_id: None` because the session hasn't been created yet at that point.

2. **`task:started` event is emitted but never consumed** — The sidecar emits a `task_started` event (via `sessionManager.on('started', ...)` in `src-tauri/sidecar-opencode/src/index.ts`) containing `{ taskId, sessionId }`. Rust forwards this as `task:started`. But the frontend's `onTaskUpdate` in `src/lib/tauri-api.ts` only listened for `task:update`, `task:message`, `task:progress`, `task:complete`, and `task:error` — **not** `task:started`.

3. **`interruptTask` has no sessionId** — In `src/stores/taskStore.ts`, `sessionId = currentTask.sessionId || currentTask.result?.sessionId` evaluates to `undefined` because neither field has been set during the running phase.

4. **Falls through to no-op** — Without a `sessionId`, the code calls `api.cancelTask()`, which sends `cancel_task` to the sidecar. The sidecar's handler just logs: `"Cancel not supported in server mode, use abort_session instead"`.

### Secondary issue: missing `directory` on abort

Even when `abortSession` is called (e.g., on session resume), the `directory` parameter was not passed to the OpenCode API. Compare with `replyToPermission` and `replyToQuestion`, which both extract `managed?.session?.directory` and pass it.

## Fix

### 1. Add `task:started` listener in `onTaskUpdate` (`src/lib/tauri-api.ts`)

Added a new listener in the `Promise.all` block for `task:started` that extracts `taskId` and `sessionId` from the event payload and forwards them as a `started` event to the callback.

### 2. Add `'started'` to `TaskUpdateEvent` type (`src/shared/types/task.ts`)

Updated the type union to include `'started'`.

### 3. Handle `started` events in the task store (`src/stores/taskStore.ts`)

- In the event handler, set `sessionId` on the current task and update status to `'running'` when a `started` event arrives.
- Persist the `sessionId` to the database via `api.saveTaskSession()` (fire-and-forget).
- Widened the `interruptTask` status guard to include `'starting'` (matching the `isTaskRunning` check in `Execution.tsx`).

### 4. Pass `directory` in `abortSession` (`src-tauri/sidecar-opencode/src/session-manager.ts`)

Extract `managed?.session?.directory` and pass it to `this.client.abortSession()`, matching the pattern used by `replyToPermission` and `replyToQuestion`.

## Files Changed

- `src/shared/types/task.ts` — Add `'started'` to `TaskUpdateEvent.type`
- `src/lib/tauri-api.ts` — Add `task:started` listener
- `src/stores/taskStore.ts` — Handle `started` event; widen `interruptTask` status guard; persist sessionId
- `src-tauri/sidecar-opencode/src/session-manager.ts` — Pass `directory` to `abortSession`
