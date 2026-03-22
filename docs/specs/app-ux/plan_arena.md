# Plan: Arena — Side-by-Side Agent Comparison

## Context

Users want to compare how different AI models tackle the same task. Arena lets a user type one prompt and have 3 agents (each using a different model) execute simultaneously in a 3-column layout. This enables model evaluation, output comparison, and finding the best model for a given task type.

Currently each task runs a single OpenCode session with the active provider's model. Arena extends this to run 3 independent sessions in parallel, each with a user-chosen model, sharing the same prompt and workspace.

---

## Design Decisions

1. **Arena = 3 independent tasks linked by a parent record.** Each Arena creates 3 real OpenCode sessions. An `arenas` table stores the shared metadata; each task gets an `arena_id` FK. This keeps the existing task infrastructure untouched.

2. **Dedicated `arenaStore.ts`** rather than extending `taskStore`. The existing store assumes a single `currentTask` with one partial message stream. Arena needs 3 concurrent streams. A separate store avoids contaminating the single-task model.

3. **Model override via `TaskConfig.modelId`.** The Rust `start_task` command currently resolves `model_id` from provider settings. Adding an optional `model_id` to `TaskConfig` lets Arena specify a different model per task. Backward-compatible — non-Arena tasks omit it.

4. **Sidecar concurrency via `skipConfig` flag.** The sidecar's `startTask()` currently cleans up all stale sessions and calls `PATCH /config` (which triggers SSE reconnection). Arena sends config once, then 3 `start_task` commands with `skipConfig: true` to avoid triple-reconnection and session cleanup.

5. **Implicit folder instruction prepended in Rust command.** Each task's prompt gets prefixed with "Create all files under `<model-name>/`..." so the 3 agents don't overwrite each other's files. The original prompt is stored on the `arenas` record for display.

6. **New route `/arena/:arenaId`** with a dedicated `ArenaPage`. Follows the same event-subscription pattern as `ExecutionPage` but routes events to the correct column by `taskId`.

---

## Implementation Steps

### Step 1: Database Migration (v5) — Arena Tables

**File: `src-tauri/src/db/migrations.rs`**
- Bump `CURRENT_VERSION` from 4 to 5
- Add `migrate_v5()`:
  ```sql
  CREATE TABLE arenas (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      workspace_id TEXT REFERENCES workspaces(id),
      created_at TEXT NOT NULL,
      completed_at TEXT
  );
  CREATE INDEX idx_arenas_workspace_id ON arenas(workspace_id);
  CREATE INDEX idx_arenas_created_at ON arenas(created_at DESC);

  ALTER TABLE tasks ADD COLUMN arena_id TEXT REFERENCES arenas(id);
  ALTER TABLE tasks ADD COLUMN arena_slot INTEGER;
  ALTER TABLE tasks ADD COLUMN model_id TEXT;
  CREATE INDEX idx_tasks_arena_id ON tasks(arena_id);
  ```

### Step 2: Arena DB Module

**New file: `src-tauri/src/db/arenas.rs`**
- `save_arena(conn, ArenaInput)` — insert arena row
- `get_arena_with_tasks(conn, arena_id)` — returns arena + its 3 tasks (JOIN)
- `get_arenas_by_workspace(conn, workspace_id)` — list for sidebar, ordered by `created_at DESC`
- `delete_arena(conn, arena_id)` — delete arena + cascade-delete tasks
- `update_arena_completed(conn, arena_id, completed_at)` — mark completion
- `save_task_arena_fields(conn, task_id, arena_id, arena_slot, model_id)` — set the arena FK + slot + model on a task

**File: `src-tauri/src/db/mod.rs`** — register `pub mod arenas;`

### Step 3: Rust Types

**File: `src-tauri/src/types.rs`**
- Add `model_id: Option<String>` to `TaskConfig`
- Add new types:
  ```rust
  pub struct ArenaConfig {
      pub prompt: String,
      pub models: Vec<ArenaModelConfig>,  // Exactly 3
  }
  pub struct ArenaModelConfig {
      pub model_id: String,          // e.g., "anthropic/claude-sonnet-4-5"
      pub display_name: String,      // e.g., "Claude Sonnet 4.5"
  }
  pub struct Arena {
      pub id: String,
      pub prompt: String,
      pub workspace_id: Option<String>,
      pub created_at: String,
      pub completed_at: Option<String>,
      pub tasks: Vec<Task>,          // Always 3, ordered by arena_slot
  }
  ```

