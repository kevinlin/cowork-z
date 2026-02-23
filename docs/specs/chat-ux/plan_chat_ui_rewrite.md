# Chat UI Rewrite

## Problem

`[src/pages/Execution.tsx](src/pages/Execution.tsx)` is a 1,477-line monolith that mixes page logic, event subscriptions, message rendering, permission modals, follow-up input, and debug panels in a single file. Tool-use messages are rendered as one-line "progress" indicators and are not expandable. The `task:question_request` event has no UI handler (questions only work when piggy-backed onto `permissionRequest`).

## Goal

Decompose into focused components modeled on Tandem's `src/components/chat/` architecture while keeping the existing Cowork-Z theme (shadcn/ui, Tailwind CSS, card/muted/border tokens). Add collapsible tool-call cards and proper question-request handling.

---

## Architecture: Before vs. After

### Current (Execution.tsx monolith)

```
Execution.tsx (1,477 lines)
  |- Header
  |- Message list (inline messagesToRender loop)
  |- MessageBubble (inline memo component, ~200 lines)
  |- Thinking indicator (inline)
  |- Permission modal (inline, ~250 lines)
  |- Running input / Follow-up input (inline)
  |- Debug panel (inline)
```

### Proposed (modular)

```
src/pages/Execution.tsx (~400 lines)  -- page shell, routing, event subscriptions
src/components/chat/
  |- index.ts                         -- barrel exports
  |- MessageList.tsx                   -- scrollable container, auto-scroll, scroll-to-bottom
  |- MessageBubble.tsx                 -- single message: user/assistant/system/tool
  |- ToolCallCard.tsx                  -- collapsible tool call (name + input summary / full I/O)
  |- PermissionModal.tsx              -- file/tool/question permission dialog
  |- QuestionDialog.tsx               -- dedicated question-request dialog (from task:question_request)
  |- ChatInput.tsx                    -- follow-up input with DragDropTextarea + stop button
  |- ThinkingIndicator.tsx            -- spinner + tool/startup stage label
```

---

## Detailed Component Design

### 1. MessageBubble.tsx (extracted + enhanced)

**Layout per role** (keep existing Cowork-Z style tokens):

- **User**: `bg-muted/30 border-l-2 border-primary` -- plain text, whitespace-pre-wrap
- **Assistant**: `bg-card border border-border` -- ReactMarkdown with `createMarkdownComponents()`, `StreamingText`, media gallery, copy button
- **Tool**: Rendered via `ToolCallCard` (see below) instead of current one-line label
- **System**: Muted header + content

**Key changes from current:**

- Remove the `TOOL_PROGRESS_MAP` one-liner rendering for tool messages
- Instead, render tool messages through `ToolCallCard`
- Keep `extractUserFacingContent`, `enrichContentWithLinks`, `extractMediaPaths`, `MediaGallery`, copy button

### 2. ToolCallCard.tsx (new -- modeled on Tandem's ToolCallCard)

**Collapsed state** (default): single row showing:

- Tool icon (from existing `TOOL_PROGRESS_MAP` icon map)
- Tool name (human-readable label)
- First line of input summary (e.g. file path for Read/Write, command for Bash, query for Grep)
- Status indicator: spinner (running) or checkmark (done)

**Expanded state** (click to toggle): reveals:

- Full input JSON (`toolInput`) in a `<pre>` block
- Full output (`toolOutput`) in a `<pre>` block, if available

**Styling**: Use Cowork-Z tokens -- `bg-muted rounded-lg border border-border`, `text-muted-foreground`, `text-xs font-mono` for code blocks.

**Input summary extraction logic** (new helper `getToolInputSummary`):

- `Read` / `Write` / `Edit`: show `path` field
- `Bash`: show `command` field (truncated to ~80 chars)
- `Grep`: show `pattern` field
- `Glob`: show `glob_pattern` field
- `WebFetch`: show `url` field
- `WebSearch`: show `search_term` field
- `Task`: show `description` field
- Default: first key-value pair or JSON.stringify truncated

### 3. PermissionModal.tsx (extracted from Execution.tsx)

Move the existing ~250-line permission modal into its own component with no logic changes. Props:

```typescript
interface PermissionModalProps {
  request: PermissionRequest;
  onRespond: (approved: boolean, response?: string) => void;
}
```

Covers existing types: `file`, `tool`, `question` (permission-based questions).

### 4. QuestionDialog.tsx (new -- handles `task:question_request` events)

Currently `task:question_request` events are never consumed. Add:

- Subscribe to `onQuestionRequest` in Execution.tsx
- Store in `questionRequest` state (separate from `permissionRequest`)
- Render `QuestionDialog` as a modal with:
  - Question text + optional header
  - Option buttons (single or multi-select)
  - Custom text input for "Other"
  - Submit / Cancel actions
  - Calls `respondToQuestion` via tauri-api

**Types** (from `[src-tauri/sidecar-opencode/src/types.ts](src-tauri/sidecar-opencode/src/types.ts)`):

```typescript
QuestionRequest: { id, sessionId, questions: [{ question, header, options[], multiSelect }] }
```

### 5. ChatInput.tsx (extracted)

Extract the follow-up input area + running-state input + "Start New Task" button. Props:

