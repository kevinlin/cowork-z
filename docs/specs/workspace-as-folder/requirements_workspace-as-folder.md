# Workspace as Folder — Requirement Specification

> **Maps to root [`requirements.md`](../requirements.md) § 6 Workspace & File Browser.** Each section below carries the `§ 6.x.y` ID it corresponds to in the root spec. The root spec is the source of truth for numbered acceptance criteria; this document is the longer-form, behaviour-level spec used by the design and plans.
>
> **Coverage gaps (intentional):** This module spec covers the file tree (§ 6.2) and file preview panel (§ 6.4). It does **not** cover § 6.1 Workspace Lifecycle or § 6.3 Workspace Permissions — those are documented in [`design_workspace-as-folder.md`](design_workspace-as-folder.md) only.

## Overview

The application shows a 3-panel workspace for the user:
1. The left panel provides two-tabbed panels:
   - Sessions tab for viewing/resuming conversations
   - Files tab for browsing and previewing files within the active project directory. The panel displays a hierarchical file tree.
2. The chat UI shows the conversations for the active session.
3. A closable, resizable right panel renders an inline preview of the selected file.

---

## § 6.2 File Tree Browser

### § 6.2.1 Tree Display

- Files and folders are shown in a hierarchical tree with visual indentation per depth level.
- Each row displays:
  - A collapse/expand chevron for directories (animated spinner while loading children)
  - A type-specific icon (see File Type Icons)
  - The file or folder name, truncated with ellipsis if too long
  - File size (e.g. `4.2 KB`) right-aligned for files only; never shown for directories
- Symbolic links (macOS/Linux) display a small link arrow overlay on their type icon to distinguish them from regular entries.
- Folder icons visually change between closed and open states.
- The currently selected file is highlighted with a distinct background and text color.
- Item actions appear on the right side of a row on hover (see Item Actions).

### § 6.2.1 Navigation

- Clicking a folder toggles it open or closed in-place.
- Clicking a symbolic link to a directory expands it in-place, showing the contents of the linked target directory as if it were a regular folder.
- The tree root is fixed to the currently active project directory.
- No breadcrumbs or back/forward navigation — the tree itself is the sole navigation mechanism.
- Expand state is preserved across filesystem refreshes: when the tree auto-refreshes, previously expanded folders remain expanded.

### § 6.2.2 Search and Filter

- A search bar is pinned at the top of the file browser.
- Filtering is real-time, case-insensitive, and name-based.
- The filter is recursive: if a child matches, its parent directories are included in results even if their names don't match.
- When no results are found, a "No files match your search" message is shown.
- Clearing the query restores the full tree.
- Only already-loaded (expanded) subtrees are searched.

### § 6.2.1 Sorting

- Files and folders are displayed in the order returned by the backend directory read.
- No user-configurable sort options (by name, date, size, etc.) are available.

### § 6.2.1 File Type Icons

| Category | Extensions | Icon |
|----------|-----------|------|
| Directories | — | Folder (closed) / Folder Open (expanded), in primary app color |
| Symbolic links | — | Base type icon with a small link arrow overlay badge |
| Images | `png jpg jpeg gif svg webp` | Image |
| Code | `ts tsx js jsx rs py java c cpp go` | Code File |
| Data/Config | `json yaml yml toml` | JSON File |
| Everything else | — | Text File |

### Item Actions <!-- module-internal extension; not in root § 6 -->

Two action buttons appear on the right side of each tree row on hover: **Open** and **Delete**.

**Folders:**
- **Open** — Opens the folder in the platform's native file manager (Finder on macOS, Explorer on Windows, default file manager on Linux).
- **Delete** — Moves the folder and its contents to the system trash.

**Files:**
- **Open** — Opens the file with the system's default application.
- **Delete** — Moves the file to the system trash (macOS Trash / Windows Recycle Bin).

No confirmation dialog is shown for delete; the operation is reversible via the system trash. After deletion, the file tree refreshes immediately to reflect the change.

### § 6.2.4 Drag-and-Drop from File Tree

- Files can be dragged from the file tree into the chat input areas (task launcher and follow-up input).
- Dropped files are inserted as `@path/to/file` references at the cursor position.
- Paths containing spaces are automatically quoted: `@"path/to/file with spaces.txt"`.
- Visual feedback (ring highlight) is shown when hovering over the drop target.

---

## § 6.4 File Preview

### § 6.4.1 Opening and Closing

- Clicking a file in the tree opens its preview in the right panel.
- Clicking a media thumbnail (image/video) in a chat message opens the preview panel for that file.
- A close button (X) dismisses the preview panel.

### § 6.4.2 Resizable Panel

- The preview panel has a drag handle on its left edge for horizontal resizing.
- The panel width is constrained between a minimum (280px) and maximum (700px), with a default of 400px.
- The drag handle highlights on hover to indicate interactivity.

### § 6.4.3 Supported Preview Types

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

### § 6.4.4 Fullscreen / Expand Mode

- A maximize/minimize toggle in the preview header switches between docked and fullscreen mode.
- In fullscreen, the preview covers the entire viewport as a portal overlay with backdrop blur.
- Pressing **Escape** exits fullscreen.
- Switching to a different file automatically resets to docked mode.

### § 6.4.5 Loading and Error States

- A spinner is shown while file content is being fetched.
- If loading fails, an error icon and message replace the content area.

---

## § 6.2.3 Real-Time Filesystem Watching

The file tree updates automatically from two sources:

1. **OS filesystem events** — The backend watches the project directory for changes. Updates are debounced (200ms) before refreshing the tree.
2. **AI sidecar file operations** — File writes, creates, and deletes triggered by the AI agent cause a tree refresh (debounced 150ms), ensuring the tree stays current even if OS notifications are unreliable.

On refresh, expanded directories are re-read recursively while preserving the current expand state.

---

## § 6.4.1 Chat Integration

- An **"Add to Chat"** button in the preview header inserts the previewed file as an `@path` reference into the active chat input (task launcher input on the Home page, follow-up input on the Execution page).
- The path is inserted at the current cursor position with appropriate whitespace padding.
- After insertion, the chat input receives focus and the cursor is placed after the inserted reference.
- This is the primary bridge between the Files tab and the Chat workspace.

---

## Empty States <!-- module-internal extension; cross-cutting -->

| Situation | Display |
|-----------|---------|
| No project selected | File icon + "No project selected" message |
| Initial directory load | Centered spinner |
| Directory read error | Red error message |
| Empty directory or no search matches | "No files found" or "No files match your search" |
| Binary file | File icon + "Binary file" label + file size |

---

## Security <!-- module-internal extension; aligns with root § 6.4.3 sandboxed iframe rule -->

- All file reads go through the backend IPC layer — the frontend never accesses the filesystem directly.
- HTML previews are sandboxed: scripts run but cannot access the host app, local storage, or Tauri APIs.
- The iframe's referrer policy prevents file paths from leaking to external requests.

---

## Not Supported <!-- scope boundary; module-internal -->

The following are explicitly **not** part of the current feature set:

- File mutations other than delete (rename, move, copy, create)
- Context menus / right-click actions
- Multi-file selection
- List or grid view alternatives
- User-configurable sort order
- Breadcrumb navigation
- Presentation preview (`.tandem.ppt.json` — Tandem-specific format)
- Extracted text preview for office documents (DOCX, PPTX, XLSX)
