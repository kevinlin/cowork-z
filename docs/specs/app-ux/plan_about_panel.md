# Plan: About Panel (Requirement 4.4)

## Context

The app currently has no native menu bar — all UI interactions go through the React frontend. The requirement calls for an About panel accessible via **Help > About** in the app menu, displaying the app version and a changelog from `UPDATE_LOG.md`.

## Approach

Add a native Tauri menu with standard macOS menus (App, Edit, Window) plus a **Help > About** item. Clicking it emits a Tauri event that opens a React dialog showing the version and changelog.

## Changes

### 1. Rust: Create native menu bar with Help > About
**File:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — inside the `.setup()` closure

- Import `tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem}` and `tauri::Emitter`
- Build a menu with standard submenus:
  - **App menu** (Cowork-Z): About (predefined), separator, Quit
  - **Edit**: Undo, Redo, separator, Cut, Copy, Paste, Select All
  - **Window**: Minimize, Close Window
  - **Help**: custom "About Cowork-Z" menu item with id `"show-about"`
- Call `app.set_menu(menu)?`
- Register `app.on_menu_event()` — when the `"show-about"` item is clicked, emit a `"show-about"` event to the frontend via `app.emit("show-about", ())`

### 2. Frontend: Add `showAbout` state to Zustand store
**File:** [src/stores/taskStore.ts](src/stores/taskStore.ts)

- Add to `TaskState` interface:
  - `showAbout: boolean`
  - `setShowAbout: (show: boolean) => void`
- Add implementation in the store creator (same pattern as `showSettings`/`setShowSettings`)

### 3. Frontend: Create AboutDialog component
**New file:** `src/components/layout/AboutDialog.tsx`

- Props: `open: boolean`, `onOpenChange: (open: boolean) => void`
- Uses `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog` (same pattern as SettingsDialog)
- Fetches version via `getVersion()` from `@/lib/tauri-api` on open
- Imports `UPDATE_LOG.md?raw` via Vite raw import for changelog content
- Renders changelog with `ReactMarkdown` + `remarkGfm` (already in dependencies, used in Execution.tsx)
- Layout: version badge at top, scrollable changelog below
- Appropriate max-width/max-height similar to SettingsDialog

### 4. Frontend: Wire up in App.tsx
**File:** [src/App.tsx](src/App.tsx)

- Import `AboutDialog` and `listen` from `@tauri-apps/api/event`
- Get `showAbout` / `setShowAbout` from `useTaskStore()`
- Add `useEffect` to listen for the `"show-about"` Tauri event → calls `setShowAbout(true)`
- Render `<AboutDialog open={showAbout} onOpenChange={setShowAbout} />` alongside existing dialogs

## Files Summary

| File | Action |
|------|--------|
| `src-tauri/src/lib.rs` | Modify — add menu setup + event handler in `.setup()` |
| `src/stores/taskStore.ts` | Modify — add `showAbout` / `setShowAbout` state |
| `src/components/layout/AboutDialog.tsx` | **Create** — new About dialog component |
| `src/App.tsx` | Modify — listen for event, render AboutDialog |

## Verification

1. `cd src-tauri && cargo check` — Rust compiles with menu additions
2. `pnpm typecheck` — TypeScript compiles with new component + store changes
3. `pnpm tauri dev` — manual verification:
   - Menu bar appears with Help menu
   - Help > About opens the dialog
   - Dialog shows app version
   - Dialog shows changelog from UPDATE_LOG.md rendered as markdown
   - Dialog closes via X button or clicking outside