```typescript
interface ChatInputProps {
  isRunning: boolean;
  canFollowUp: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  isLoading: boolean;
}
```

### 6. MessageList.tsx (extracted)

Extract the scrollable message container with:

- `messagesToRender` computation (completed + partial messages)
- Auto-scroll with `isAtBottom` tracking
- Scroll-to-bottom button
- `ThinkingIndicator` at the end when running

### 7. ThinkingIndicator.tsx (extracted)

The existing spinner + tool name / startup stage label, extracted as a small component.

---

## Event Subscription Changes in Execution.tsx

Keep all event subscriptions in Execution.tsx (page-level), but add:

```typescript
// NEW: Subscribe to question requests
api.onQuestionRequest((request) => {
  setQuestionRequest(request);
}).then((unsub) => unlisteners.push(unsub));
```

The `onQuestionRequest` function already exists in `[src/lib/tauri-api.ts](src/lib/tauri-api.ts)` but is currently unused.

---

## Type Changes

In `[src/shared/types/task.ts](src/shared/types/task.ts)`, add:

```typescript
export interface QuestionRequest {
  id: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}
```

---

## Files to Create


| File                                        | Lines (est.) | Purpose                         |
| ------------------------------------------- | ------------ | ------------------------------- |
| `src/components/chat/index.ts`              | 10           | Barrel exports                  |
| `src/components/chat/MessageList.tsx`       | 120          | Scroll container + message loop |
| `src/components/chat/MessageBubble.tsx`     | 200          | Per-message rendering           |
| `src/components/chat/ToolCallCard.tsx`      | 150          | Collapsible tool call card      |
| `src/components/chat/PermissionModal.tsx`   | 250          | Permission dialog (extracted)   |
| `src/components/chat/QuestionDialog.tsx`    | 180          | Question request dialog (new)   |
| `src/components/chat/ChatInput.tsx`         | 120          | Input area (extracted)          |
| `src/components/chat/ThinkingIndicator.tsx` | 60           | Spinner + label (extracted)     |


## Files to Modify

- `[src/pages/Execution.tsx](src/pages/Execution.tsx)` -- slim down to ~400 lines (page shell + event subs + compose child components)
- `[src/shared/types/task.ts](src/shared/types/task.ts)` -- add `QuestionRequest` type
- `[src/stores/taskStore.ts](src/stores/taskStore.ts)` -- add `questionRequest` state + setter if not present
- `[docs/specs/requirements.md](docs/specs/requirements.md)` -- add requirement 3.7
- `[UPDATE_LOG.md](UPDATE_LOG.md)` -- add v0.4.5 entry

---

## Requirement Addition (3.7)

Add to `docs/specs/requirements.md` under section 3:

```markdown
#### 3.7 Chat UI Component Architecture

**User Story:** As a user, I want a polished chat experience with collapsible tool calls, clear permission/question dialogs, and streaming support, so that I can follow the agent's work without visual noise.

**Acceptance Criteria:**

##### 3.7.1 Message Rendering
1. THE SYSTEM SHALL render user, assistant, tool, and system messages with distinct visual styles
2. THE SYSTEM SHALL support streaming (partial) messages with a cursor indicator
3. THE SYSTEM SHALL render assistant messages as Markdown with syntax-highlighted code blocks, clickable file paths, and media previews

##### 3.7.2 Tool Call Display
1. THE SYSTEM SHALL render tool-use messages as collapsible cards, collapsed by default
2. WHEN collapsed, THE SYSTEM SHALL display the tool name, a one-line input summary (e.g. file path, command, search query), and a status indicator
3. WHEN expanded, THE SYSTEM SHALL display the full tool input and output in monospace font
4. THE SYSTEM SHALL show a spinner for in-progress tool calls and a checkmark for completed ones

##### 3.7.3 Question Handling
1. WHEN the agent sends a question request (`task:question_request`), THE SYSTEM SHALL display a modal dialog with the question text, selectable options, and an optional free-text input
2. THE SYSTEM SHALL support both single-select and multi-select question options
3. THE SYSTEM SHALL allow the user to submit or cancel the question response

##### 3.7.4 Component Decomposition
1. THE SYSTEM SHALL decompose the chat view into focused components: MessageList, MessageBubble, ToolCallCard, PermissionModal, QuestionDialog, ChatInput, and ThinkingIndicator
2. THE SYSTEM SHALL keep all Tauri event subscriptions in the page-level component (Execution.tsx) and pass state to child components via props
```

## UPDATE_LOG.md Entry

```markdown
## v0.4.5

- **3.7 Chat UI Component Architecture** -- Rewrote the monolithic Execution.tsx into modular chat components (MessageList, MessageBubble, ToolCallCard, PermissionModal, QuestionDialog, ChatInput, ThinkingIndicator). Tool-use messages now render as collapsible cards showing tool name and input summary when collapsed, full input/output when expanded. Added `task:question_request` event handling with a dedicated question dialog. Streaming, permissions, and all existing functionality preserved.
```

---

## Verification

After implementation:

1. `pnpm typecheck` must pass
2. `cd src-tauri && cargo check` must pass (no Rust changes expected)
3. `pnpm dlx ultracite fix src/` for formatting
4. Manual test: start a task, verify streaming text, tool calls collapse/expand, permission modal works, follow-up input works

