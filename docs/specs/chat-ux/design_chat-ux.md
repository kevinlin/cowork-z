# Chat Experience — Design Document

## Overview

The chat experience layer handles everything the user sees and interacts with during an agent session: message rendering, streaming updates, tool call display, permission/question dialogs, input handling (text, drag-and-drop, slash commands), and sidebar panels (todos, artefacts). It sits between the Zustand state layer and the React component tree, consuming events from the Tauri backend and rendering them as a rich conversational interface.

---

## Message Architecture

### Message Types

The chat renders four distinct message types with visual differentiation:

| Type | Visual Style | Content |
|------|-------------|---------|
| `user` | Right-aligned bubble | User's prompt text |
| `assistant` | Left-aligned bubble, markdown-rendered | Agent's response with rich content |
| `tool` | Collapsible card | Tool name, input summary, output |
| `system` | Subtle inline text | System notifications |

### Message Lifecycle

Messages flow through three stages:

1. **Partial (streaming)** — Arrives via `task_message_partial` events. Stored in `partialMessages` Map (Zustand). Rendered with a cursor indicator showing active streaming.
2. **Complete** — Arrives via `task_message_complete` events. Triggers `finalizePartialMessage` which persists to SQLite and moves the message from `partialMessages` to the completed `messages` array.
3. **Persisted** — Loaded from SQLite on task reload via `loadTaskById`.

The `MessageList` component merges completed messages with partials:

```typescript
const messagesToRender = useMemo((): RenderableMessage[] => {
    const completed = messages || [];
    const partials = Array.from(partialMessages.values());
    const partialIds = new Set(partials.map((p) => p.id));
    const filteredCompleted = completed.filter((m) => !partialIds.has(m.id));
    const combined = [...filteredCompleted, ...partials];
    return combined.sort((a, b) => ...);
}, [messages, partialMessages]);
```

### Intermediate Message Persistence