- Add `arena_id: Option<String>`, `arena_slot: Option<i32>`, `model_id: Option<String>` to the `Task` struct

### Step 4: Rust Arena Commands

**New file: `src-tauri/src/commands/arena.rs`**

**`start_arena(config: ArenaConfig)`:**
1. Generate `arena_id` = `arena_<uuid>`
2. Create `arenas` row in DB
3. Resolve shared state: API keys, workspace dir, folder permissions, custom prompt, MCP servers (same logic as `start_task`)
4. Ensure sidecar is running
5. For each of 3 models (index 0, 1, 2):
   a. Generate `task_id` = `task_<uuid>`
   b. Save task row in DB with `arena_id`, `arena_slot`, `model_id`
   c. Prepend folder instruction to prompt:
      `"IMPORTANT: For any files you create, put them under a subfolder named '{display_name}/' in the workspace root to keep outputs separate from other agents.\n\n{original_prompt}"`
   d. Send `SidecarCommand::StartTask` with:
      - `model_id: Some(model_config.model_id)`
      - `skip_config: i > 0` (first task sends config, others skip)
      - `arena_id: Some(arena_id)` (prevents stale session cleanup)
6. Return `Arena { id, prompt, workspace_id, created_at, tasks: [task0, task1, task2] }`

**`resume_arena(arena_id: String, prompt: String)`:**
1. Load arena's 3 tasks from DB (need `session_id` and `model_id`)
2. Resolve shared state (API keys, perms, etc.)
3. For each task: send `SidecarCommand::ResumeSession` with:
   - The task's stored `model_id` (not None)
   - `skip_config: i > 0`
   - `arena_id: Some(arena_id)`
4. Update task statuses in DB
5. Return updated Arena

**`get_arena(arena_id: String)`** — fetch arena + tasks

**`list_arenas(workspace_id: Option<String>)`** — for sidebar

**`delete_arena(arena_id: String)`** — delete arena + tasks

**`abort_arena(arena_id: String)`** — abort all running sessions

**File: `src-tauri/src/lib.rs`** — register commands: `start_arena`, `resume_arena`, `get_arena`, `list_arenas`, `delete_arena`, `abort_arena`

### Step 5: Extend `start_task` for Model Override

**File: `src-tauri/src/commands/tasks.rs`**
- In `start_task()`, after resolving `resolved_model_id` from provider settings (line 17-50), add:
  ```rust
  // Allow frontend to override model (used by Arena)
  let final_model_id = config.model_id.or(resolved_model_id);
  ```
- Use `final_model_id` instead of `resolved_model_id` at line 151

### Step 6: Sidecar IPC Changes

**File: `src-tauri/src/sidecar.rs`**
- Add to `StartTaskPayload`:
  ```rust
  pub skip_config: Option<bool>,
  pub arena_id: Option<String>,
  ```
- Add to `ResumeSessionPayload`:
  ```rust
  pub skip_config: Option<bool>,
  pub arena_id: Option<String>,
  ```

**File: `src-tauri/sidecar-opencode/src/types.ts`**
- Add to `StartTaskPayload`: `skipConfig?: boolean; arenaId?: string;`
- Add to `ResumeSessionPayload`: `skipConfig?: boolean; arenaId?: string;`

### Step 7: Sidecar Session Manager Concurrency

**File: `src-tauri/sidecar-opencode/src/session-manager.ts`**

In `startTask()` (line 307-315):
- Replace blanket stale-session cleanup with arena-aware cleanup:
  ```typescript
  if (!payload.arenaId) {
    // Non-arena: clean up all stale sessions (existing behavior)
    const staleTaskIds = Array.from(this.sessions.keys()).filter(id => id !== taskId);
    for (const oldTaskId of staleTaskIds) {
      this.cleanup(oldTaskId);
    }
  }
  // Arena tasks: skip cleanup — all 3 must coexist
  ```
- Skip `updateConfig` if `skipConfig` is true:
  ```typescript
  if (!payload.skipConfig) {
    const config = buildSessionConfig({ modelId, folderPermissions, mcpServers });
    await this.client.updateConfig(config, workingDirectory);
  }
  ```

