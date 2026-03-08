# App Experience — Design Document

## Overview

The app experience layer covers cross-cutting desktop application features that are not specific to the chat session or OpenCode integration: theming, keyboard shortcuts, settings persistence, about panel, user feedback, update checking, and missing CLI detection. These features are implemented in the Tauri Rust backend and React frontend, independent of the sidecar.

---

## Theme Support

> **Plan:** [Theme Support](plan_theme-support.md)

### Theme System

The app provides 12 predefined themes (5 light, 7 dark):

- **Light:** Sage Garden (default), Zühlke Light, Nordic Light, Rose Quartz, Sandstone
- **Dark:** Evergreen Dark (default), Zühlke Dark, Deep Space, Amber Glow, Ocean Depths, Midnight Ember, Slate Noir

Each theme defines consistent hue tinting across all surface tokens (muted, accent, border, input, ring) to maintain visual cohesion.

### Implementation

- Theme selection persisted to SQLite (`app_settings` table)
- Applied at runtime without app restart via CSS custom properties
- OS dark-mode preference detected on first launch to select default theme
- Managed by `useTheme` hook (`src/hooks/useTheme.ts`)

---

## Keyboard Shortcuts

> **Plan:** [Keyboard Shortcuts](plan_keyboard-shortcuts.md)

Keyboard shortcuts are implemented in two layers: **app-level** (global) and **chat-scoped** (Execution page only).

### App-Level Shortcuts

Handled by a centralized `useKeyboardShortcuts` hook (`src/hooks/useKeyboardShortcuts.ts`) wired into `App.tsx`. The hook attaches a single `window.addEventListener('keydown', ...)` listener and checks for `metaKey` (macOS) or `ctrlKey` (Windows/Linux).

| Shortcut | Action | Implementation |
|----------|--------|----------------|
| `Cmd+,` / `Ctrl+,` | Open settings dialog | Calls `setShowSettings(true)` on Zustand store |
| `Cmd+N` / `Ctrl+N` | New task | Navigates to `/` via React Router |
| `Cmd+K` / `Ctrl+K` | Open task launcher | Calls `openLauncher()` on Zustand store |

### Chat-Scoped Shortcuts

Handled by a `useEffect` in `src/pages/Execution.tsx` that attaches a `window.addEventListener('keydown', ...)` listener scoped to the chat view lifecycle.

| Shortcut | Action | Guard Conditions |
|----------|--------|-----------------|
| `Escape` | Cancel running task (`interruptTask()`) | Task must be running; no permission dialog active |
| `Cmd+Enter` / `Ctrl+Enter` | Send follow-up message (`handleFollowUp()`) | Task must be in follow-up state (`canFollowUp`) |

### Shortcuts Help Modal

> **Plan:** [Keyboard Shortcuts Help Modal](plan_keyboard-shortcuts-help-modal.md)

A modal dialog listing all keyboard shortcuts, grouped by category (App, Chat). Triggered via `Shift+?` or Help menu. Displays platform-appropriate modifier keys (⌘ on macOS, Ctrl on Windows/Linux).

---

## Settings

### Settings Dialog Layout

The Settings dialog uses `max-w-2xl` width with flush-to-edge padding (`p-0` on the dialog container, `px-6 pt-6` on the header, `px-6 pb-6` on the body), matching the Task Launcher's layout pattern for visual consistency across dialog surfaces.

### Settings Storage

All settings persisted to the SQLite `app_settings` table. Changes apply immediately without app restart.

### Configurable Options

- Active provider and model selection
- Per-provider API keys and connection settings
- Folder permissions
- Skills folder path (read-only, clickable link to open in OS file manager)
- Debug mode toggle
- Custom system prompt (toggle + textarea)
- MCP server configuration
- Theme selection

### Textarea Input Pattern

Textarea inputs in Settings (User Prompt, MCP Servers JSON) use `defaultValue` + `useRef` to avoid UI re-renders during typing. Read latest value with `textareaRef.current?.value` and debounce saves with `setTimeout` (500ms).

---

## About Panel

> **Plan:** [About Panel](plan_about_panel.md)

Accessible via Help > About menu. Displays:
- Current app version (from package metadata)
- Changelog derived from `UPDATE_LOG.md`

---

## User Feedback

> **Plan:** [User Feedback](plan_user-feedback.md)

### Entry Point

Feedback icon button in the sidebar bottom bar (between logo and settings button). Clicking shows a popover with "Report Bug" and "Suggest Feature" options.

### GitHub Issue Integration

Both options open the OS default browser to the GitHub new issue URL with:
- Appropriate label (`bug` or `enhancement`)
- Pre-filled title placeholder
- Structured body template (description, steps to reproduce / use case)
- Auto-appended "Environment" section with app version, OS name, and platform architecture

No user-specific configuration (API keys, provider settings, session data) is included.

---

## Missing OpenCode CLI Detection

> **Plan:** [Missing OpenCode CLI Detection](plan_missing-opencode-cli-detection.md)

When the `opencode` CLI cannot be found on the augmented PATH, an error dialog informs the user that OpenCode is required but not installed. Task execution is blocked until the CLI is detected, but settings and configuration remain accessible. The dialog includes brief installation instructions.

---

## Dynamic Model Discovery

> **Plan:** [Dynamic Model Discovery](plan_dynamic-model-discovery-for-direct-api-providers.md)

When a user connects to Anthropic, OpenAI, Google AI, xAI, or DeepSeek with a valid API key, the app fetches available models from the provider's API endpoint. The model list is persisted in the database and restored on Settings reopen without re-fetching. On fetch failure, a static default model list is used as fallback.

---

## App Update

### Update Check

- Automatic check on app startup (silently, after short delay)
- Manual check via Help > "Check for Updates…" menu item
- Uses Tauri updater plugin with signed update bundles
- Checks GitHub Releases (static JSON endpoint)

### Update Dialog

When an update is available:
- Shows new version, current version, release notes
- "Update Now" downloads, installs, and restarts the app
- "Later" dismisses until next check

All update bundles are signed with a private key during CI and verified with the embedded public key before installation.

---

## Key Source Locations

| Path | Purpose |
|------|---------|
| `src/hooks/useKeyboardShortcuts.ts` | App-level and chat-level shortcuts |
| `src/hooks/useTheme.ts` | Theme management |
| `src/hooks/useAppUpdate.ts` | Auto-update check on launch |
| `src/components/layout/SettingsDialog.tsx` | Settings modal |
| `src/components/settings/` | Provider configuration forms |
| `src-tauri/src/commands/settings.rs` | Settings Tauri commands |
| `src-tauri/src/commands/updates.rs` | Update check commands |
| `src-tauri/src/commands/app_info.rs` | App version/info commands |
| `src-tauri/src/commands/opencode_cli.rs` | CLI detection commands |
| `src-tauri/src/db/settings.rs` | Settings persistence |
