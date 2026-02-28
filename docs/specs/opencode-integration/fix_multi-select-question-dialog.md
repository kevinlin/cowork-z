# Fix: Multi-Select Question Dialog Support

**Date:** 2026-03-01
**Symptom:** When the agent sends a question with `multiple: true` (allowing the user to select multiple answers), the QuestionDialog always behaves as single-select — clicking a second option deselects the first.

## Root Cause

The OpenCode server sends `multiple: true` on each question object in the `question.asked` SSE event. The sidecar's `QuestionInfo` type defines the field as `multiSelect`, and the sidecar passes `props.questions` through to the frontend without mapping. Since `multiple` is not in the type definition, it is silently dropped, and `multiSelect` is always `undefined` on the frontend.

### Data flow (before fix)

```
OpenCode Server (multiple: true)
  → SSE event (question.asked)
  → Sidecar passes questions as-is (multiple field ignored by type)
  → Rust forwards JSON payload
  → Frontend checks multiSelect (always undefined)
  → Single-select behavior
```

## Fix

### 1. Sidecar type update (`types.ts`)

Added `multiple?: boolean` to `QuestionInfo` so the field from the OpenCode server is preserved during deserialization.

### 2. Field mapping (`session-manager.ts`)

In the `question.asked` event handler, map each question's fields before emitting to Rust:

```typescript
questions: props.questions.map((q) => ({
  ...q,
  multiSelect: q.multiSelect ?? q.multiple ?? false,
})),
```

This normalizes both `multiple` (server convention) and `multiSelect` (app convention) into a single `multiSelect` boolean.

### 3. Visual indicators (`QuestionDialog.tsx`)

When `multiSelect` is true:
- Helper text "Select one or more options" appears below the question
- Each option shows a checkbox indicator (filled with check icon when selected, empty border when not)
- The submit button shows a count badge when 2+ options are selected

When `multiSelect` is false (or absent), the dialog behaves as before — single-select with no checkbox indicators.

## Files Changed

- `src-tauri/sidecar-opencode/src/types.ts` — Added `multiple` field to `QuestionInfo`
- `src-tauri/sidecar-opencode/src/session-manager.ts` — Map `multiple` → `multiSelect` in question event handler
- `src/components/chat/QuestionDialog.tsx` — Added multi-select visual indicators (helper text, checkboxes, count badge)