In `resumeSession()` (line 380-382):
- Same `skipConfig` guard for `updateConfig`

### Step 8: Frontend Types

**New file: `src/shared/types/arena.ts`**
```typescript
export interface ArenaConfig {
  prompt: string;
  models: ArenaModelConfig[];  // Exactly 3
}
export interface ArenaModelConfig {
  modelId: string;        // e.g., "anthropic/claude-sonnet-4-5"
  displayName: string;
}
export interface Arena {
  id: string;
  prompt: string;
  workspaceId?: string;
  createdAt: string;
  completedAt?: string;
  tasks: Task[];           // Always 3, ordered by arenaSlot
}
```

**File: `src/shared/types/task.ts`**
- Add to `TaskConfig`: `modelId?: string;`
- Add to `Task`: `arenaId?: string; arenaSlot?: number; modelId?: string;`

### Step 9: Tauri API — Arena Commands

**File: `src/lib/tauri-api.ts`**
- Add `startArena(config: ArenaConfig): Promise<Arena>`
- Add `resumeArena(arenaId: string, prompt: string): Promise<Arena>`
- Add `getArena(arenaId: string): Promise<Arena>`
- Add `listArenas(workspaceId?: string): Promise<Arena[]>`
- Add `deleteArena(arenaId: string): Promise<void>`
- Add `abortArena(arenaId: string): Promise<void>`

### Step 10: Arena Zustand Store

**New file: `src/stores/arenaStore.ts`**

State shape:
```typescript
type ArenaColumnIndex = 0 | 1 | 2;

interface ArenaColumnState {
  modelId: string | null;
  modelDisplayName: string;
  taskId: string | null;
  task: Task | null;
  status: TaskStatus | 'idle';
  partialMessages: Map<string, PartialMessage>;
  startupStage: StartupStageInfo | null;
  error: string | null;
}

interface ArenaState {
  arenaId: string | null;
  prompt: string;
  isRunning: boolean;
  columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState];

  // Unified permission/question queue
  permissionRequests: PermissionRequest[];
  permissionRequest: PermissionRequest | null;
  questionRequest: QuestionRequest | null;

  // Actions
  setColumnModel(index: ArenaColumnIndex, modelId: string, displayName: string): void;
  startArena(prompt: string): Promise<string>;  // returns arenaId
  sendFollowUp(message: string): Promise<void>;
  loadArena(arenaId: string): Promise<void>;
  handleTaskUpdate(taskId: string, event: TaskUpdateEvent): void;
  handlePartialMessage(event: PartialMessageEvent): void;
  handlePermissionRequest(request: PermissionRequest): void;
  respondToPermission(response: PermissionResponse): Promise<void>;
  abortAll(): Promise<void>;
  reset(): void;
}
```

Key logic:
- `taskIdToColumn` lookup: iterates `columns[0..2].taskId` to route events
- `startArena`: calls `api.startArena()`, updates column state from response
- `isRunning`: derived from `columns.some(c => ['starting', 'queued', 'running'].includes(c.status))`
- Event handlers mirror `taskStore` patterns but route to the correct column

### Step 11: Arena Page and Route

**File: `src/App.tsx`**
- Add route: `<Route path="/arena/:arenaId" element={<ArenaPage />} />`

**New file: `src/pages/Arena.tsx`**
- Reads `arenaId` from URL params
- On mount: calls `arenaStore.loadArena(arenaId)` if returning to existing arena
- Sets up Tauri event subscriptions (same pattern as `Execution.tsx`):
  - `onTaskUpdate`, `onTaskUpdateBatch`, `onPermissionRequest`, `onQuestionRequest`, `onTaskStatusChange`
  - All events routed through `arenaStore` handlers
- Renders: `ArenaInputBar` (top) + `ArenaColumns` (3-column body)
- Cleanup: unsubscribes all listeners on unmount

### Step 12: Arena Components

**New directory: `src/components/arena/`**

