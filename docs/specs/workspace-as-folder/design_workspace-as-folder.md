# Workspace-as-Folder — Design Document

## Overview

Cowork-Z adopts a workspace-per-folder model where each workspace is defined by a unique directory on the filesystem. The workspace folder becomes the AI agent's working directory, the root of the file tree browser, and the scope for session history. A single shared sidecar process serves all workspaces by reconfiguring on switch.

The workspace feature was implemented in two phases:
- **Phase 1:** Workspace lifecycle, switching, file tree browser, permission integration.
- **Phase 2:** File preview panel (code highlighting, markdown rendering, images, video, PDF, HTML), resizable panel, fullscreen mode, "Add to Chat" bridge.

---

## 1. Workspace Data Model

### DB Table: `workspaces`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `folder_path` | TEXT UNIQUE | Absolute path to the folder |
| `display_name` | TEXT | Folder basename (e.g. "my-project") |
| `created_at` | INTEGER | Unix timestamp |
| `last_opened_at` | INTEGER | Updated on each switch; used for startup restore |

### Session Scoping

Task/session records gain a `workspace_id` foreign key. The Sessions tab filters by the active workspace. Existing sessions created before this feature get assigned to a legacy workspace mapped to ~/Downloads.

### App Settings

A `last_workspace_id` setting (stored via existing settings DB) is read on app launch to restore the last-used workspace. On first-ever launch, ~/Downloads is created as the default workspace.

---

## 2. Restricted Paths

Workspace creation validates the selected folder against a platform-aware blocklist. Subfolders of the user's home directory are always allowed (e.g. ~/Downloads, ~/Documents, ~/Projects/foo).

### macOS

| Blocked Path | Reason |
|-------------|--------|
| `/` | System root |
| `/System` | System files |
| `/usr` | System binaries |
| `/bin` | System binaries |
| `/sbin` | System binaries |
| `/etc` | System configuration |
| `/var` | System data |
| `/private` | macOS system internals |
| `~` (home root exactly) | Too broad — contains Library, caches, etc. |
| `/Volumes/*` (volume mount points) | Entire drives |
| `/Applications` | Application bundles |

### Windows

