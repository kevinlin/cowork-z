# Workspace-as-Folder — Implementation Plan Phase 2: File Preview Panel

Date: 2026-02-17

## Task 1: Rust Backend — File-Reading Commands

**Files:**
- Create `src-tauri/src/commands/files.rs`
- Edit `src-tauri/src/commands/mod.rs` — add `pub mod files;`
- Edit `src-tauri/src/lib.rs` — register `read_file_content`, `read_binary_file`
- Edit `src-tauri/Cargo.toml` — add `base64 = "0.22"`

**Implementation:**
- `read_file_content(path, max_size?)` — validate path, check size (default 1 MB), `read_to_string`, return content
- `read_binary_file(path, max_size?)` — validate path, check size (default 10 MB), `read`, base64 encode, return string

## Task 2: Frontend — Tauri API Wrappers

**Files:**
- Edit `src/lib/tauri-api.ts` — add `readFileContent()`, `readBinaryFile()` wrappers

## Task 3: npm Dependencies

**Commands:**
- `pnpm add react-syntax-highlighter`
- `pnpm add -D @types/react-syntax-highlighter`

## Task 4: File Preview Store

**Files:**
- Create `src/stores/filePreviewStore.ts`

**State:** `selectedFile`, `isPreviewOpen`
**Actions:** `openPreview`, `closePreview`, `openPreviewByPath`

## Task 5: Preview Utilities

**Files:**
- Create `src/components/file-preview/preview-utils.ts`

**Contents:** `PreviewType`, `getPreviewType()`, `getLanguageFromExtension()`, `formatFileSize()`, extension sets

## Task 6: Preview Sub-Components

**Files:**
- Create `src/components/file-preview/CodePreview.tsx`
- Create `src/components/file-preview/MarkdownPreview.tsx`
- Create `src/components/file-preview/HtmlPreview.tsx`
- Create `src/components/file-preview/MediaPreview.tsx` — combined image/video component (replaces `ImagePreview.tsx`)
- Create `src/components/file-preview/PdfPreview.tsx`
- Create `src/components/file-preview/TextPreview.tsx`
- Create `src/components/file-preview/BinaryPreview.tsx`

## Task 7: FilePreviewPanel

**Files:**
- Create `src/components/file-preview/FilePreviewPanel.tsx`
- Create `src/components/file-preview/index.ts`

**Features:** Header bar, fullscreen toggle, loading/error states, preview type dispatch, portal for fullscreen

## Task 8: Layout Integration

**Files:**
- Edit `src/App.tsx` — add `FilePreviewPanel` as conditional right-side panel

## Task 9: FileTreePanel Integration

**Files:**
- Edit `src/components/sidebar/FileTreePanel.tsx` — change `handleSelect` to open preview, pass `DirectoryEntry` to `onSelect`, add selected file highlighting

## Task 10: MediaGallery Integration

**Files:**
- Edit `src/components/media/MediaGallery.tsx` — use `filePreviewStore.openPreviewByPath()`
- Delete `src/components/media/MediaPreviewModal.tsx`
- Edit `src/components/media/__tests__/MediaGallery.test.tsx` — update tests

## Task 11: Add to Chat

**Files:**
- Edit `src/components/file-preview/FilePreviewPanel.tsx` — wire "Add to Chat" button

## Task 12: Video Preview Support

**Files:**
- Edit `src/components/file-preview/preview-utils.ts` — add `'video'` to `PreviewType`, add `VIDEO_EXTENSIONS` set
- Rename `src/components/file-preview/ImagePreview.tsx` → `MediaPreview.tsx` — add `isVideo` prop, render `<video controls>` with `<track kind="captions">` for video files
- Edit `src/components/file-preview/FilePreviewPanel.tsx` — import `MediaPreview`, add `Video` icon, add `'video'` case to render dispatch and loading skip

## Task 13: Resizable Preview Panel

**Files:**
- Edit `src/App.tsx` — add drag handle (`role="separator"`) between main and preview panel, mouse-event-based resize (min 280px, max 700px, default 400px), ARIA attributes for accessibility

## Task 14: "Add to Chat" Event Wiring