**`ArenaInputBar.tsx`** — Shared input at top of Arena page
- 3 model-picker trigger buttons in a row above the textarea, each showing `{providerName} / {modelName}` or "Select model" placeholder
- Clicking a model button opens `ArenaModelPickerDialog` for that column index
- `onModelSelected` callback calls `arenaStore.setColumnModel(index, modelId, displayName)`
- Textarea + Send button (same styling as `TaskInputBar`)
- On submit: if no arena started → `arenaStore.startArena(prompt)`; if existing → `arenaStore.sendFollowUp(prompt)`
- Disabled when all 3 agents are running
- "Stop All" button when running

**`ArenaColumns.tsx`** — 3-column flex container
- `flex flex-row gap-0` with thin borders between columns
- Renders 3 `ArenaColumn` components

**`ArenaColumn.tsx`** — Single agent column with rich message rendering
- Header: model name badge + status indicator (inline `StatusBadge`)
- Body: **Reuses `MessageBubble` from `src/components/chat/MessageBubble.tsx`** for full-featured message rendering:
  - Markdown parsing (ReactMarkdown + remark-gfm) for headings, bold, italics, tables, blockquotes, lists
  - Code block syntax highlighting with prose typography
  - URL and file path detection with clickable links (`EnhancedLink`)
  - Media gallery for images/videos (`MediaGallery`)
  - Tool call cards (`ToolCallCard`) for tool messages
  - Copy-to-clipboard button on hover
  - Bash tool messages filtered out (consistent with `Execution.tsx`)
- For **streaming/partial messages**: render `MessageBubble` with `isRealStreaming={partial.isStreaming}` and a synthetic `TaskMessage` object built from `partial.textSoFar`
- Remove the inline `MessageItem` and `PartialMessageItem` plain-text components — replace entirely with `MessageBubble`
- Independent scroll per column with auto-scroll-to-bottom behavior
- Messages rendered in a scrollable container; `MessageBubble` adapts its `max-w-4xl` to the column width

**`ArenaModelPickerDialog.tsx`** — Per-column model selection dialog
- Props: `open`, `onOpenChange`, `columnIndex`, `currentModelId`, `onModelSelected(modelId, displayName)`
- Uses `useProviderSettings()` hook (from `src/components/settings/hooks/useProviderSettings.ts`)
- Renders `ProviderGrid` for provider browsing; on selection, renders `ProviderSettingsPanel` below (same layout as `SettingsDialog`)
- Full provider connection + model selection UX: connect API keys, browse/search models
- "Select Model" button reads the provider's `selectedModelId`, calls `onModelSelected(fullModelId, displayName)`, and closes
- Reused components (no changes needed): `ProviderGrid.tsx`, `ProviderSettingsPanel.tsx`, `useProviderSettings.ts`, `ModelSelector.tsx`

**`ArenaColumnHeader.tsx`** — Column header with model name and status
- Model display name (or "Select model" placeholder)
- Status badge: idle / starting / running / completed / failed
- Colored status dot (matches sidebar status colors)

### Step 13: Home Page — Arena Entry Point

**File: `src/pages/Home.tsx`**
- Add a compact "Arena" button in the **top-right corner** of the Home page (absolute positioning)
- Button text: `Columns3` icon + "Arena" (short label only)
- Full description "Compare 3 models side-by-side" shown as a **tooltip on hover** (`title` attribute)
- Clicking navigates to `/arena/new` which shows the Arena setup UI (3 model pickers + input bar)
- Styling: subtle `border border-border bg-card/80` button that doesn't compete with the main task input
- Implementation: add `relative` to the page container div, place the button in an `absolute right-6 top-6` wrapper

### Step 14: Sidebar — Arena Session List

**File: `src/components/layout/Sidebar.tsx`**
- Load arenas via `api.listArenas(workspaceId)` alongside tasks
- Merge arenas and tasks by `createdAt` for **interleaved chronological display** (arena sessions appear alongside regular task sessions, sorted by `createdAt DESC`)
- Filter out tasks that have `arenaId` set (they belong to an arena, not standalone)
- Render `ArenaListItem` for arena entries

**New file: `src/components/layout/ArenaListItem.tsx`**
- **Visual differentiation via icon:** `Columns3` icon from lucide-react (instead of the message icon used by regular conversations)
- Shows arena prompt as display text (truncated), with full prompt in `title` tooltip
- Status indicator: `StatusDot` component — green (running), red (failed), gray (other)
- Running state: `Loader2` spinning icon replaces `Columns3`
- Derived status: running if any task running, completed if all done, failed if any failed
- Click navigates to `/arena/<arenaId>`
- Delete button: appears on hover with confirmation dialog
- Same styling pattern as `ConversationListItem` (hover background, active highlight, transition animations)

