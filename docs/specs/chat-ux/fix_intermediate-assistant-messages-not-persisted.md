# Fix: Intermediate Assistant Messages Not Persisted

## Problem

When an agent session produces multiple assistant messages (e.g., assistant text → tool calls → assistant text → tool calls → final assistant text), only the **last** assistant message and all tool messages are saved to SQLite. Intermediate assistant messages are lost, so resuming a session in the UI shows gaps in the conversation.

## Root Cause

`finalizePartialMessage` in `taskStore.ts` (line 1020) is the only code path that persists assistant messages to the database. It is triggered by `task_message_complete` events from the sidecar.

The function has a guard at line 1035:

```ts
const partial = state.partialMessages.get(event.messageId);
if (!partial) {
  return { partialMessages: newPartialMessages };
}
```

This guard silently drops the DB save when no matching entry exists in the in-memory `partialMessages` Map. The Map is populated by `addPartialMessage` (triggered by `task_message_partial` streaming delta events). If no streaming deltas were received for a given assistant message before its `task_message_complete` arrives, the save is skipped.

This happens for intermediate messages because:

1. The sidecar's `message.updated` handler (session-manager.ts line 84) **synchronously** emits `message-complete` for the previous message, then resets `textAccumulator`.
2. The `task_message_complete` IPC event for the previous message can arrive at the frontend before (or without) any `task_message_partial` events for that message, especially for short assistant messages or when deltas arrive via `message.part.updated` (full state) rather than `message.part.delta` (incremental).
3. Without a `partialMessages` entry, `finalizePartialMessage` bails out at the guard — no DB write, no in-memory message addition.

The **last** assistant message is saved because it typically has streaming deltas (populating `partialMessages`) before the session goes idle and triggers `message-complete`.

## Fix

Modify `finalizePartialMessage` to **always persist** the assistant message when the `event.text` field contains content, regardless of whether a `partialMessages` entry exists. The `event.text` already carries the complete accumulated text from the sidecar's `textAccumulator`.

### Changes to `src/stores/taskStore.ts`

In `finalizePartialMessage`, replace the early-return guard:

```ts
// BEFORE
if (!partial) {
  return { partialMessages: newPartialMessages };
}
```

With logic that still creates and persists the message using `event.text`:

```ts
// AFTER
// Even without a partial entry, persist the message if we have text content.
// This handles intermediate assistant messages where streaming deltas
// may not have arrived before the complete event.
if (!partial && !event.text) {
  return { partialMessages: newPartialMessages };
}

const completeMessage: TaskMessage = {
  id: event.messageId,
  type: 'assistant',
  content: event.text,
  timestamp: partial?.timestamp || new Date().toISOString(),
};
```

The rest of the function (dedup check, DB save, state update) remains the same but is moved after this unified message construction.

## Verification

1. Start a multi-step agent task that produces intermediate assistant messages between tool calls
2. Let the task complete
3. Query `SELECT * FROM task_messages WHERE task_id = '<id>' ORDER BY sort_order` — all assistant messages should be present
4. Navigate away and back to the task — all messages should render in the UI
5. Restart the app and reopen the task — all messages should still be visible