**Files:**
- Edit `src/App.tsx` — dispatch `CustomEvent('add-to-chat')` with formatted `@path` reference
- Edit `src/components/landing/TaskInputBar.tsx` — listen for `add-to-chat` event, insert text at cursor
- Edit `src/components/chat/ChatInput.tsx` — listen for `add-to-chat` event, insert text at cursor

## Task 15: Symbolic Link Support in Backend

**Files:**
- Edit `src-tauri/src/commands/files.rs` — update `read_directory` to detect symlinks via `symlink_metadata`, set `is_symlink` on `DirectoryEntry`
- Edit `src-tauri/src/types.rs` — add `is_symlink: bool` to `DirectoryEntry`

**Implementation:**
- Use `std::fs::symlink_metadata` on each entry to check `file_type().is_symlink()`
- If symlink, resolve the target type via `std::fs::metadata` (follows the link) for `is_directory`
- If symlink target is missing/unreadable, return the entry with `is_directory: false`, `is_symlink: true`
- Windows `.lnk` files are not treated as symbolic links

## Task 16: Symbolic Link Support in Frontend

**Files:**
- Edit `src/shared/types/workspace.ts` — add `is_symlink: boolean` to `DirectoryEntry`
- Edit `src/lib/tauri-api.ts` — no changes needed (DirectoryEntry flows through)
- Edit `src/components/sidebar/FileTreePanel.tsx` — render link overlay badge on symlink entries

**Implementation:**
- Import a link icon (e.g. `Link` from lucide-react) and render it as a small overlay on the base type icon when `entry.is_symlink` is true
- Symlink folders expand and lazy-load children identically to regular folders (no frontend logic change needed — `read_directory` follows the link on the backend)

## Task 17: Open in File Manager / Default App (Item Action)

**Files:**
- Edit `src/components/sidebar/FileTreePanel.tsx` — add hover action button on all rows

**Implementation:**
- No new Rust commands — reuses existing `revealInFinder()` (folders) and `openFilePath()` (files) from `tauri-api.ts`, both already backed by the `@tauri-apps/plugin-opener` with `opener:default` permissions
- All rows get an `ExternalLink` icon button (lucide-react), visible on hover via `opacity-0 group-hover/row:opacity-100`
- Folders: calls `revealInFinder(entry.path)` — reveals in Finder/Explorer
- Files: calls `openFilePath(entry.path)` — opens with system default app

## Task 18: Delete File/Folder (Move to Trash)

**Files:**
- Edit `src-tauri/Cargo.toml` — add `trash = "5"` dependency
- Edit `src-tauri/src/commands/files.rs` — add `trash_file` command
- Edit `src-tauri/src/lib.rs` — register `trash_file` command
- Edit `src/lib/tauri-api.ts` — add `trashFile(path: string)` wrapper
- Edit `src/lib/tauri-api-interface.ts` — add `trashFile` to `TauriAPI` interface
- Edit `src/components/sidebar/FileTreePanel.tsx` — add hover action button on all rows, refresh tree after delete

**Implementation:**
- Rust: `trash_file(path: String)` — calls `trash::delete(path)` to move both files and folders to system trash
- All rows get a `Trash2` icon button (lucide-react), visible on hover via `opacity-0 group-hover/row:opacity-100`
- On successful delete, calls `refreshRoot()` (via `onDelete` prop) to immediately update the tree
- The filesystem watcher also triggers a backup refresh after the item is removed

## Verification

- `pnpm typecheck`
- `cd src-tauri && cargo check`
- `npx biome check --write` on changed files
- `pnpm test --run`

---

## Implementation Log

### Fix: CodePreview theme-aware syntax highlighting (2026-02-19)

**Problem:** `CodePreview` hardcoded `oneDark` style regardless of the active app theme, causing dark syntax highlighting on light backgrounds.

**Fix:** Import both `oneLight` and `oneDark` from `react-syntax-highlighter`. Use `useSyncExternalStore` with a `MutationObserver` on `<html>` class changes to reactively detect whether the `dark` class is present (already toggled by `applyTheme()`). Pass `isDark ? oneDark : oneLight` to the highlighter.

**Files changed:** `src/components/file-preview/CodePreview.tsx`