### Step 15: Update `taskStore` — Filter Arena Tasks

**File: `src/stores/taskStore.ts`**
- In `loadTasks()`: filter results to exclude tasks where `arena_id IS NOT NULL`
- Or: add a DB-level filter in `get_tasks_by_workspace` query: `WHERE arena_id IS NULL`

Rust side preferred — **File: `src-tauri/src/db/tasks.rs`**
- Modify `get_tasks_by_workspace` query to add `AND arena_id IS NULL`

### Step 16: Fix Arena Chat History Persistence

**Bug:** Sending a follow-up message in Arena resets the session — all previous messages disappear from the UI.

**Root causes:**
1. `arenaStore.ts` event handlers accumulated messages in memory but never called `api.saveTaskMessage()` / `api.saveTaskStatus()` / `api.saveTaskSession()` / `api.completeTask()` to persist them to SQLite. When `sendFollowUp()` called `api.resumeArena()`, the Rust backend loaded tasks from DB with empty message arrays.
2. `columnsFromArena()` created brand-new empty columns from the API response, discarding all in-memory messages and partials.
3. Sidecar `resumeSession()` didn't extract `arenaId` from the payload, a latent bug that could cause stale-session cleanup of sibling arena sessions.

**Fix — `src/stores/arenaStore.ts`:**
- Add `createMessageId()` helper (same pattern as `taskStore.ts`)
- Add fire-and-forget DB persistence calls in all event handlers:
  - `handleTaskUpdate`: `saveTaskMessage`, `completeTask`, `saveTaskSession` (mirrors `taskStore.ts:823-850`)
  - `handleTaskUpdateBatch`: `saveTaskMessage` for each message
  - `handlePartialMessageComplete`: `saveTaskMessage` for finalized message
  - `handleStatusChange`: `saveTaskStatus`
- `startArena`: create and persist initial user `TaskMessage` for each column after arena starts
- `sendFollowUp`: create and persist user `TaskMessage` for each column before calling `resumeArena`, set columns to `running` status immediately
- `columnsFromArena()`: preserve existing in-memory messages when `taskId` matches (follow-up case); only use DB messages when loading a different/new arena

**Fix — `src-tauri/sidecar-opencode/src/session-manager.ts`:**
- Extract `arenaId` from `ResumeSessionPayload` destructuring in `resumeSession()` (line 379)
- Include `arenaId` in the resume log for debugging

### Step 17: Fix Arena Question Request Handling

**Bug:** When an arena agent calls the `question` tool (e.g., to ask the user about an output folder), the question is silently dropped and the agent hangs waiting for a response.

**Root cause:** The Arena page subscribes to permission requests but never subscribes to `task:question_request` Tauri events. The `arenaStore` has no `questionRequest` state, no handler, and no UI — the event is broadcast globally by Rust but nothing on the Arena page listens for it. The normal Execution page handles this correctly via `api.onQuestionRequest` + `QuestionDialog`.

**Fix — `src/stores/arenaStore.ts`:**
- Import `QuestionRequest` from `@/shared`
- Add `questionRequest: QuestionRequest | null` state field
- Add `handleQuestionRequest(request)`: filter by arena column `taskId` (same guard as `handlePermissionRequest`), then set state
- Add `respondToQuestion(answers)`: call `api.replyToQuestion(taskId, requestId, answers)`, then clear state
- Add `cancelQuestion()`: clear state without replying
- Clear `questionRequest` in `reset()`, `loadArena()`, and `deleteArena()`

**Fix — `src/pages/Arena.tsx`:**
- Import `QuestionDialog` from `@/components/chat/QuestionDialog`
- Destructure `questionRequest`, `handleQuestionRequest`, `respondToQuestion`, `cancelQuestion` from store
- Add `api.onQuestionRequest` subscription in the event `useEffect` (alongside `onPermissionRequest`)
- Add `handleQuestionSubmit` and `handleQuestionCancel` callbacks
- Render `<QuestionDialog>` when `questionRequest` is non-null (below `PermissionModal`)

