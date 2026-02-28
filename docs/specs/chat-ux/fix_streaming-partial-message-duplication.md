# Fix: Streaming Partial Message Duplication

## Problem

During multi-step agentic turns (think → tool → think → tool → think), streaming text messages appeared as multiple repeated blocks with cascading duplicate content instead of updating a single message in-place.

**Screenshot symptom:** 4–5 assistant message bubbles, each containing progressively longer text that repeats all prior messages' content.

## Root Cause

Two related bugs in `src-tauri/sidecar-opencode/src/session-manager.ts`:

### 1. `textAccumulator` never resets between messages within one turn

The `textAccumulator` is a single string per `ManagedSession`. When the OpenCode server emits multiple `message.updated` events (one per assistant message in a multi-step turn), the accumulator is never cleared. Deltas from message N get appended to the leftover text from messages 1…N-1, producing `textSoFar` values like:

```
Message 1 textSoFar: "The user wants me to extract..."
Message 2 textSoFar: "The user wants me to extract...Now I have the skill..."
Message 3 textSoFar: "The user wants me to extract...Now I have the skill...Pandas not installed..."
```

### 2. No `message-complete` emitted between messages within one turn

`message-complete` (which triggers `finalizePartialMessage` on the frontend, removing the entry from the `partialMessages` Map) was only emitted in `handleSessionIdle()` — when the entire session becomes idle. During a multi-step turn the session stays busy, so:

- Partial message 1 is never removed from the `partialMessages` Map
- Partial message 2 is added alongside it with a different `messageId`
- `MessageList` renders all partials as separate bubbles
- Each subsequent message contains all prior text, creating cascading duplicates

## Fix

**File:** `src-tauri/sidecar-opencode/src/session-manager.ts`

In the `message.updated` handler, before setting the new `currentMessageId`, finalize the previous message if text was accumulated:

```typescript
if (props.info.role === 'assistant') {
  // Finalize previous message's accumulated text before starting new one
  if (managed.textAccumulator && managed.currentMessageId) {
    this.emit('message-complete', {
      taskId,
      messageId: managed.currentMessageId,
      text: managed.textAccumulator,
    });
    managed.textAccumulator = '';
  }
  managed.currentMessageId = props.info.id;
  this.emit('message', { taskId, message: props.info });
}
```

This reuses the same finalization pattern already present in `handleSessionIdle()`. No frontend changes needed — `finalizePartialMessage` and the `MessageList` merge logic already handle the transition correctly.

## Verification

- `cd src-tauri/sidecar-opencode && pnpm build` passes
- Multi-step agent turns show a single updating message bubble per assistant response
- `handleSessionIdle` still correctly finalizes the last message when the turn ends
