# Plan: Todo Panel in Sidebar

## Context

The Sidebar's "Todos" CollapsibleSection was a placeholder showing "Coming soon...". The OpenCode server exposes a todo API (`GET /session/{sessionID}/todo`) and real-time SSE events (`todo.updated`) that provide a structured list of the agent's planned and in-progress work items. This plan wires that data through all five layers of the stack (OpenCode SSE → Sidecar → Rust → Frontend) and renders it inside the Sidebar's Todos collapsible section.

## Data Flow

```
OpenCode Server SSE (todo.updated)
  -> Sidecar EventStream (event-stream.ts) -- auto-emitted
    -> SessionManager (session-manager.ts) -- maps sessionID -> taskId
      -> Sidecar stdout JSON-line (index.ts) -- { type: 'todo_updated', taskId, payload }
        -> Rust SidecarManager (sidecar.rs) -- maps to Tauri event "task:todo_updated"
          -> Frontend tauri-api.ts -- onTodoUpdated() listener
            -> taskStore.ts -- todos Map<taskId, Todo[]>
              -> Sidebar.tsx -> CollapsibleSection -> TodoPanel component
```

Initial fetch path: `getSessionTodos()` invoke -> Rust -> Sidecar `get_session_todos` command -> OpenCode REST -> response emitted as `todo_updated` event.

## Implementation Steps

### Step 1: Add shared Todo type

**File: `src/shared/types/task.ts`**

### Step 2: Add sidecar IPC types

**File: `src-tauri/sidecar-opencode/src/types.ts`**
- Add `Todo` interface (same shape as frontend)
- Add `todo.updated` variant to `OpenCodeEvent` union
- Add `todo_updated` variant to `SidecarEvent` union
- Add `get_session_todos` variant to `SidecarCommand` union
- Add `TodoUpdatedPayload` interface: `{ todos: Todo[] }`

### Step 3: Add REST method to OpenCode client

**File: `src-tauri/sidecar-opencode/src/opencode-client.ts`**
- Add `getSessionTodos(sessionId, directory?)` method

### Step 4: Wire SSE event in SessionManager

**File: `src-tauri/sidecar-opencode/src/session-manager.ts`**
- Add `todo.updated` listener in `setupEventListeners()`

### Step 5: Wire sidecar main event relay + command handler

**File: `src-tauri/sidecar-opencode/src/index.ts`**
- SSE relay: `sessionManager.on('todo-updated', ...)` -> `send({ type: 'todo_updated', ... })`
- Command handler: `case 'get_session_todos'` -> fetch from OpenCode REST and emit

### Step 6: Add Rust event mapping + command

**File: `src-tauri/src/sidecar.rs`**
- `"todo_updated" => "task:todo_updated"` in event mapping
- `GetSessionTodos` variant in `SidecarCommand` enum

**File: `src-tauri/src/lib.rs`**
- `get_session_todos` Tauri command, registered in `invoke_handler`

### Step 7: Add frontend API functions

**File: `src/lib/tauri-api.ts`**
- `getSessionTodos(taskId, sessionId)` — invoke command
- `onTodoUpdated(callback)` — listen for `task:todo_updated` events

### Step 8: Add todos to Zustand store

**File: `src/stores/taskStore.ts`**
- `todos: Map<string, Todo[]>` state + `setTodos` action
- Global `onTodoUpdated` subscription
- Clear todos in `reset()`

### Step 9: Create TodoPanel component

**File: `src/components/sidebar/TodoPanel.tsx`**

A compact, memoized component designed for sidebar width:
- Thin progress bar with completed/total count
- Sorts by status: in_progress → pending → completed → cancelled
- Status icons: Circle (pending), Loader2 with spin (in_progress), CheckCircle2 (completed), XCircle (cancelled)
- Completed items: line-through + reduced opacity
- High priority: red `!` badge
- Text truncated to fit sidebar width
- Uses `cn()` from `@/lib/utils` and `lucide-react` icons

### Step 10: Integrate into Sidebar

**File: `src/components/layout/Sidebar.tsx`**

- Import `TodoPanel` and read todos from store: `useTaskStore((s) => s.todos.get(s.currentTask?.id ?? '') ?? EMPTY_TODOS)` (stable empty array to prevent unnecessary re-renders)
- Replace the "Coming soon..." placeholder in the Todos CollapsibleSection
- Use controlled open state (`todosOpen` + `useEffect`) to auto-expand when todos arrive — avoids component remounting
- Pass `open={todosOpen}` and `onOpenChange={setTodosOpen}` to `CollapsibleSection`

> **Bug fix (2026-02-08):** The original implementation used `key={String(hasTodos)}` to force a remount of `CollapsibleSection` when todos appeared. This caused the component to be destroyed and recreated, relying on `defaultOpen` (mount-time only) rather than reacting to live prop changes. If the user manually collapsed the section, subsequent todo updates would not re-expand it. Fixed by adding controlled mode support (`open` / `onOpenChange` props) to `CollapsibleSection` and using a `useEffect` in Sidebar that sets `todosOpen = true` when `hasTodos` transitions to `true`.

### Step 10b: Initial fetch in Execution page

**File: `src/pages/Execution.tsx`**

- Keep the `useEffect` that calls `getSessionTodos()` when session becomes available
- This populates the store so the Sidebar can display todos
- The TodoPanel JSX was removed from Execution.tsx — it now lives in Sidebar only

## Files Modified (summary)

| File | Type |
|------|------|
| `src/shared/types/task.ts` | Edit — add `Todo` interface |
| `src-tauri/sidecar-opencode/src/types.ts` | Edit — add Todo + update 3 union types |
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | Edit — add `getSessionTodos()` |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Edit — add `todo.updated` listener |
| `src-tauri/sidecar-opencode/src/index.ts` | Edit — wire event relay + command handler |
| `src-tauri/src/sidecar.rs` | Edit — add event mapping + command variant |
| `src-tauri/src/lib.rs` | Edit — add Tauri command |
| `src/lib/tauri-api.ts` | Edit — add 2 functions |
| `src/stores/taskStore.ts` | Edit — add todos state + action |
| `src/components/sidebar/TodoPanel.tsx` | New — compact sidebar-friendly layout (moved from `execution/`) |
| `src/components/sidebar/FoldersPanel.tsx` | Moved from `layout/` — no logic changes |
| `src/components/layout/CollapsibleSection.tsx` | Edit — add controlled `open` / `onOpenChange` props |
| `src/components/layout/Sidebar.tsx` | Edit — integrate TodoPanel, controlled open state |
| `src/pages/Execution.tsx` | Edit — remove TodoPanel JSX, keep initial fetch |

## Verification

1. **TypeScript**: `pnpm typecheck` — must pass
2. **Rust**: `cd src-tauri && cargo check` — must pass
3. **Sidecar**: `cd src-tauri/sidecar-opencode && pnpm build` — must pass
4. **Frontend tests**: `pnpm test --run` — must pass
5. **Sidecar tests**: `cd src-tauri/sidecar-opencode && pnpm test` — must pass

## Known Risks

- **SSE event shape**: Per project MEMORY.md, OpenCode SSE payloads sometimes differ from the API spec. The `todo.updated` properties may need adjustment after testing with a live server.
- **Sidebar width**: Todo item text is truncated to fit the narrow sidebar. Very long items may need tooltip on hover (future enhancement).
