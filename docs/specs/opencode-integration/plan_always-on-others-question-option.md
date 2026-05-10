# Always-on "Others" Question Option

## Goal

Every `task:question_request` rendered by [QuestionDialog](src/components/chat/QuestionDialog.tsx) must offer a free-text "Others" choice, even when the agent does not include one. If the agent already supplies an `Other`/`Others` option, suppress the synthetic one to avoid duplication. No protocol or sidecar change is needed because [`SessionManager.replyToQuestion`](src-tauri/sidecar-opencode/src/session-manager.ts) already flattens `{ labels, customText }` into the `string[]` shape OpenCode expects.

## Where the change lives

- **UI only:** [src/components/chat/QuestionDialog.tsx](src/components/chat/QuestionDialog.tsx)
- **Docs:** [docs/specs/opencode-integration/design_opencode-integration.md](docs/specs/opencode-integration/design_opencode-integration.md), [UPDATE_LOG.md](UPDATE_LOG.md)
- **Out of scope:** sidecar (`session-manager.ts`, `opencode-client.ts`), Rust event routing, `tauri-api.ts`, `QuestionRequest` type. The wire format is unchanged.

## Detection rule

Treat the question as already exposing a free-text option when any provided option's `label.trim().toLowerCase()` is `"other"` or `"others"`. (Conservative; broader heuristics like "custom"/"something else" can be added later if needed.)

```ts
const OTHERS_LABEL = 'Others';
const OTHERS_DESCRIPTION = 'Type your own response';

const hasFreeTextOption = (currentQuestion.options ?? []).some((o) =>
  ['other', 'others'].includes(o.label.trim().toLowerCase())
);

const renderedOptions = hasFreeTextOption
  ? currentQuestion.options ?? []
  : [...(currentQuestion.options ?? []), { label: OTHERS_LABEL, description: OTHERS_DESCRIPTION }];
```

The synthetic option is render-only; it never enters `selectedOptions` (the dialog already routes a click on `"other"`/`"others"` into `showCustomInput` mode).

## UI behaviour

### Single-select (current default)

- Picking "Others" (synthetic or agent-supplied) clears `selectedOptions` and switches to the existing free-text input panel ([QuestionDialog.tsx:107-110, 144-169](src/components/chat/QuestionDialog.tsx)).
- "Back to options" returns to the option list.
- Submitted answer: `{ labels: [], customText: '<typed text>' }` — the sidecar maps this to `[customText]` on the wire.

### Multi-select

Today's `'other'` click handler clears all selections and hides the option list. With Others always present, that breaks multi-select. Adjust:

- When `multiSelect && labelIsOthers`: toggle an `othersSelected` boolean **and** render the free-text input inline beneath the option list (alongside other checked options). Other checkbox selections are preserved.
- Submitted answer: `{ labels: [...selectedOptions], customText: othersSelected ? customResponse.trim() : undefined }`.
- Submit is disabled until either (a) at least one non-Others label is selected, or (b) Others is selected and `customResponse.trim().length > 0`.

### Placeholder copy

- Synthetic option label: `Others`, description: `Type your own response`.
- Free-text `<Input>` placeholder stays `Type your response...` (already in use at [QuestionDialog.tsx:156, 183](src/components/chat/QuestionDialog.tsx)).

## Submit-button enable rule (replace [QuestionDialog.tsx:201](src/components/chat/QuestionDialog.tsx))

```ts
const trimmedCustom = customResponse.trim();
const canSubmit = currentQuestion.multiSelect
  ? selectedOptions.length > 0 || (othersSelected && trimmedCustom.length > 0)
  : showCustomInput
    ? trimmedCustom.length > 0
    : selectedOptions.length > 0;
```

## State reset

`handleSubmitCurrent` and `handleBack` must also reset the new `othersSelected` flag alongside the existing `selectedOptions` / `customResponse` / `showCustomInput` resets ([QuestionDialog.tsx:30-55](src/components/chat/QuestionDialog.tsx)).

## Tests (Vitest)

New file `src/components/chat/__tests__/QuestionDialog.test.tsx` covering:

1. Renders an extra `Others` button when the question has no `Other`/`Others` option.
2. Does **not** render a duplicate when the question already includes an `Other` (case-insensitive) option.
3. Single-select: clicking `Others`, typing, and submitting fires `onSubmit([{ labels: [], customText: '<typed>' }])`.
4. Multi-select: selecting one regular option + `Others` + typing submits `{ labels: ['<chosen>'], customText: '<typed>' }`.
5. Multi-select: `Others` selected with empty input keeps Submit disabled.

## Doc updates

### [docs/specs/opencode-integration/design_opencode-integration.md](docs/specs/opencode-integration/design_opencode-integration.md)

In the **Session Management → Question & Permission Handling** subsection (around line 213), add a new bullet:

> **Always-on free-text fallback:** The frontend `QuestionDialog` injects a synthetic `Others` option (description "Type your own response") whenever the agent's `options` array does not already contain a case-insensitive `Other`/`Others` entry. Selecting it surfaces a free-text input that becomes the answer's `customText`; the existing `replyToQuestion` flattening (`labels` + `customText` → `string[]`) means OpenCode receives the typed text without any protocol change.

No changes to the **Resolved Issues → Question Reply Payload Format Mismatch** section — the wire transform it documents is exactly what makes this UI-only fix possible.

### [docs/specs/chat-ux/design_chat-ux.md](docs/specs/chat-ux/design_chat-ux.md)
Question Dialog section (lines 583-595) describes the same dialog and currently calls the free-text input "Optional". After this change it is effectively always-on.

### [UPDATE_LOG.md](UPDATE_LOG.md)

Append to the `v0.7.13` block:

```
- **Always-on "Others" answer for agent questions** — `QuestionDialog` now appends a synthetic `Others` free-text option to every agent question (skipped only when the agent already provides a case-insensitive `Other`/`Others` choice). Selecting it reveals a text input whose contents are forwarded as `customText` and concatenated into the OpenCode `string[]` answer.
```

## Verification

1. `pnpm typecheck`
2. `pnpm test --run src/components/chat/__tests__/QuestionDialog.test.tsx`
3. `pnpm dlx ultracite fix src/components/chat/QuestionDialog.tsx src/components/chat/__tests__/QuestionDialog.test.tsx`