Multi-step agent turns produce multiple assistant messages (e.g., think → tool → think → tool → final). The `finalizePartialMessage` function persists **all** assistant messages, not just the last one (see [Resolved Issue: Intermediate Messages Not Persisted](#resolved-intermediate-messages-not-persisted)):

- When a `task_message_complete` event arrives with `event.text` content, the message is persisted even if no `partialMessages` entry exists (handles intermediate messages where streaming deltas may not have arrived before the complete event).
- The sidecar emits `message-complete` between messages within a single turn (not just at session idle), ensuring each intermediate message is finalized before the next begins.

### Streaming Partial Message Deduplication

During multi-step agentic turns, the sidecar's `textAccumulator` is reset between messages to prevent cascading duplicate content (see [Resolved Issue: Streaming Partial Message Duplication](#resolved-streaming-partial-message-duplication)). When a new `message.updated` event arrives for a different assistant message, the previous message's accumulated text is finalized via `message-complete` and the accumulator is cleared. This ensures each streaming message bubble shows only its own content.

---

## Message Rendering

### Markdown Rendering

> **Plan:** [Chat UI Rewrite](plan_chat_ui_rewrite.md)

Assistant messages are rendered as Markdown via `ReactMarkdown` with `remarkGfm` (GitHub Flavored Markdown). The rendering pipeline:

```
message.content → normalizeMarkdownBlocks() → enrichContentWithLinks() → ReactMarkdown + remarkGfm → Rendered HTML
```

### Markdown Block Normalization

LLMs frequently omit blank lines before block-level markdown elements (tables, code fences, headings). A normalization function (`normalizeMarkdownBlocks`) ensures correct parsing by inserting blank lines before:

1. **Tables** — Lines starting with `|` followed by a separator row (`|---|`)
2. **Fenced code blocks** — Opening `` ``` ``
3. **Headings** — Lines starting with `#`

The normalizer skips content inside fenced code blocks to avoid corruption. This is a display-layer concern — the raw content is preserved as-is in the database.

### Rich File & URL Display

> **Plan:** [Rich File & URL Display](plan_rich-file-url-display-in-chat.md)

- File paths in agent messages render as clickable links with file-type icons. Clicking opens the in-app file preview panel.
- URLs render as clickable links with an icon. Clicking opens the OS default browser.
- Image and video file paths show thumbnail previews at the bottom of the message bubble. Clicking opens the file preview panel.

---

## Tool Call Display

> **Plan:** [Chat UI Rewrite](plan_chat_ui_rewrite.md)

Tool-use messages render as collapsible cards:

- **Collapsed (default):** Tool name, one-line input summary (file path, command, search query), status indicator (spinner for in-progress, checkmark for completed)
- **Expanded:** Full tool input and output in monospace font

The `ToolCallCard` component handles the collapse/expand toggle and status rendering.

---

## Question & Permission Dialogs

### Question Dialog

> **Plan:** [Chat UI Rewrite](plan_chat_ui_rewrite.md)

When the agent sends a `task:question_request` event, a modal dialog appears with:
- Question text
- Selectable options (single-select by default)
- Optional free-text input
- Submit and cancel buttons

**Multi-select support:** When the OpenCode server sends `multiple: true`, the dialog shows checkbox indicators, "Select one or more options" helper text, and a count badge on the submit button when 2+ options are selected.

### Permission Dialog

When the agent needs file/command access outside the workspace, a permission dialog shows:
- Requested path
- Access level (read or read-write)
- Allow/Deny buttons

Multiple concurrent permission requests (from parallel tool calls) are queued and presented in order. Approving a pattern auto-approves matching queued/subsequent requests.

---

## Chat Input

### Multi-Line Text Input

- Multi-line textarea for all chat input areas (task launcher and follow-up input)
- `Shift+Enter` inserts newlines; `Enter` submits the message
- Auto-resize up to a maximum height

### Drag-and-Drop Support

> **Plan:** [Drag-and-Drop in Chat](plan_drag-and-drop-support.md)

**Important:** Tauri 2.x intercepts ALL drag events at the native webview level. HTML5 `dragover`, `dragleave`, and `drop` DOM events never fire for intra-webview drags. The implementation uses a module-level variable pattern:

1. On `dragStart`: store the payload in a module-level variable
2. On Tauri `onDragDropEvent` `drop`: if `paths` is empty, check the module-level variable for intra-app payload
3. Export getter/setter functions for drop targets to consume

Files dropped from the OS file manager or the sidebar file tree are inserted as `@path/to/file` at the cursor position. Paths with spaces are wrapped in quotes.

### Slash Command Skill Invocation

> **Plan:** [Slash Command Skill Invocation](plan_slash-command-skill-invocation.md)

Typing `/` at the start of input triggers a popover autocomplete menu listing installed skills. Features:
- Real-time filtering by name, ID, and description (case-insensitive)
- Selection via click or Tab key
- Selected skill renders as a visual pill/chip above the textarea
- One skill per message
- Prompt constructed as `/<skill-id> <user-text>` on submission

---

## Conversation Management

### Conversation Rename

> **Plan:** [Rename Conversation in Sidebar](plan_rename-conversation-in-sidebar.md)

Right-clicking a conversation in the sidebar shows a context menu with "Rename" and "Delete" options. Rename replaces the label with an inline text input. The implementation handles Radix UI focus-stealing by checking `e.relatedTarget` in blur handlers and deferring state changes past menu teardown.

### Stop/Cancel Task

Clicking the Stop button or pressing `Escape` during a running task sends `abort_session` to the sidecar with the session's `directory` parameter. The `task:started` event provides the `sessionId` to the frontend early in the session lifecycle, enabling abort at any point during execution (see [Resolved Issue: Stop Button](#resolved-stop-button)).

---

## Sidebar Panels

### Todo Panel

> **Plan:** [Todo Panel in Sidebar](../app-ux/plan_todo-panel-in-sidebard.md)

Wires OpenCode's todo API (`GET /session/{sessionID}/todo`) and real-time SSE events (`todo.updated`) through all five layers of the stack (OpenCode SSE → Sidecar → Rust → Frontend). Renders the agent's planned and in-progress work items with status icons and a progress bar.

- Sorted by status: in-progress first, then pending, completed, cancelled
- Auto-expands when new todos arrive during a task

### Artefacts Panel

> **Plan:** [Artefacts Panel](../app-ux/plan_artefacts-panel.md)

Collects all files the agent creates or modifies during a session and displays them in a sidebar panel. Files are clickable (opens in the in-app file preview panel) and the artefact list is restored when a session is resumed.

---

## Component Architecture

> **Plan:** [Chat UI Rewrite](plan_chat_ui_rewrite.md)

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `Execution.tsx` | `src/pages/` | Page-level Tauri event subscriptions, state management |
| `MessageList.tsx` | `src/components/chat/` | Merge completed + partial messages, scroll management |
| `MessageBubble.tsx` | `src/components/chat/` | Individual message rendering (markdown, media) |
| `ToolCallCard.tsx` | `src/components/chat/` | Collapsible tool call display |
| `PermissionModal.tsx` | `src/components/chat/` | Permission request dialog |
| `QuestionDialog.tsx` | `src/components/chat/` | Agent question dialog (single/multi-select) |
| `ChatInput.tsx` | `src/components/chat/` | Follow-up input with drag-drop and slash commands |
| `ThinkingIndicator.tsx` | `src/components/chat/` | Streaming/thinking state visualization |

All Tauri event subscriptions are kept in `Execution.tsx` and state is passed to child components via props.

---

## Key Source Locations

| Path | Purpose |
|------|---------|
| `src/pages/Execution.tsx` | Chat view page, event subscriptions |
| `src/components/chat/` | All chat UI components |
| `src/components/markdown/` | Rich message rendering (EnhancedLink, file/URL detection) |
| `src/components/media/` | Image/video thumbnails and modals |
| `src/lib/markdown-normalize.ts` | Markdown block normalization utility |
| `src/stores/taskStore.ts` | Task state, partial messages, event handling |
| `src/hooks/useSkillAutocomplete.ts` | Slash-command skill autocomplete |

---

## Resolved Issues

### Resolved: Stop Button Does Not Work {#resolved-stop-button}

**Problem:** Clicking the Stop button (or pressing Escape) during a running task had no effect. The agent continued executing and the UI stayed in the "running" state.

**Root Cause (chain of failure):**

1. `startTask` returns `session_id: None` — The Rust command returns `None` because the session hasn't been created yet at that point.
2. `task:started` event emitted but never consumed — The sidecar emits `task_started` with `{ taskId, sessionId }`, but the frontend's `onTaskUpdate` only listened for `task:update`, `task:message`, `task:progress`, `task:complete`, and `task:error` — **not** `task:started`.
3. `interruptTask` has no `sessionId` — Without a `sessionId`, the code falls through to `cancelTask`, which sends `cancel_task` — a no-op in server mode.

**Secondary issue:** Even when `abortSession` was called, the `directory` parameter was not passed to the OpenCode API (unlike `replyToPermission` and `replyToQuestion` which both extract `managed?.session?.directory`).

**Fix:**

- `tauri-api.ts` — Added `task:started` listener in `onTaskUpdate` that extracts `taskId` and `sessionId`
- `task.ts` — Added `'started'` to `TaskUpdateEvent.type` union
- `taskStore.ts` — Handles `started` events: sets `sessionId` on current task, updates status to `'running'`, persists `sessionId` to DB. Widened `interruptTask` status guard to include `'starting'`.
- `session-manager.ts` — Passes `directory` to `abortSession`, matching the pattern used by `replyToPermission` and `replyToQuestion`

---

### Resolved: Long-Running Task False Failure

**Problem:** Long-running conversations (>10 minutes) showed false "Failed" status even though the agent was still executing successfully.

**Root Cause:** The `sendMessage` call in `SessionManager.startTask()` and `resumeSession()` was `await`ed with a 10-minute HTTP timeout. OpenCode's `POST /session/{id}/message` blocks until the entire agent turn completes (including tool execution, permission waits, multi-step reasoning). For complex tasks exceeding 10 minutes, the `AbortController` fires, the fetch throws, and the error propagates to `task_error` — while the SSE stream continues delivering events because the OpenCode session is still running.

There was also a race condition: if the session completes via SSE *before* `sendMessage` returns, `handleSessionIdle()` calls `cleanup()` (removing session from maps), then `sendMessage` returns/times-out, and the error propagates to emit `task_error` *after* `task_complete`.

**Fix:** The `sendMessage` HTTP response is not used for anything — all lifecycle events arrive via SSE. Changed to fire-and-forget:

- `session-manager.ts` — Changed `await this.client.sendMessage(...)` to fire-and-forget with local error logging (no error emission). If the session truly failed, the SSE stream delivers `session.error`.
- `opencode-client.ts` — Support no-timeout mode (`timeout: 0` skips `AbortController` creation)

---

### Resolved: Streaming Partial Message Duplication {#resolved-streaming-partial-message-duplication}

**Problem:** During multi-step agentic turns (think → tool → think → tool → think), streaming text messages appeared as multiple repeated blocks with cascading duplicate content instead of updating a single message in-place. Symptom: 4–5 assistant message bubbles, each containing progressively longer text repeating all prior messages' content.

**Root Cause (two bugs in `session-manager.ts`):**

1. **`textAccumulator` never resets between messages within one turn.** Deltas from message N get appended to leftover text from messages 1…N-1, producing `textSoFar` values that cascade.
2. **No `message-complete` emitted between messages within one turn.** `message-complete` was only emitted in `handleSessionIdle()` — when the entire session becomes idle. During a multi-step turn the session stays busy, so partial message 1 is never removed from the `partialMessages` Map, and the `MessageList` renders all partials as separate bubbles.

**Fix:** In the `message.updated` handler, before setting the new `currentMessageId`, finalize the previous message if text was accumulated:

```typescript
if (props.info.role === 'assistant') {
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

No frontend changes needed — `finalizePartialMessage` and the `MessageList` merge logic already handle the transition correctly.

---

### Resolved: Intermediate Assistant Messages Not Persisted {#resolved-intermediate-messages-not-persisted}

**Problem:** When an agent session produces multiple assistant messages (e.g., assistant text → tool calls → assistant text → tool calls → final), only the last assistant message and all tool messages were saved to SQLite. Intermediate assistant messages were lost, so resuming a session showed gaps in the conversation.

**Root Cause:** `finalizePartialMessage` in `taskStore.ts` is the only code path that persists assistant messages to the database. It has a guard:

```typescript
const partial = state.partialMessages.get(event.messageId);
if (!partial) {
  return { partialMessages: newPartialMessages };
}
```

This silently drops the DB save when no matching entry exists in the `partialMessages` Map. For intermediate messages, the `task_message_complete` event can arrive before any `task_message_partial` events (especially for short assistant messages), so no `partialMessages` entry exists and the save is skipped. The last message is saved because it typically has streaming deltas before the session goes idle.

**Fix:** Modified `finalizePartialMessage` to always persist the assistant message when `event.text` contains content, regardless of whether a `partialMessages` entry exists:

```typescript
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

---

### Resolved: Markdown Table Rendering

**Problem:** When the AI agent returns a markdown table immediately after prose text without a blank line separator, `remarkGfm` fails to parse it as a table. Per the GFM spec, a table must be preceded by a blank line to be recognized as a block-level element.

**Root Cause:** The raw `message.content` from the sidecar sometimes lacks proper blank-line separation before block-level markdown elements. Neither `enrichContentWithLinks()` nor ReactMarkdown fixes this.

**Fix:** Added a content normalization function (`normalizeMarkdownBlocks` in `src/lib/markdown-normalize.ts`) that ensures blank lines before GFM block elements. Runs in `MessageBubble.tsx` before the content reaches `enrichContentWithLinks()` and `ReactMarkdown`.

The normalizer:
- Splits content into lines and tracks fenced code block state
- For each line that starts a block element (table row `|`, fenced code `` ``` ``, heading `#`), checks if the previous line is non-empty text
- If so, inserts a blank line before the block element
- Table detection: a line starting with `|` is treated as a table start only if the next line is a separator row matching `/^\|[\s:|-]+\|$/`
- Content inside fenced code blocks is not modified (no false positives)

This is a display-layer concern — inserting blank lines before block elements never changes the semantic meaning of well-formed markdown, and the raw content is preserved as-is in the database.
