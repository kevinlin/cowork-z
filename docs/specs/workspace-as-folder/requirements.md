# Workspace as Folder — Requirement Specification

## Overview

The application shows a 3-panel workspace for the user:
1. The left panel provides two-tabbed panels:
   - Sessions tab for viewing/resuming conversations
   - Files tab for browsing and previewing files within the active project directory. The panel displays a hierarchical file tree.
2. The chat UI shows the conversations for the active session.
3. A closable, resizable right panel renders an inline preview of the selected file.

---

## File Tree Browser

### Tree Display

- Files and folders are shown in a hierarchical tree with visual indentation per depth level.
- Each row displays:
  - A collapse/expand chevron for directories (animated spinner while loading children)
  - A type-specific icon (see File Type Icons)
  - The file or folder name, truncated with ellipsis if too long
  - File size (e.g. `4.2 KB`) right-aligned for files only; never shown for directories
- Folder icons visually change between closed and open states.
- The currently selected file is highlighted with a distinct background and text color.

### Navigation

- Clicking a folder toggles it open or closed in-place.
- The tree root is fixed to the currently active project directory.
- No breadcrumbs or back/forward navigation — the tree itself is the sole navigation mechanism.
- Expand state is preserved across filesystem refreshes: when the tree auto-refreshes, previously expanded folders remain expanded.

### Search and Filter

- A search bar is pinned at the top of the file browser.
- Filtering is real-time, case-insensitive, and name-based.
- The filter is recursive: if a child matches, its parent directories are included in results even if their names don't match.
- When no results are found, a "No files match your search" message is shown.
- Clearing the query restores the full tree.
- Only already-loaded (expanded) subtrees are searched.

### Sorting

- Files and folders are displayed in the order returned by the backend directory read.
- No user-configurable sort options (by name, date, size, etc.) are available.

### File Type Icons

| Category | Extensions | Icon |
|----------|-----------|------|
| Directories | — | Folder (closed) / Folder Open (expanded), in primary app color |
| Images | `png jpg jpeg gif svg webp` | Image |
| Code | `ts tsx js jsx rs py java c cpp go` | Code File |
| Data/Config | `json yaml yml toml` | JSON File |
| Everything else | — | Text File |

### Drag-and-Drop from File Tree

- Files can be dragged from the file tree into the chat input areas (task launcher and follow-up input).
- Dropped files are inserted as `@path/to/file` references at the cursor position.
- Paths containing spaces are automatically quoted: `@"path/to/file with spaces.txt"`.
- Visual feedback (ring highlight) is shown when hovering over the drop target.

---

## File Preview

### Opening and Closing

- Clicking a file in the tree opens its preview in the right panel.
- Clicking a media thumbnail (image/video) in a chat message opens the preview panel for that file.
- A close button (X) dismisses the preview panel.

### Resizable Panel

- The preview panel has a drag handle on its left edge for horizontal resizing.
- The panel width is constrained between a minimum (280px) and maximum (700px), with a default of 400px.
- The drag handle highlights on hover to indicate interactivity.

### Supported Preview Types

| Type | Extensions | Rendering |
|------|-----------|-----------|
| Code | `ts tsx js jsx rs py java c cpp h hpp go rb php swift kt scala sh bash css scss xml sql r` | Syntax-highlighted with line numbers, dark theme |
| Markdown | `md` | Rendered Markdown with GFM support (tables, strikethrough, etc.); embedded code blocks are syntax-highlighted with a macOS-style header bar |
| Image | `png jpg jpeg gif svg webp bmp ico` | Centered image, scaled to fit, loaded via Tauri asset protocol |
| Video | `mp4 webm ogg mov avi mkv m4v` | Native `<video>` player with controls, loaded via Tauri asset protocol |
| PDF | `pdf` | Embedded native PDF viewer via base64 data URL |
| HTML | `html htm` | Rendered in a sandboxed iframe; relative asset paths resolve correctly; scripts are allowed but the iframe cannot access the host app |
| Text | `txt log csv json yaml yml toml ini cfg conf` | Plain monospace text, scrollable |
| Binary | Everything else | Generic file icon with file name and size; no content preview |

### Fullscreen / Expand Mode

- A maximize/minimize toggle in the preview header switches between docked and fullscreen mode.
- In fullscreen, the preview covers the entire viewport as a portal overlay with backdrop blur.
- Pressing **Escape** exits fullscreen.
- Switching to a different file automatically resets to docked mode.

### Loading and Error States

- A spinner is shown while file content is being fetched.
- If loading fails, an error icon and message replace the content area.

---

## Real-Time Filesystem Watching

The file tree updates automatically from two sources:

1. **OS filesystem events** — The backend watches the project directory for changes. Updates are debounced (200ms) before refreshing the tree.
2. **AI sidecar file operations** — File writes, creates, and deletes triggered by the AI agent cause a tree refresh (debounced 150ms), ensuring the tree stays current even if OS notifications are unreliable.

On refresh, expanded directories are re-read recursively while preserving the current expand state.

---

## Chat Integration

- An **"Add to Chat"** button in the preview header inserts the previewed file as an `@path` reference into the active chat input (task launcher input on the Home page, follow-up input on the Execution page).
- The path is inserted at the current cursor position with appropriate whitespace padding.
- After insertion, the chat input receives focus and the cursor is placed after the inserted reference.
- This is the primary bridge between the Files tab and the Chat workspace.

---

## Empty States

| Situation | Display |
|-----------|---------|
| No project selected | File icon + "No project selected" message |
| Initial directory load | Centered spinner |
| Directory read error | Red error message |
| Empty directory or no search matches | "No files found" or "No files match your search" |
| Binary file | File icon + "Binary file" label + file size |

---

## Security

- All file reads go through the backend IPC layer — the frontend never accesses the filesystem directly.
- HTML previews are sandboxed: scripts run but cannot access the host app, local storage, or Tauri APIs.
- The iframe's referrer policy prevents file paths from leaking to external requests.

---

## Not Supported

The following are explicitly **not** part of the current feature set:

- File mutations (rename, delete, move, copy, create)
- Context menus / right-click actions
- Multi-file selection
- List or grid view alternatives
- User-configurable sort order
- Breadcrumb navigation
- Presentation preview (`.tandem.ppt.json` — Tandem-specific format)
- Extracted text preview for office documents (DOCX, PPTX, XLSX)
