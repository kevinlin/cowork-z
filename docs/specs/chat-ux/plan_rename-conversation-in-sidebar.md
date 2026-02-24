# Plan: Rename Conversation in Sidebar

## Context

Users currently have no way to rename conversations in the sidebar. Each conversation displays `task.summary || task.prompt`, where `summary` is AI-generated. Users want to manually rename conversations for better organization. The backend already supports this — `setTaskSummary()` in the store persists to SQLite via the existing `save_task_summary` Tauri command. This is a frontend-only change.

## Approach: Context Menu + Inline Editing

Right-click a conversation to open a context menu with "Rename" and "Delete" options. Selecting "Rename" switches the label to an inline text input for editing in place. The existing hover-reveal X delete button is kept as-is for quick delete.

## Changes

### 1. Modify `ConversationListItem.tsx` ✅
**File:** [src/components/layout/ConversationListItem.tsx](src/components/layout/ConversationListItem.tsx)

- Add `isRenaming` state and a `useRef` for the input element
- Wrap the existing `<div>` with `<DropdownMenu>` using a right-click trigger (`onContextMenu`)
- Suppress the Radix default left-click open via `onPointerDown` — the context menu must only open on right-click
- Context menu items: **Rename** (Pencil icon) and **Delete** (Trash2 icon, destructive variant)
- Move the existing delete-with-confirmation logic to the context menu "Delete" item (keep the hover X button too)
- When "Rename" is selected:
  - Set `isRenaming = true`
  - Replace the `<span>` label with an `<input>` pre-filled with `task.summary || task.prompt`
  - Auto-focus and select all text via `requestAnimationFrame` (deferred so Radix menu teardown completes first)
  - The `<input>` must **not** use `truncate` (it hides the text cursor via `overflow: hidden`) — use `caret-foreground` for visible cursor
  - The `<input>` `onKeyDown` must call `stopPropagation()` so Radix doesn't intercept standard text-editing shortcuts (Ctrl+A, arrow keys, etc.)
  - On **Enter** or **blur**: call `setTaskSummary(task.id, newName.trim())` if the value changed, then set `isRenaming = false`
  - On **Escape**: cancel rename without saving (handled on both the `<input>` and the outer `<div>` for robustness)

**Imports to add:** `Pencil`, `Trash2` from lucide-react; `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from `@/components/ui/dropdown-menu`; `useRef` from react.

### 2. Update `requirements.md` ✅
**File:** [docs/specs/requirements.md](docs/specs/requirements.md)

Add under `### 3. Chat Experience`, after section 3.8:

```
#### 3.9 Conversation Rename

**User Story:** As a user, I want to rename conversations in the sidebar so that I can organize my chat history with meaningful names.

**Acceptance Criteria:**
1. THE SYSTEM SHALL display a context menu when the user right-clicks a conversation item in the sidebar
2. THE CONTEXT MENU SHALL include a "Rename" option and a "Delete" option
3. WHEN the user selects "Rename", THE SYSTEM SHALL replace the conversation label with an inline text input pre-filled with the current name
4. WHEN the user confirms the rename (Enter or blur), THE SYSTEM SHALL persist the new name to the database
5. WHEN the user cancels the rename (Escape), THE SYSTEM SHALL restore the original name without saving
```

### 3. Update `UPDATE_LOG.md` ✅
**File:** [UPDATE_LOG.md](UPDATE_LOG.md)

Add under `## v0.5.10`:
```
- **Rename Conversations** — Right-click a conversation in the sidebar to rename it via inline editing
```

## Existing Code to Reuse

| What | Where |
|------|-------|
| `setTaskSummary(taskId, summary)` | [src/stores/taskStore.ts](src/stores/taskStore.ts) (store action, persists to DB) |
| `saveTaskSummary(taskId, summary)` | [src/lib/tauri-api.ts](src/lib/tauri-api.ts) (Tauri invoke) |
| `update_task_summary()` | [src-tauri/src/db/tasks.rs](src-tauri/src/db/tasks.rs) (Rust DB function) |
| `DropdownMenu` components | [src/components/ui/dropdown-menu.tsx](src/components/ui/dropdown-menu.tsx) |
| `Dialog` components | [src/components/ui/dialog.tsx](src/components/ui/dialog.tsx) (already used for delete confirmation) |

No new Tauri commands, store actions, or database changes are needed.

## Verification

1. `pnpm typecheck` — passes
2. `pnpm ultracite:check src/` — no lint errors
3. Manual test in `pnpm tauri dev`:
   - Right-click a conversation → context menu appears with "Rename" and "Delete"
   - Left-click a conversation → navigates to the task (does NOT open context menu)
   - Click "Rename" → label becomes editable input with all text pre-selected and cursor visible
   - Ctrl+A / Cmd+A selects all text; arrow keys, Home/End work normally in the input
   - Type new name + Enter → name persists (visible after app restart)
   - Press Escape during rename → reverts to original name
   - Click "Delete" from context menu → shows confirmation dialog
   - Hover X button still works for quick delete
