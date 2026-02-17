# Workspace-as-Folder — Implementation Plan Phase 2: File Preview Panel

Date: 2026-02-17

## Task List

### Task 1: Rust Backend — File-Reading Commands

**Files:**
- Create `src-tauri/src/commands/files.rs`
- Edit `src-tauri/src/commands/mod.rs` — add `pub mod files;`
- Edit `src-tauri/src/lib.rs` — register `read_file_content`, `read_binary_file`
- Edit `src-tauri/Cargo.toml` — add `base64 = "0.22"`

**Implementation:**
- `read_file_content(path, max_size?)` — validate path, check size (default 1 MB), `read_to_string`, return content
- `read_binary_file(path, max_size?)` — validate path, check size (default 10 MB), `read`, base64 encode, return string

### Task 2: Frontend — Tauri API Wrappers

**Files:**
- Edit `src/lib/tauri-api.ts` — add `readFileContent()`, `readBinaryFile()` wrappers

### Task 3: npm Dependencies

**Commands:**
- `pnpm add react-syntax-highlighter`
- `pnpm add -D @types/react-syntax-highlighter`

### Task 4: File Preview Store

**Files:**
- Create `src/stores/filePreviewStore.ts`

**State:** `selectedFile`, `isPreviewOpen`
**Actions:** `openPreview`, `closePreview`, `openPreviewByPath`

### Task 5: Preview Utilities

**Files:**
- Create `src/components/file-preview/preview-utils.ts`

**Contents:** `PreviewType`, `getPreviewType()`, `getLanguageFromExtension()`, `formatFileSize()`, extension sets

### Task 6: Preview Sub-Components

**Files:**
- Create `src/components/file-preview/CodePreview.tsx`
- Create `src/components/file-preview/MarkdownPreview.tsx`
- Create `src/components/file-preview/HtmlPreview.tsx`
- Create `src/components/file-preview/MediaPreview.tsx` — combined image/video component (replaces `ImagePreview.tsx`)
- Create `src/components/file-preview/PdfPreview.tsx`
- Create `src/components/file-preview/TextPreview.tsx`
- Create `src/components/file-preview/BinaryPreview.tsx`

### Task 7: FilePreviewPanel

**Files:**
- Create `src/components/file-preview/FilePreviewPanel.tsx`
- Create `src/components/file-preview/index.ts`

**Features:** Header bar, fullscreen toggle, loading/error states, preview type dispatch, portal for fullscreen

### Task 8: Layout Integration

**Files:**
- Edit `src/App.tsx` — add `FilePreviewPanel` as conditional right-side panel

### Task 9: FileTreePanel Integration

**Files:**
- Edit `src/components/sidebar/FileTreePanel.tsx` — change `handleSelect` to open preview, pass `DirectoryEntry` to `onSelect`, add selected file highlighting

### Task 10: MediaGallery Integration

**Files:**
- Edit `src/components/media/MediaGallery.tsx` — use `filePreviewStore.openPreviewByPath()`
- Delete `src/components/media/MediaPreviewModal.tsx`
- Edit `src/components/media/__tests__/MediaGallery.test.tsx` — update tests

### Task 11: Add to Chat

**Files:**
- Edit `src/components/file-preview/FilePreviewPanel.tsx` — wire "Add to Chat" button

### Task 12: Video Preview Support

**Files:**
- Edit `src/components/file-preview/preview-utils.ts` — add `'video'` to `PreviewType`, add `VIDEO_EXTENSIONS` set
- Rename `src/components/file-preview/ImagePreview.tsx` → `MediaPreview.tsx` — add `isVideo` prop, render `<video controls>` with `<track kind="captions">` for video files
- Edit `src/components/file-preview/FilePreviewPanel.tsx` — import `MediaPreview`, add `Video` icon, add `'video'` case to render dispatch and loading skip

### Task 13: Resizable Preview Panel

**Files:**
- Edit `src/App.tsx` — add drag handle (`role="separator"`) between main and preview panel, mouse-event-based resize (min 280px, max 700px, default 400px), ARIA attributes for accessibility

### Task 14: "Add to Chat" Event Wiring

**Files:**
- Edit `src/App.tsx` — dispatch `CustomEvent('add-to-chat')` with formatted `@path` reference
- Edit `src/components/landing/TaskInputBar.tsx` — listen for `add-to-chat` event, insert text at cursor
- Edit `src/components/chat/ChatInput.tsx` — listen for `add-to-chat` event, insert text at cursor

### Task 15: Verification

- `pnpm typecheck`
- `cd src-tauri && cargo check`
- `npx biome check --write` on changed files
- `pnpm test --run`
