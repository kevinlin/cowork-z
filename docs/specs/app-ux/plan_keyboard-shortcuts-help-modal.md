# Plan: Keyboard Shortcuts Help Modal

## Context

Users have no way to discover available keyboard shortcuts. This adds a "Keyboard Shortcuts" modal triggered by `Shift+?` or the Help menu, displaying all shortcuts in a categorized list. Escape dismisses the modal.

## Requirement Addition

Add **4.3.3 Keyboard Shortcuts Help** to `docs/specs/requirements.md` (after line 419):

```
##### 4.3.3 Keyboard Shortcuts Help
1. THE SYSTEM SHALL display a modal dialog listing all keyboard shortcuts, grouped by category (App, Chat)
2. THE SYSTEM SHALL trigger the modal via `Shift+?` keyboard shortcut or Help > Keyboard Shortcuts menu item
3. THE SYSTEM SHALL dismiss the modal when the user presses Escape or clicks outside
4. THE SYSTEM SHALL display platform-appropriate modifier keys (⌘ on macOS, Ctrl on Windows/Linux)
```

## Implementation Steps

### 1. Zustand store — add toggle state
**File:** [taskStore.ts](src/stores/taskStore.ts)

Add alongside `showAbout` (line ~84):
- Interface: `showKeyboardShortcuts: boolean` + `setShowKeyboardShortcuts: (show: boolean) => void`
- Implementation (line ~357): `showKeyboardShortcuts: false, setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show })`
- Reset (line ~1147): `showKeyboardShortcuts: false`

### 2. Create dialog component
**New file:** `src/components/layout/KeyboardShortcutsDialog.tsx`

Follow the [AboutDialog.tsx](src/components/layout/AboutDialog.tsx) pattern — `{ open, onOpenChange }` props, shadcn `Dialog`.

- Platform detection: `const isMac = /Mac/.test(navigator.platform)` at module level
- Static `SHORTCUT_GROUPS` array with two categories:
  - **App:** `Cmd/Ctrl + ,` (Settings), `Cmd/Ctrl + N` (New Task), `Cmd/Ctrl + K` (Task Launcher), `Shift + ?` (Shortcuts Help)
  - **Chat:** `Enter` (Send Message), `Shift + Enter` (New Line), `Esc` (Cancel Task)
- `<kbd>` element for each key with muted styling
- `max-w-sm` — compact since it's just a reference list

### 3. Update keyboard shortcuts hook
**File:** [useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts)

- Add `openKeyboardShortcuts` to `ShortcutActions` interface
- Add `Shift+?` handler **before** the `if (!mod) return` guard (line 30), since `?` has no Cmd/Ctrl
- Guard against firing in inputs/textareas: skip when `e.target` is `INPUT`, `TEXTAREA`, or `contentEditable`
- Update `useMemo` deps array to include `actions.openKeyboardShortcuts`

### 4. Add Rust menu item
**File:** [lib.rs](src-tauri/src/lib.rs)

- Add `keyboard_shortcuts_item` MenuItemBuilder with id `"show-keyboard-shortcuts"` (line ~98, before `check_updates_item`)
- Insert into `help_menu` before the separator (line ~103)
- Add match arm in `on_menu_event` (line ~116): emit `"show-keyboard-shortcuts"` event

### 5. Wire up in App.tsx
**File:** [App.tsx](src/App.tsx)

- Import `KeyboardShortcutsDialog`
- Destructure `showKeyboardShortcuts`, `setShowKeyboardShortcuts` from store (line 40)
- Add `useEffect` listener for `'show-keyboard-shortcuts'` Tauri event (same pattern as line 96-106)
- Add `handleOpenKeyboardShortcuts` callback, pass to `useKeyboardShortcuts` (line 124-128)
- Render `<KeyboardShortcutsDialog>` alongside other dialogs (line ~245)

### 6. Add tests
**New file:** `src/components/layout/__tests__/KeyboardShortcutsDialog.test.tsx`

- Renders all categories and shortcut descriptions when open
- Does not render content when closed
- Displays `<kbd>` elements for keys

## Files Changed

| File | Change |
|------|--------|
| `src/stores/taskStore.ts` | Add `showKeyboardShortcuts` state |
| `src/components/layout/KeyboardShortcutsDialog.tsx` | **New** — dialog component |
| `src/hooks/useKeyboardShortcuts.ts` | Add `Shift+?` handler + input guard |
| `src-tauri/src/lib.rs` | Add menu item + event emission |
| `src/App.tsx` | Wire menu event, hook action, render dialog |
| `src/components/layout/__tests__/KeyboardShortcutsDialog.test.tsx` | **New** — tests |
| `docs/specs/requirements.md` | Add requirement 4.3.3 |

## Verification

1. `pnpm typecheck` — passes
2. `cd src-tauri && cargo check` — passes
3. `pnpm test --run` — passes (including new tests)
4. Manual: `Shift+?` on home page opens modal; typing `?` in chat input does NOT; Help menu item works; Escape dismisses
