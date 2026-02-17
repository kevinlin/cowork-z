# Workspace-as-Folder — Design Document Phase 2: File Preview Panel

Date: 2026-02-17

## Overview

Phase 2 adds a closable, resizable right-side file preview panel to the workspace layout. Clicking a file in the file tree (or a media thumbnail in chat) opens the preview. The panel supports code (syntax-highlighted), markdown, images, video, PDFs, HTML, plain text, and binary files. It includes fullscreen mode and an "Add to Chat" button.

This phase also replaces `MediaPreviewModal` — media thumbnails in chat messages open the same file preview panel instead of a modal dialog.

## Phasing Context

- **Phase 1 (complete):** Workspace lifecycle, switching, file tree browser, permission integration.
- **Phase 2 (this document):** File preview panel (code highlighting, markdown rendering, images, video, PDF, HTML), resizable panel, fullscreen mode, "Add to Chat" bridge.

---

## 1. Rust Backend: New File-Reading Commands

Two new Tauri commands are added in a new `src-tauri/src/commands/files.rs` module.

### `read_file_content`

Reads UTF-8 text content from a file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `String` | required | Absolute file path |
| `max_size` | `Option<u64>` | 1 MB | Maximum file size in bytes |

**Behavior:**
1. Validate path exists and is a file (not a directory)
2. Check file size against `max_size`; reject if too large
3. Read with `std::fs::read_to_string`
4. Return content as `String`

### `read_binary_file`

Reads binary content and returns base64-encoded string.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `String` | required | Absolute file path |
| `max_size` | `Option<u64>` | 10 MB | Maximum file size in bytes |

**Behavior:**
1. Validate path exists and is a file
2. Check file size against `max_size`
3. Read with `std::fs::read`
4. Encode with `base64::engine::general_purpose::STANDARD`
5. Return base64 string

**New Cargo dependency:** `base64 = "0.22"`

Both commands are registered in `lib.rs` under the `invoke_handler`.

---

## 2. Frontend: Tauri API Wrappers

New functions added to `src/lib/tauri-api.ts`:

```typescript
export async function readFileContent(path: string, maxSize?: number): Promise<string>
export async function readBinaryFile(path: string, maxSize?: number): Promise<string>
```

These call `invoke('read_file_content', ...)` and `invoke('read_binary_file', ...)` respectively.

---

## 3. File Preview Store

A new Zustand store (`src/stores/filePreviewStore.ts`) manages preview state globally. This is separate from `taskStore` because preview state is orthogonal to task state and needs to be accessed from both the sidebar (`FileTreePanel`) and chat messages (`MediaGallery`).

### State

| Field | Type | Description |
|-------|------|-------------|
| `selectedFile` | `DirectoryEntry \| null` | The file being previewed |
| `isPreviewOpen` | `boolean` | Whether the preview panel is visible |

### Actions

| Action | Description |
|--------|-------------|
| `openPreview(file)` | Sets `selectedFile` and `isPreviewOpen = true` |
| `closePreview()` | Sets `selectedFile = null` and `isPreviewOpen = false` |
| `openPreviewByPath(path)` | Constructs a `DirectoryEntry` from a path string and opens preview (for MediaGallery integration) |

---

## 4. File Preview Components

All new components live under `src/components/file-preview/`.

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
        ├── PdfPreview (readBinaryFile → base64 data URL → embed)
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

### FilePreviewPanel

The main panel component. Receives `file: DirectoryEntry`, `onClose()`, and optional `onAddToChat()`.

**Docked mode:** Renders as a right-side panel in the flex layout (default 400px, resizable 280–700px via drag handle), `border-l`.

**Fullscreen mode:** Renders via `createPortal` to `document.body` as a fixed overlay (`fixed inset-0 z-50`). Escape key exits fullscreen. Switching files resets to docked mode.

**Header bar:** File type icon, file name (truncated), full path (muted), maximize/minimize toggle, "Add to Chat" button, close (X) button.

**Loading state:** Centered spinner while content is being fetched.

**Error state:** Error icon and message.

### CodePreview

Uses `react-syntax-highlighter` with `oneDark` theme. Shows line numbers. Extension-to-language mapping via `getLanguageFromExtension()`.

### MarkdownPreview

Uses `react-markdown` with `remark-gfm` plugin. Code blocks within markdown get syntax highlighting with a macOS-style header bar (three colored dots + language label).

### MediaPreview

A combined image/video component. Uses `convertFileSrc()` to load media directly via Tauri's asset protocol. Accepts an `isVideo` prop to switch between `<img>` and `<video controls>` rendering. The `<video>` element includes a `<track kind="captions">` for accessibility.

### PdfPreview

Loads via `readBinaryFile()` → base64 data URL → `<embed type="application/pdf">`.

### HtmlPreview

Sandboxed iframe with `srcDoc`. Sandbox permissions: `allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms`. No `allow-same-origin` for security. `<base href>` injected via `convertFileSrc()` for relative asset resolution. `referrerPolicy="no-referrer"`.

### TextPreview

Plain monospace `<pre>` text, scrollable.

### BinaryPreview

Generic file icon with file name and formatted file size. No content preview.

---

## 5. Layout Integration

The `App.tsx` layout changes from:

```
[Sidebar] [Main (flex-1)]
```

To:

```
[Sidebar] [Main (flex-1)] [ResizeHandle] [FilePreviewPanel (conditional, 280–700px)]
```

The preview panel is a direct sibling of `<main>` in the flex container. It renders conditionally based on `filePreviewStore.isPreviewOpen`.

---

## 6. FileTreePanel Integration

The `handleSelect` callback in `FileTreePanel` changes from calling `revealInFinder(path)` to calling `filePreviewStore.openPreview(entry)`.

The `TreeRow` component's `onSelect` callback is updated to pass the full `DirectoryEntry` object (not just the path string), so the preview store receives all metadata (name, extension, size, etc.).

The selected file is visually highlighted by comparing `entry.path` with `filePreviewStore.selectedFile?.path`.

---

## 7. MediaGallery Integration

`MediaGallery` is updated to use `filePreviewStore.openPreviewByPath(path)` instead of the local `previewPath` state + `MediaPreviewModal`.

`MediaPreviewModal` is deleted from the codebase. All media preview now goes through the unified file preview panel.

---

## 8. "Add to Chat" Integration

The "Add to Chat" button in the preview header inserts the file as an `@path` reference into the active chat input. This uses the existing `formatPathForChat()` utility from `src/lib/file-utils.ts`.

The mechanism mirrors the existing drag-and-drop from the file tree: the formatted path is dispatched via a custom event that the chat input listens for, or via a store action.

---

## 9. New npm Dependencies

| Package | Purpose |
|---------|---------|
| `react-syntax-highlighter` | Code syntax highlighting |
| `@types/react-syntax-highlighter` | TypeScript types |

Existing dependencies used: `react-markdown`, `remark-gfm`.

---

## 10. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Escape | Exit fullscreen preview |

---

## Not In Scope (deferred)

- Presentation preview (`.tandem.ppt.json`) — Tandem-specific format
- Extracted text (`read_file_text` for DOCX/PPTX/XLSX) — requires heavy Rust dependencies
- "Open in Browser" button for HTML files
