# Fix: Question Reply Payload Format Mismatch

**Date:** 2026-02-28
**Symptom:** After answering a question prompt from the agent, the task gets permanently stuck — no further responses from OpenCode.

## Root Cause

The OpenCode server's `POST /question/{id}/reply` endpoint expects `answers` as an array of arrays (`string[][]`), where each inner array contains the selected label strings for the corresponding question:

```json
{ "answers": [["Selected Label A"]] }
```

The sidecar was sending `answers` as an array of objects with a `labels` property:

```json
{ "answers": [{ "labels": ["Selected Label A"] }] }
```

This caused a **400 Bad Request** from the server:

```
"Invalid input: expected array, received object" at path ["answers", 0]
```

### Secondary Issue

The error from the failed HTTP request was caught and logged in `handleQuestionReply` (`index.ts`) but never propagated to the frontend as a `task_error` event. This left the UI stuck in an active state with no feedback.

## Fix

### 1. Answer format transformation (`session-manager.ts`)

`replyToQuestion` now transforms the `{labels, customText}` objects received from Rust into flat `string[]` arrays before calling the OpenCode client:

```typescript
const flatAnswers: string[][] = answers.map((a) => {
  if (a.customText) return [...a.labels, a.customText];
  return a.labels;
});
```

### 2. Client type correction (`opencode-client.ts`)

Changed `replyToQuestion` signature from `QuestionAnswer[]` (objects) to `string[][]` (flat arrays) to match the OpenCode server schema.

### 3. Error propagation (`index.ts`)

`handleQuestionReply` now sends a `task_error` event to the frontend when the reply fails, instead of silently swallowing the error.

## Files Changed

- `src-tauri/sidecar-opencode/src/session-manager.ts` — Transform answer objects to flat arrays
- `src-tauri/sidecar-opencode/src/opencode-client.ts` — Fix type signature and remove unused import
- `src-tauri/sidecar-opencode/src/index.ts` — Propagate question reply errors to frontend

## Verification

Confirmed via runtime logs that 4 consecutive question replies succeeded after the fix, with the server accepting the corrected `string[][]` format.
