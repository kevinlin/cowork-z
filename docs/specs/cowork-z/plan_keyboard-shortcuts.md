# Plan: Keyboard Shortcuts (Requirement 6)

## Context

The requirements specify two groups of keyboard shortcuts:
- **6.1 App-Level** — `Cmd+,`/`Ctrl+,` (open settings), `Cmd+N`/`Ctrl+N` (new task)
- **6.2 Chat Shortcuts** — `Cmd+Enter`/`Ctrl+Enter` (send message), `Escape` (cancel running task)

Previously, only `Cmd+K` (open task launcher) was implemented as a global shortcut in `App.tsx`. Settings and new task were button-click only. Message send used plain `Enter`. Cancel task was button-click only.

## Design Decisions

### 1. No new dependencies

The existing `window.addEventListener('keydown', ...)` pattern works well. Extended it rather than adding a library like `react-hotkeys-hook`. Keeps the bundle small and the pattern consistent.

### 2. Centralized hook for app-level shortcuts

Created a `useKeyboardShortcuts` hook that handles all global shortcuts (`Cmd+,`, `Cmd+N`, `Cmd+K`). Replaces the inline `useEffect` in `App.tsx` and consolidates shortcut logic in one place.

### 3. Chat shortcuts scoped to Execution.tsx

`Cmd+Enter` (send) and `Escape` (cancel) only apply during the chat view. Added as a `useEffect` in `Execution.tsx` rather than globally, to avoid conflicts when the user is on the Home page.

### 4. Settings visibility hoisted to Zustand store

`showSettings` state was moved from `Sidebar.tsx` local state to the Zustand `taskStore` so both `App.tsx` (for `Cmd+,` shortcut) and `Sidebar.tsx` (for button click) can access it. The `SettingsDialog` component was moved from `Sidebar.tsx` to `App.tsx` render tree.

### 5. Cmd+Enter as additional send trigger

`Cmd+Enter` was added to the follow-up input in `Execution.tsx` as an **additional** trigger alongside plain `Enter`. The initial `TaskInputBar` on the Home page keeps `Enter` to submit — it's not a "chat view" per the requirement (section 6.2 says "within the chat view").

### 6. Escape guard for permission dialogs

The `Escape` handler checks that no permission dialog is active (`permissionRequest !== null`) before cancelling the task. This prevents accidental task cancellation when the user is dismissing a dialog.

## Implementation Steps

### Step 1: Add `showSettings` to Zustand store

**File: `src/stores/taskStore.ts`**

Added `showSettings: boolean` and `setShowSettings: (show: boolean) => void` to the `TaskState` interface and store implementation. Also added to `reset()`.

### Step 2: Update Sidebar to use store for settings state

**File: `src/components/layout/Sidebar.tsx`**

- Removed local `useState(false)` for `showSettings`
- Read `setShowSettings` from store (Sidebar only needs the setter for the button click)
- Removed `SettingsDialog` from Sidebar render tree (moved to `App.tsx`)
- Removed unused `SettingsDialog` import

### Step 3: Create `useKeyboardShortcuts` hook

**File: `src/hooks/useKeyboardShortcuts.ts`** (new)

A reusable hook that registers global `keydown` listeners for:
- `Cmd+,` / `Ctrl+,` — calls `openSettings()`
- `Cmd+N` / `Ctrl+N` — calls `newTask()`
- `Cmd+K` / `Ctrl+K` — calls `openLauncher()`

Uses `useMemo` to stabilize the actions reference and avoid unnecessary re-subscriptions.

### Step 4: Wire hook into App.tsx

**File: `src/App.tsx`**

- Imported and called `useKeyboardShortcuts` with `useCallback`-wrapped handlers
- Removed the existing inline `Cmd+K` useEffect
- Added `SettingsDialog` to the render tree (next to `TaskLauncher`)
- `handleOpenSettings`: calls `analytics.trackOpenSettings()` + `setShowSettings(true)`
- `handleNewTask`: calls `analytics.trackNewTask()` + `navigate('/')`

### Step 5: Add Escape and Cmd+Enter shortcuts to Execution.tsx

**File: `src/pages/Execution.tsx`**

Added a `useEffect` after `handleFollowUp` that listens for:
- `Escape` — calls `interruptTask()` when task is running and no permission dialog is showing
- `Cmd+Enter` / `Ctrl+Enter` — calls `handleFollowUp()` via a ref when follow-up is available

Uses `handleFollowUpRef` pattern to avoid stale closures without adding `handleFollowUp` to the dependency array.

### Step 6: Update requirements.md

**File: `docs/specs/cowork-z/requirements.md`**

- Marked `6.1 App-Level Shortcuts` as ✅
- Marked `6.2 Chat Shortcuts` as ✅
- Removed the "App-Level Keyboard Shortcuts" item from Outstanding Feature TODO list

## Files Modified (summary)

| Layer | File | Change |
|-------|------|--------|
| Store | `src/stores/taskStore.ts` | Add `showSettings` / `setShowSettings` |
| Hook | `src/hooks/useKeyboardShortcuts.ts` | **New** — centralized app-level shortcuts |
| App | `src/App.tsx` | Wire hook, add SettingsDialog, remove inline Cmd+K |
| Sidebar | `src/components/layout/Sidebar.tsx` | Use store for settings state, remove SettingsDialog |
| Chat | `src/pages/Execution.tsx` | Add Escape + Cmd+Enter useEffect |
| Docs | `docs/specs/cowork-z/requirements.md` | Mark 6.1, 6.2 as complete |
| Docs | `docs/specs/cowork-z/plan_keyboard-shortcuts.md` | **New** — this plan |

## Verification

1. `pnpm typecheck` — passed
2. `pnpm test --run` — all 49 tests passed (5 test files)
3. Manual testing checklist:
   - `Cmd+,` opens settings from any page
   - `Cmd+N` navigates to home (new task)
   - `Cmd+K` opens task launcher
   - `Escape` cancels running task in chat view (not during permission dialog)
   - `Cmd+Enter` sends follow-up message in chat view
