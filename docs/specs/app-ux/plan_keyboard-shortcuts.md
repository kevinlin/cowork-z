# Plan: Keyboard Shortcuts (Requirement 6 + 4.3.3)

## Context

The requirements specify two groups of keyboard shortcuts:
- **6.1 App-Level** — `Cmd+,`/`Ctrl+,` (open settings), `Cmd+N`/`Ctrl+N` (new task)
- **6.2 Chat Shortcuts** — `Cmd+Enter`/`Ctrl+Enter` (send message), `Escape` (cancel running task)
- **4.3.3 Keyboard Shortcuts Help** — A modal listing all shortcuts, triggered by `Shift+?` or Help menu

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

**File: `docs/specs/requirements.md`**

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
| Docs | `docs/specs/requirements.md` | Mark 6.1, 6.2 as complete |
| Docs | `docs/specs/app-ux/plan_keyboard-shortcuts.md` | **New** — this plan (includes Part 2: Help Modal) |

## Verification

1. `pnpm typecheck` — passed
2. `pnpm test --run` — all 49 tests passed (5 test files)
3. Manual testing checklist:
   - `Cmd+,` opens settings from any page
   - `Cmd+N` navigates to home (new task)
   - `Cmd+K` opens task launcher
   - `Escape` cancels running task in chat view (not during permission dialog)
   - `Cmd+Enter` sends follow-up message in chat view

---

## Part 2: Keyboard Shortcuts Help Modal (Requirement 4.3.3)

### Context

Users have no way to discover available keyboard shortcuts. This adds a "Keyboard Shortcuts" modal triggered by `Shift+?` or the Help menu, displaying all shortcuts in a categorized list. Escape dismisses the modal.

### Requirement Addition

Add **4.3.3 Keyboard Shortcuts Help** to `docs/specs/requirements.md`:

```
##### 4.3.3 Keyboard Shortcuts Help
1. THE SYSTEM SHALL display a modal dialog listing all keyboard shortcuts, grouped by category (App, Chat)
2. THE SYSTEM SHALL trigger the modal via `Shift+?` keyboard shortcut or Help > Keyboard Shortcuts menu item
3. THE SYSTEM SHALL dismiss the modal when the user presses Escape or clicks outside
4. THE SYSTEM SHALL display platform-appropriate modifier keys (⌘ on macOS, Ctrl on Windows/Linux)
```

### Implementation Steps

#### 1. Zustand store — add toggle state
**File:** `src/stores/taskStore.ts`

Add alongside `showAbout`:
- Interface: `showKeyboardShortcuts: boolean` + `setShowKeyboardShortcuts: (show: boolean) => void`
- Implementation: `showKeyboardShortcuts: false, setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show })`
- Reset: `showKeyboardShortcuts: false`

#### 2. Create dialog component
**New file:** `src/components/layout/KeyboardShortcutsDialog.tsx`

Follow the `AboutDialog.tsx` pattern — `{ open, onOpenChange }` props, shadcn `Dialog`.

- Platform detection: `const isMac = /Mac/.test(navigator.platform)` at module level
- Static `SHORTCUT_GROUPS` array with two categories:
  - **App:** `Cmd/Ctrl + ,` (Settings), `Cmd/Ctrl + N` (New Task), `Cmd/Ctrl + K` (Task Launcher), `Shift + ?` (Shortcuts Help)
  - **Chat:** `Enter` (Send Message), `Shift + Enter` (New Line), `Esc` (Cancel Task)
- `<kbd>` element for each key with muted styling
- `max-w-sm` — compact since it's just a reference list

#### 3. Update keyboard shortcuts hook
**File:** `src/hooks/useKeyboardShortcuts.ts`

- Add `openKeyboardShortcuts` to `ShortcutActions` interface
- Add `Shift+?` handler **before** the `if (!mod) return` guard, since `?` has no Cmd/Ctrl
- Guard against firing in inputs/textareas: skip when `e.target` is `INPUT`, `TEXTAREA`, or `contentEditable`
- Update `useMemo` deps array to include `actions.openKeyboardShortcuts`

#### 4. Add Rust menu item
**File:** `src-tauri/src/lib.rs`

- Add `keyboard_shortcuts_item` MenuItemBuilder with id `"show-keyboard-shortcuts"`
- Insert into `help_menu` before the separator
- Add match arm in `on_menu_event`: emit `"show-keyboard-shortcuts"` event

#### 5. Wire up in App.tsx
**File:** `src/App.tsx`

- Import `KeyboardShortcutsDialog`
- Destructure `showKeyboardShortcuts`, `setShowKeyboardShortcuts` from store
- Add `useEffect` listener for `'show-keyboard-shortcuts'` Tauri event
- Add `handleOpenKeyboardShortcuts` callback, pass to `useKeyboardShortcuts`
- Render `<KeyboardShortcutsDialog>` alongside other dialogs

#### 6. Add tests
**New file:** `src/components/layout/__tests__/KeyboardShortcutsDialog.test.tsx`

- Renders all categories and shortcut descriptions when open
- Does not render content when closed
- Displays `<kbd>` elements for keys

### Files Changed (Part 2)

| File | Change |
|------|--------|
| `src/stores/taskStore.ts` | Add `showKeyboardShortcuts` state |
| `src/components/layout/KeyboardShortcutsDialog.tsx` | **New** — dialog component |
| `src/hooks/useKeyboardShortcuts.ts` | Add `Shift+?` handler + input guard |
| `src-tauri/src/lib.rs` | Add menu item + event emission |
| `src/App.tsx` | Wire menu event, hook action, render dialog |
| `src/components/layout/__tests__/KeyboardShortcutsDialog.test.tsx` | **New** — tests |
| `docs/specs/requirements.md` | Add requirement 4.3.3 |

### Verification (Part 2)

1. `pnpm typecheck` — passes
2. `cd src-tauri && cargo check` — passes
3. `pnpm test --run` — passes (including new tests)
4. Manual: `Shift+?` on home page opens modal; typing `?` in chat input does NOT; Help menu item works; Escape dismisses