| Blocked Path | Reason |
|-------------|--------|
| Drive roots (`C:\`, `D:\`, etc.) | Entire drives |
| `C:\Windows` | System files |
| `C:\Program Files` | Installed applications |
| `C:\Program Files (x86)` | Installed applications (32-bit) |
| `C:\ProgramData` | System-wide app data |
| `%USERPROFILE%` (home root exactly) | Too broad |
| `%SystemRoot%` | System directory |
| `%WINDIR%` | Windows directory |

Validation uses `std::env::consts::OS` in Rust to select the appropriate blocklist.

---

## 3. Workspace Switching & Sidecar Integration

### Approach: Reconfigure-on-Switch

A single sidecar process serves all workspaces. Switching workspaces reconfigures the OpenCode server via `PATCH /config`.

### Switch Flow

1. **Frontend** calls `switch_workspace(workspace_id)` Tauri command
2. **Rust** updates `last_workspace_id` in settings, updates `last_opened_at` on the workspace record
3. **Rust** sends `PATCH /config` to sidecar with the new workspace folder as the working directory and updated permission rules
4. **SSE reconnects** with the new directory scope (~1s)
5. **Rust** emits a `workspace:changed` Tauri event to the frontend
6. **Frontend** resets active task state and navigates to home:
   - Calls `taskStore.reset()` to clear `currentTask`, streaming state (`partialMessages`), permission requests, and error flags
   - Navigates to `/` so the user sees the default home screen (task launcher)
   - Reloads the session list (filtered to the new workspace) and file tree (rooted at the new folder)

### New Task Flow

When starting a task in the active workspace, `start_task` sends `working_directory: Some(workspace_folder_path)` instead of `None`. The OpenCode server uses this as the session's CWD.

### SSE Directory Scoping

OpenCode scopes SSE events per-directory. The sidecar's EventStream **must** connect with a `?directory=<workspace_path>` query parameter matching the workspace folder; otherwise only global events (`server.connected`, `server.heartbeat`) are received, and session lifecycle events (`session.status`, `session.idle`, `message.updated`, `message.part.updated`) are silently dropped.

The `workingDirectory` from each task payload is passed through `initialize()` to the `EventStream` constructor. On subsequent tasks, if the directory changes (workspace switch), the EventStream disconnects and reconnects with the new directory scope via `reconnectWithDirectory()`. This ensures the sidecar receives session events for whichever workspace is currently active.

### Permission & Question Reply Routing

OpenCode's `POST /permission/{id}/reply` and `POST /question/{id}/reply` endpoints require a `?directory=<workspace_path>` query parameter to route the reply to the correct session instance. Without it, the server bootstraps a new instance in its default directory (the log directory), and the waiting session never receives the reply — causing the agent to hang indefinitely after the user grants a permission.

The sidecar's `SessionManager` resolves this by looking up the managed session for the task and extracting its `directory` field (populated from the `POST /session` response at session creation time). This directory is then passed as a query parameter.

The same pattern applies to `replyToQuestion`.

### Duplicate Permission Reply Prevention

The frontend prevents duplicate permission replies through two mechanisms:

1. **Async listener cleanup (Execution.tsx):** Tauri's `listen()` returns a Promise, but React's `useEffect` cleanup runs synchronously. Under React Strict Mode double-mounting, a stale listener from the first mount can survive cleanup and fire alongside the second mount's listener. A `cancelled` flag pattern ensures stale async listeners are immediately unsubscribed when their promise resolves after cleanup.

2. **Replied-ID tracking (taskStore.ts):** A `repliedPermissionIds: Set<string>` in the Zustand store tracks every permission ID that has been replied to. Both `enqueuePermissionRequest` and `respondToPermission` check this set before sending a reply, preventing duplicates from any source (stale listeners, auto-approve of duplicated queue entries, or rapid user clicks).

### Missing Folder Handling

On switch (or app launch), Rust checks if the workspace folder exists. If not:
- Show an error toast to the user
- Fall back to ~/Downloads (creating it as a workspace if needed)
- The missing workspace stays in the dropdown list, greyed out with a warning icon, so the user can re-mount/restore and retry

---

## 4. Workspace Switcher UI

### Location

Top of the left sidebar, above the Sessions/Files tabs.

### Default State

Shows the current workspace's `display_name` (folder basename) with a chevron-down icon. Truncated with ellipsis if the name is long. Tooltip shows the full absolute path on hover.

### Dropdown Contents

- List of all workspaces, ordered by `last_opened_at` descending (most recent first)
- Each item shows: folder basename + full path in smaller muted text
- Active workspace has a checkmark indicator
- Missing/unavailable workspaces shown greyed out with a warning icon
- Divider line
- **"Add Workspace..."** button at the bottom — opens a native folder picker

Each non-active workspace has a remove button (X) on hover.

### Adding a Workspace

1. User clicks "Add Workspace..."
2. Native folder picker opens (`@tauri-apps/plugin-dialog` with `directory: true`)
3. Path validated against the restricted blocklist
4. If blocked: error toast explaining why
5. If path already exists as a workspace: switches to it (no duplicate)
6. Otherwise: creates workspace record, switches to it

### Removing a Workspace

1. User clicks X on a workspace in the dropdown
2. Confirmation dialog: "Remove [name] from workspaces? Sessions and history will be preserved and restored if you re-add this folder."
3. On confirm: workspace removed from list; sessions preserved in DB keyed by `folder_path`
4. Cannot remove the currently active workspace — must switch away first
5. Re-adding the same folder path later restores its sessions

---

## 5. File Tree Browser

### Tab Structure

The left sidebar panel gets two tabs: **Sessions** (existing session list) and **Files** (new file tree). Both tabs are always visible regardless of whether a task is active.

### Tree Root

Always the active workspace folder. No breadcrumbs or navigation above the root.

### Lazy Loading

Children are loaded on demand — a folder's contents are fetched only when the user expands it. This avoids scanning deep project trees upfront.

### Backend API

Tauri command: `read_directory(path: String) -> Vec<DirectoryEntry>`

Each `DirectoryEntry` contains:
- `name: String` — file or folder name
- `path: String` — absolute path
- `is_directory: bool`
- `is_symlink: bool` — true if the entry is a symbolic link (macOS/Linux)
- `size: Option<u64>` — file size in bytes (None for directories)
- `extension: Option<String>`

For symlinks, `is_directory` reflects the target's type (i.e. a symlink pointing to a directory has `is_directory: true`), and `path` is the entry's own path (not the resolved target). This means the rest of the tree logic (expand, lazy-load children) works identically for symlinks and regular entries — the Rust `read_directory` implementation follows symlinks transparently via `std::fs::metadata` (which follows links, unlike `symlink_metadata`).

Results sorted: directories first, then files, both alphabetical.

### Tree Display

- Collapse/expand chevron for directories
- Type-specific icons:
  - Directories: folder closed/open (primary app color)
  - Images (`png jpg jpeg gif svg webp`): image icon
  - Code (`ts tsx js jsx rs py java c cpp go`): code file icon
  - Data/config (`json yaml yml toml`): JSON file icon
  - Everything else: text file icon
  - Symbolic links: a small link arrow badge overlays the base type icon (e.g. a symlinked folder shows the folder icon with a link overlay)
- File name, truncated with ellipsis if too long
- File size right-aligned for files only
- Selected file highlighted with distinct background
- Hover actions on the right side of each row (see Item Actions below)

### Search & Filter

- Search bar pinned at the top of the file tree
- Real-time, case-insensitive, name-based filtering
- Recursive: if a child matches, parent directories are shown even if their names don't match
- Only already-loaded (expanded) subtrees are searched
- "No files match your search" message when empty
- Clearing the query restores the full tree

### Filesystem Watching

Rust watches the workspace folder using the `notify` crate (or Tauri's fs-watch plugin). Changes are debounced at 200ms. On change, Rust emits a `workspace:fs_changed` Tauri event. The frontend re-reads only affected expanded directories, preserving expand/collapse state.

AI sidecar file operations also trigger a tree refresh (debounced at 150ms) to ensure the tree stays current even if OS notifications are unreliable.

### Drag-and-Drop to Chat Input

Files and folders in the tree are draggable. Dropping a tree item onto either the home-page task input (`TaskInputBar`) or the execution-page follow-up input (`ChatInput` / `DragDropTextarea`) inserts an `@path` reference at the cursor position.

**Mechanism:**

1. Each `TreeRow` sets `draggable` on its `<button>` element. On `dragStart`, the file's absolute path is stored in a module-level variable (`pendingDragPath`) exported from `FileTreePanel`. The `dataTransfer` is also populated with a custom MIME type `application/x-cowork-file-path` and a `text/plain` fallback (used for the native drag ghost image).
2. Tauri intercepts all drag events at the native webview level — HTML5 `dragover`/`drop` DOM events never fire for intra-webview drags. Instead, Tauri's `onDragDropEvent` fires with `paths: []` for intra-app drags (vs. populated `paths` for OS-level Finder drops). Drop targets (`DragDropTextarea`, `TaskInputBar`) detect this case: when `drop` fires with empty `paths`, they check `getPendingDragPath()`. If a pending path exists, it is formatted via `formatPathForChat()` (producing `@path` or `@"path with spaces"`) and inserted at the cursor position using `insertAtCursor()`.
3. A visual ring highlight (`ring-2 ring-ring`) appears on the drop target while dragging over it — the same indicator used for Tauri native (Finder) drag-and-drop, driven by the Tauri `over`/`enter` events.

**Note:** Both intra-app (file tree) and OS-level (Finder) drops are handled by the same Tauri `onDragDropEvent` listener. The distinction is made by checking whether `paths` is empty (intra-app, read from `pendingDragPath`) or populated (Finder, paths provided by the OS).

### Hidden Files & System Folders Toggle

The file tree hides hidden files and OS system folders by default. A toggle button (eye icon) next to the search bar lets the user show/hide them.

**Default state:** Hidden (toggle off, `EyeOff` icon shown).

**Toggle on:** All files visible (`Eye` icon, button highlighted with `bg-accent`).

#### Filter Logic

Filtering is performed entirely on the frontend — the Rust `read_directory` command returns all entries. The `useFileTree` hook accepts an optional `filterPredicate: (entry: DirectoryEntry) => boolean` parameter. When provided, it recursively removes non-matching entries from the tree before applying search filtering.

An entry is considered "hidden" if any of the following is true:

1. **Dotfiles/dotfolders** (macOS/Linux convention): name starts with `.` (e.g. `.git`, `.DS_Store`, `.env`, `.vscode`)
2. **Temp edit files** (macOS/Windows): name starts with `~$` (e.g. `~$Document.docx`, `~$Budget.xlsx`). Created by Microsoft Office and other apps as lock/temporary files while a document is open for editing.
3. **macOS system entries**: `.DS_Store`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`, `__MACOSX`, `.DocumentRevisions-V100`, `.TemporaryItems`
4. **Windows system entries**: `$RECYCLE.BIN`, `System Volume Information`, `Thumbs.db`, `desktop.ini`, `NTUSER.DAT`, `ntuser.dat.LOG1`, `ntuser.dat.LOG2`, `ntuser.ini`

Note: Developer-convention hidden folders like `node_modules`, `__pycache__`, `.venv` etc. are captured by the dotfile rule (if prefixed with `.`) or intentionally left visible (if not prefixed). The filter targets OS-level system entries, not project tooling directories.

#### Filter Pipeline Order

1. **Predicate filter** (`filterNodesByPredicate`) — removes hidden entries from the full tree
2. **Search filter** (`filterNodes`) — applies the user's search query to the visible subset

This ensures search only matches visible entries when hidden files are off, and matches all entries when hidden files are shown.

#### UI

The toggle button is placed to the right of the search input in the file tree header bar. It is a 26×26px bordered icon button with hover/focus states matching the app's design system.

### Symbolic Link Handling

Symbolic links are supported on macOS and Linux. The `read_directory` command detects symlinks using `std::fs::symlink_metadata` to check `file_type().is_symlink()`, then resolves the target's type via `std::fs::metadata` (which follows the link) to determine `is_directory`. If the symlink target is missing or unreadable, the entry is still returned with `is_directory: false` and `is_symlink: true`.

On the frontend, symlink entries behave identically to their target type — a symlink to a directory expands and lazy-loads children, a symlink to a file opens the preview. The only visual distinction is the link overlay badge on the icon.

Windows shortcuts (`.lnk` files) are not treated as symbolic links.

### Item Actions

Each tree row shows two action buttons on hover (Open + Delete), right-aligned within the row. Buttons use `opacity-0 group-hover/row:opacity-100` for the show-on-hover effect.

**Open button (`ExternalLink` icon):**
- **Folders** — Uses the existing `revealInFinder()` wrapper (calls `revealItemInDir` from `@tauri-apps/plugin-opener`) to reveal the folder in the platform's native file manager. No new Rust command needed — the opener plugin is already configured with `opener:default` permissions.
- **Files** — Uses the existing `openFilePath()` wrapper (calls `openPath` from `@tauri-apps/plugin-opener`) to open the file with the system's default application.

**Delete button (`Trash2` icon):**
- **Both files and folders** — Tauri command: `trash_file(path: String)`. Uses the `trash` crate to move the item to the system trash (macOS Trash, Windows Recycle Bin, Linux freedesktop trash). Returns `Ok(())` on success. No confirmation dialog — the operation is reversible via the system trash.

**Tree refresh after delete:** On successful `trashFile()`, the frontend calls `refreshRoot()` to immediately re-read all expanded directories. This provides instant visual feedback without waiting for the debounced filesystem watcher notification (which also fires independently as a backup).

#### Frontend Implementation

In `FileTreePanel.tsx`, each `TreeRow` is wrapped in a `group/row` class. The action button container is positioned absolutely on the right side of the row with `gap-0.5` between the two buttons. File size text is hidden on hover (`group-hover/row:hidden`) to avoid overlap.

Both buttons use `onClick` with `e.stopPropagation()` to prevent triggering the row's default click behavior (expand folder / open preview). The `onDelete` callback is threaded from the parent `FileTreePanel` (where it is bound to `refreshRoot`) through the recursive `TreeRow` tree.

### Not Supported

- File mutations other than delete (rename, move, copy, create)
- Context menus / right-click actions
- Multi-file selection
- List or grid view alternatives
- User-configurable sort order
- Breadcrumb navigation

---

## 6. Permissions Integration

### Workspace Folder = Trusted Zone

The workspace folder and all its descendants are always permitted with read-write access. No permission prompts are shown for file operations within the workspace. This is injected automatically into every task's permission config.

### External Folders

The current "Folders" sidebar panel is renamed to **"External Folders"**. It grants the AI agent access to folders outside the workspace, per-task, with user-selected access levels (read-only or read-write). Behavior is identical to the current Folders panel.

### Default Folders Removed

The implicit default permissions for ~/Downloads and ~/Desktop (read-only) are removed. The workspace folder replaces that concept. If the user needs access to ~/Desktop while working in ~/Projects/foo, they add it as an external folder.

### Permission Config Build Order (config-builder.ts)

1. **Workspace folder** → read-write (always, no prompt)
2. **External folders** for the active task → their configured access level
3. **Adhoc grants** from runtime permission prompts → as granted

### Artifacts Panel Removed

The existing Artifacts panel is removed from the sidebar. With the workspace folder as the CWD, files created by the AI agent appear in the file tree automatically via filesystem watching.

---

## 7. Cross-Workspace Task History & Navigation

### Task–Workspace Association

Every task record has a `workspace_id` foreign key linking it to the workspace in which it was created. This field is returned in all task API responses (`list_tasks`, `get_task`, `start_task`, `resume_session`).

### Task Launcher (Cmd+K)

The Task Launcher modal (`TaskLauncher.tsx`) also shows tasks across all workspaces:
- The modal is wider (`max-w-2xl` instead of `max-w-lg`) to accommodate workspace information.
- Each task item shows a folder icon and workspace `display_name` alongside the date.
- Tasks from other workspaces display the workspace name in the primary color.
- The search placeholder reads "Search tasks across all workspaces...".

### Automatic Workspace Switching on Task Selection

When a user selects a task that belongs to a different workspace (from either the History page or the Task Launcher):
1. The app calls `switchWorkspace(task.workspaceId)` **before** navigating to the task's execution page.
2. This triggers the full workspace switch flow (Section 3): settings update, sidecar reconfiguration, SSE reconnection, frontend reload of sessions and file tree.
3. After the switch completes, the app navigates to `/execution/:taskId`.

This ensures the user always sees the correct file tree and session context for the task they selected.

### Data Loading

- **Sidebar sessions list** (`tasks` in store) — continues to load workspace-scoped tasks via `loadTasks()`.
- **Task History page and Task Launcher** (`allTasks` in store) — load all tasks across workspaces via `loadAllTasks()` (calls `list_tasks` with no `workspace_id` filter).
- The Launcher refreshes `allTasks` each time it opens.

---

## 8. File Preview Panel

A closable, resizable right-side file preview panel. Clicking a file in the file tree (or a media thumbnail in chat) opens the preview. The panel supports code (syntax-highlighted), markdown, images, video, PDFs, HTML, plain text, and binary files. It includes fullscreen mode and an "Add to Chat" button.

Media thumbnails in chat messages open the same file preview panel instead of a separate modal dialog.

### Rust Backend: File-Reading Commands

Two Tauri commands in `src-tauri/src/commands/files.rs`:

**`read_file_content`** — Reads UTF-8 text content from a file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `String` | required | Absolute file path |
| `max_size` | `Option<u64>` | 1 MB | Maximum file size in bytes |

**`read_binary_file`** — Reads binary content and returns base64-encoded string.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `String` | required | Absolute file path |
| `max_size` | `Option<u64>` | 10 MB | Maximum file size in bytes |

### File Preview Store

A Zustand store (`src/stores/filePreviewStore.ts`) manages preview state globally. Separate from `taskStore` because preview state is orthogonal to task state and needs to be accessed from both the sidebar (`FileTreePanel`) and chat messages (`MediaGallery`).

| Action | Description |
|--------|-------------|
| `openPreview(file)` | Sets `selectedFile` and opens the panel |
| `closePreview()` | Closes the panel and clears selection |
| `openPreviewByPath(path)` | Constructs a `DirectoryEntry` from a path string and opens preview |

### Component Hierarchy

```
App.tsx
├── Sidebar (files tab)
│   └── FileTreePanel (onSelect → filePreviewStore.openPreview)
├── Main content (flex-1)
│   └── Routes (Home / Execution)
│       └── MessageBubble → MediaGallery → MediaThumbnail (onClick → filePreviewStore.openPreviewByPath)
└── FilePreviewPanel (conditional, when isPreviewOpen)
    ├── Header (icon, name, path, maximize, add-to-chat, close)
    └── Content (dispatched by preview type)
        ├── CodePreview (react-syntax-highlighter)
        ├── MarkdownPreview (react-markdown + remark-gfm)
        ├── MediaPreview (convertFileSrc — images and video)
        ├── PdfPreview (convertFileSrc — asset protocol → embed)
        ├── HtmlPreview (sandboxed iframe)
        ├── TextPreview (monospace pre)
        └── BinaryPreview (icon + name + size)
```

### Preview Type Detection

Extension-based dispatch via `getPreviewType(file: DirectoryEntry)`:

| Type | Extensions |
|------|-----------|
| `code` | ts tsx js jsx rs py java c cpp h hpp go rb php swift kt scala sh bash css scss xml sql r |
| `markdown` | md |
| `image` | png jpg jpeg gif svg webp bmp ico |
| `video` | mp4 webm ogg mov avi mkv m4v |
| `pdf` | pdf |
| `html` | html htm |
| `text` | txt log csv json yaml yml toml ini cfg conf |
| `binary` | everything else |

### Panel Modes

**Docked mode:** Renders as a right-side panel in the flex layout (default 400px, resizable 280–700px via drag handle), `border-l`.

**Fullscreen mode:** Renders via `createPortal` to `document.body` as a fixed overlay (`fixed inset-0 z-50`). Escape key exits fullscreen. Switching files resets to docked mode.

**Header bar:** File type icon, file name (truncated), full path (muted), maximize/minimize toggle, "Add to Chat" button, close (X) button.

### Preview Renderers

- **CodePreview** — `react-syntax-highlighter` with theme-aware highlighting (`oneLight`/`oneDark`). Observes `dark` class on `<html>` via `useSyncExternalStore` + `MutationObserver`. Shows line numbers.
- **MarkdownPreview** — `react-markdown` with `remark-gfm`. Code blocks get syntax highlighting with a macOS-style header bar (three colored dots + language label).
- **MediaPreview** — Combined image/video. Uses `convertFileSrc()` for Tauri's asset protocol. `<video>` includes `<track kind="captions">` for accessibility.
- **PdfPreview** — `convertFileSrc()` (asset protocol) → `<embed type="application/pdf">`. Asset URLs keep `data:` out of the CSP's `object-src` (2026-06-12 review #29).
- **HtmlPreview** — Sandboxed iframe with `srcDoc`. Sandbox: `allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms`. No `allow-same-origin` for security.
- **TextPreview** — Plain monospace `<pre>` text, scrollable.
- **BinaryPreview** — Generic file icon with file name and formatted file size. No content preview.

### Layout Integration

```
[Sidebar] [Main (flex-1)] [ResizeHandle] [FilePreviewPanel (conditional, 280–700px)]
```

The preview panel is a direct sibling of `<main>` in the flex container. It renders conditionally based on `filePreviewStore.isPreviewOpen`.

### "Add to Chat" Integration

The "Add to Chat" button in the preview header inserts the file as an `@path` reference into the active chat input using `formatPathForChat()`. The mechanism mirrors drag-and-drop from the file tree.

---

## 9. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Escape | Exit fullscreen preview |

Cmd+N (new task) and Cmd+K (launcher) continue to work within the active workspace context.

---

## Not In Scope

- File mutations other than delete (rename, move, copy, create)
- Context menus / right-click actions on files
- Multi-file selection
- Presentation preview (`.tandem.ppt.json`)
- Extracted text (`read_file_text` for DOCX/PPTX/XLSX) — requires heavy Rust dependencies
