# Fix: Cross-Task Message Leakage (GitHub #22)

## Problem

Messages from failed or stuck sessions appeared in newly started tasks. Users reported two scenarios:

1. **Failed session leakage** — A task errors out, and when the user starts a new task, messages from the failed task appear in the new conversation.
2. **Stuck-after-question leakage** — A task asks the user a question, the user answers, but the task never resumes (gets stuck). Starting a new task shows messages from the stuck conversation.

## Root Cause Analysis

The bug had **two independent causes** operating at different layers of the stack.

### Cause 1: Sidecar session map not cleaned up (backend)

**Location:** `src-tauri/sidecar-opencode/src/session-manager.ts`

The `SessionManager` maintains two in-memory maps:
- `sessions`: `Map<taskId, ManagedSession>` — tracks active sessions
- `sessionToTask`: `Map<sessionId, taskId>` — routes incoming SSE events to the correct task

When a session completed (went idle) or errored, these maps were **never cleaned up**. The `cleanup()` method existed but was only called from `abortSession()`. This meant:

- Completed sessions left stale mappings in both maps
- Errored sessions left stale mappings in both maps
- Sessions blocked on `question.asked` or `permission.asked` left mappings when the user abandoned them

Late-arriving SSE events for these stale sessions would be routed to the old task's `taskId`, causing messages to be persisted to the wrong task in the database.

### Cause 2: Partial messages not cleared on task switch (frontend)

**Location:** `src/stores/taskStore.ts`

The Zustand store's `partialMessages` Map holds streaming/in-progress assistant messages. This Map was **never cleared** when switching between tasks — it was only reset on workspace switch (`reset()`).

When a task was actively streaming a response and got stuck (e.g., after answering a question), any partial messages remained in the Map. When the user started a new task, the `MessageList` component merged these stale partials with the new task's messages:

```typescript
// MessageList.tsx — merges completed messages with partials
const messagesToRender = useMemo((): RenderableMessage[] => {
    const completed = messages || [];
    const partials = Array.from(partialMessages.values());
    const partialIds = new Set(partials.map((p) => p.id));
    const filteredCompleted = completed.filter((m) => !partialIds.has(m.id));
    const combined = [...filteredCompleted, ...partials];
    return combined.sort((a, b) => ...);
}, [messages, partialMessages]);
```

Since `partialMessages` is a global store Map (not scoped per task), stale entries from the old task would appear in the new task's message list.

## Fix

### Sidecar (Cause 1)

Three changes in `src-tauri/sidecar-opencode/src/session-manager.ts`:

1. **`handleSessionIdle`** — Added `this.cleanup(managed.taskId)` after emitting the `complete` event, so completed sessions are removed from both maps.

2. **`session.error` handler** — Added `this.cleanup(taskId)` after emitting the `error` event, so errored sessions are removed from both maps.

3. **`startTask`** — Added a proactive cleanup loop that removes all stale sessions from the maps before registering the new session. This catches sessions abandoned due to questions, permissions, or any other reason:

```typescript
const staleTaskIds = Array.from(this.sessions.keys()).filter((id) => id !== taskId);
for (const oldTaskId of staleTaskIds) {
    this.cleanup(oldTaskId);
}
```

### Frontend (Cause 2)

Two changes in `src/stores/taskStore.ts`:

1. **`startTask`** — Added `partialMessages: new Map()` to the `set()` call that creates the new task, ensuring stale streaming messages from any previous task are cleared.

2. **`loadTaskById`** — Added `partialMessages: new Map()` to the `set()` call that loads a task from the database, ensuring stale partials are cleared when navigating between tasks.

## Debugging Methodology

The fix required systematic runtime instrumentation across three layers:

1. **Sidecar layer** — Instrumented `session.status`, `question.asked`, `replyToQuestion`, `handleSessionIdle`, `startTask`, and `cleanup` to trace session lifecycle and map state.

2. **Frontend event layer** — Instrumented `addTaskUpdate` to trace event routing, task ID matching, and `isCurrentTask` filtering.

3. **Frontend state layer** — Instrumented `startTask`, `loadTaskById`, and the Execution page render to trace `currentTask` state transitions, DB query results, and route-vs-store mismatches.

The sidecar cause was identified in the first debugging round. The frontend cause required two additional rounds because the sidecar fix eliminated the event-routing leak, but the `partialMessages` leak operated through a separate path (the Zustand store's global Map) that was invisible to event-level instrumentation.

## Files Changed

- `src-tauri/sidecar-opencode/src/session-manager.ts` — Session cleanup on idle, error, and new task start
- `src/stores/taskStore.ts` — Clear `partialMessages` on task switch