**No backend changes needed** — the existing `reply_to_question` Rust command and sidecar `replyToQuestion()` are task-ID-parameterized and already work for arena tasks.

---

## Files Modified (Summary)

| File | Type | Change |
|------|------|--------|
| `src-tauri/src/db/migrations.rs` | Edit | Add migration v5 (arenas table, task columns) |
| `src-tauri/src/db/arenas.rs` | New | Arena CRUD operations |
| `src-tauri/src/db/mod.rs` | Edit | Register arenas module |
| `src-tauri/src/db/tasks.rs` | Edit | Filter arena tasks from workspace list |
| `src-tauri/src/types.rs` | Edit | Add ArenaConfig, Arena types; extend TaskConfig, Task |
| `src-tauri/src/commands/arena.rs` | New | Arena command handlers |
| `src-tauri/src/commands/tasks.rs` | Edit | Support model_id override in start_task |
| `src-tauri/src/commands/mod.rs` | Edit | Register arena module |
| `src-tauri/src/sidecar.rs` | Edit | Add skip_config, arena_id to payloads |
| `src-tauri/src/lib.rs` | Edit | Register arena commands |
| `src-tauri/sidecar-opencode/src/types.ts` | Edit | Add skipConfig, arenaId fields |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Edit | Arena-aware cleanup + skipConfig |
| `src/shared/types/arena.ts` | New | Arena TypeScript types |
| `src/shared/types/task.ts` | Edit | Add arenaId, arenaSlot, modelId to Task/TaskConfig |
| `src/lib/tauri-api.ts` | Edit | Add arena API functions |
| `src/stores/arenaStore.ts` | New | Arena Zustand store (incl. question request handling) |
| `src/pages/Arena.tsx` | New | Arena page with event subscriptions (incl. question request + QuestionDialog) |
| `src/components/arena/ArenaInputBar.tsx` | New | Shared input bar |
| `src/components/arena/ArenaColumns.tsx` | New | 3-column layout container |
| `src/components/arena/ArenaColumn.tsx` | New | Single column — reuses `MessageBubble` for rich markdown rendering |
| `src/components/arena/ArenaColumnHeader.tsx` | New | Model name + status badge |
| `src/components/arena/ArenaModelPickerDialog.tsx` | New | Model selection dialog (reuses ProviderGrid + ProviderSettingsPanel) |
| `src/components/layout/ArenaListItem.tsx` | New | Sidebar arena entry |
| `src/components/layout/Sidebar.tsx` | Edit | Load & render arena items |
| `src/pages/Home.tsx` | Edit | Compact Arena button in top-right corner with tooltip |
| `src/App.tsx` | Edit | Add /arena/:arenaId route |

---

## Verification

1. `pnpm typecheck` — must pass
2. `cd src-tauri && cargo check` — must pass
3. `cd src-tauri/sidecar-opencode && pnpm build && pnpm test` — must pass
4. Manual testing — Arena entry point:
   - Open app → verify "Arena" button is in top-right corner of Home page
   - Hover over button → verify tooltip shows "Compare 3 models side-by-side"
   - Click button → navigates to `/arena/new`
5. Manual testing — Arena execution:
   - Select 3 different models in the column pickers
   - Submit a prompt → verify all 3 agents start and stream responses
   - Verify messages appear in correct columns
   - Verify **rich markdown rendering**: headings, code blocks, bold/italic, tables render correctly
   - Verify **clickable links**: URLs and file paths are clickable in Arena columns
   - Verify **streaming**: partial messages show with streaming animation, not plain text
   - Verify **tool messages**: tool calls render as `ToolCallCard`, bash tool messages are filtered out
   - Verify **copy button**: hover over assistant message shows copy-to-clipboard button
   - Verify permission requests show with column indicator
   - Verify question requests show `QuestionDialog` and agent resumes after reply
   - Send follow-up message → all 3 agents respond
   - Verify `abort_arena` stops all 3 agents
6. Manual testing — Sidebar:
   - Verify Arena appears in sidebar session list with `Columns3` icon (distinct from regular task icon)
   - Verify Arena sessions are interleaved chronologically with regular tasks
   - Click Arena in sidebar → returns to Arena view
   - Verify Arena tasks don't appear as separate items in sidebar
   - Verify non-Arena tasks still work normally
