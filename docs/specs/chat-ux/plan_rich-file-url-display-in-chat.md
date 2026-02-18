# Implementation Plan: Rich File Display and URL Display in Chat Messages

## Context

The Cowork-Z chat interface currently renders agent messages using ReactMarkdown with basic link support. However, plain text URLs and file paths are not automatically detected and linkified. Additionally, when agents mention images or videos, users cannot preview them inline. This plan adds:

1. **Automatic URL Detection**: Plain text URLs (e.g., `https://example.com`) are detected and rendered as clickable links with an icon
2. **File Path Detection**: Absolute file paths (e.g., `/Users/name/file.txt`) are detected and rendered as clickable links with file type icons
3. **Media Thumbnails**: Images and videos mentioned in messages display thumbnail previews at the bottom of the message bubble
4. **Modal Preview**: Clicking image/video thumbnails opens an in-app modal with full preview and controls

This enhances the user experience by making agent responses more interactive and providing immediate access to referenced files and URLs.

---

## Architecture Overview

The solution uses a **preprocessing + custom ReactMarkdown components** approach:

1. **Content Enrichment** (preprocessing): Detects URLs and file paths in plain text (outside code blocks) and converts them to markdown link syntax
2. **Custom Link Renderer**: ReactMarkdown custom component intercepts link rendering to add icons and handle clicks via Tauri APIs
3. **Media Gallery**: Extracts previewable media paths and displays thumbnails below message content
4. **Preview Modal**: Reuses existing Dialog component for full-screen image/video previews

This approach avoids modifying the stored message content, preserving original data while enhancing display.

---

## Implementation Steps

### Phase 1: Core Utility Modules

#### 1.1 Create File Type Detection Utility

**New File**: `src/lib/file-utils.ts`

**Purpose**: Categorize files by extension and determine preview capability

**Key Functions**:
- `getFileExtension(filePath: string): string` - Extract lowercase extension without dot
- `analyzeFile(filePath: string): FileInfo` - Categorize file and check if previewable
- `isAbsolutePath(path: string): boolean` - Validate absolute paths (Unix/Windows)
- `looksLikeFilePath(text: string): boolean` - Heuristic detection for file paths vs regular text
- `isPathSafe(filePath: string): boolean` - Security validation to prevent directory traversal

**File Categories**:
- `image`: jpg, jpeg, png, gif, webp, svg, bmp, ico, tiff (previewable)
- `video`: mp4, webm, ogg, mov, avi, mkv, m4v (previewable)
- `code`: js, ts, py, java, css, html, json, md, etc. (not previewable)
- `document`: pdf, doc, docx, xls, xlsx, ppt, pptx (not previewable)
- `archive`: zip, tar, gz, rar, 7z (not previewable)
- `unknown`: All others (not previewable)

**Test File**: `src/lib/__tests__/file-utils.test.ts`
**Test Coverage**:
- `getFileExtension`: Extract extensions, handle no extension, case insensitivity
- `analyzeFile`: Categorize all file types, verify previewability flags
- `isAbsolutePath`: Unix paths, Windows paths, relative paths
- `looksLikeFilePath`: Valid paths, reject URLs, reject plain text
- `isPathSafe`: Directory traversal prevention, sensitive path blocking

> **Implementation Note**: `getFileExtension('.gitignore')` returns `''` for bare dotfiles without a directory prefix — `.gitignore` is a dotfile name, not a file with extension "gitignore". Dotfiles with a directory prefix (e.g., `/home/.bashrc`) correctly extract the extension. Also, the project's `tsconfig.json` targets below ES2022, so `Array.prototype.at()` is unavailable; `segments[segments.length - 1]` is used with a `biome-ignore` comment in `analyzeFile()`. 24 tests.

---

#### 1.2 Create Icon Mapping Utility

**New File**: `src/lib/icon-utils.ts`

**Purpose**: Map file categories and URL types to Lucide React icons

**Key Functions**:
- `getFileIcon(category: FileCategory): LucideIcon` - Returns appropriate icon for file category
- `getUrlIcon(): LucideIcon` - Returns Globe icon for URLs
- `getExternalLinkIcon(): LucideIcon` - Returns ExternalLink icon

**Icon Mapping**:
- Image files → `FileImage`
- Video files → `FileVideo`
- Code files → `FileCode`
- Documents → `FileText`
- Archives → `FileArchive`
- Unknown → `File`
- URLs → `Globe`

**Dependencies**: Uses existing Lucide React icons (already installed)

> **Implementation Note**: The icon mapping utility itself is unchanged, but icons were not rendering for backtick-wrapped `file:///` URLs because those paths were inside inline code and never reached the `EnhancedLink` component. The fix is in Section 2.1 — a custom `code` component was added to `createMarkdownComponents()` that detects file paths in inline code and renders them via `EnhancedLink`, which in turn uses `getFileIcon()` to display the correct icon.

---

#### 1.3 Create Content Enrichment Utility

**New File**: `src/lib/content-enrichment.ts`

**Purpose**: Detect and enrich plain text URLs and file paths with markdown link syntax

**Key Functions**:
- `enrichContentWithLinks(markdown: string): string` - Main preprocessing function that converts plain text URLs/paths to markdown links
- `extractMediaPaths(content: string): string[]` - Extract absolute file paths for previewable media
- `isInsideCodeBlock(text: string, position: number): boolean` - Helper to skip code blocks

**Detection Strategy**:
- **URLs**: Regex `/(?:https?|file):\/\/[^\s<>)\]]+/gi` — matches http(s) and `file:///` URLs not already in markdown links
- **File Paths (simple)**: Regex `/(?:\/[\w.+-]+)+(?:\/[\w.+-]*)?/g` — matches absolute Unix paths without spaces
- **File Paths (with spaces)**: Regex `/(?:\/(?:[^\s/][^/\n]*[^\s/]|[^\s/]))(?:\/...)*\.\w+/g` — matches paths containing spaces, parens, commas, etc., but only when ending with a file extension (`.xlsx`, `.pdf`, etc.) to avoid false positives in prose
- **Windows Paths**: Regex `/[A-Za-z]:[/\\](?:[^\s<>)\]*]+[/\\])*[^\s<>)\]*]+\.\w+/g` — matches `C:\dir\file.ext` and `D:/dir/file.ext` style paths
- **Code Block Handling**: Builds a range map of fenced (` ``` `) and inline (`` ` ``) code spans, then skips any match whose position falls inside one
- **Processing Order**: Broader regexes (space-aware) run before narrower regexes (simple) to capture the longest possible match; replacements applied in reverse order to maintain string indices
- **Markdown Link Detection**: Looks backwards from each match for `](` to avoid double-wrapping existing links

**Output Format**:
- Plain URL `https://example.com` → `[https://example.com](https://example.com)`
- File path `/usr/local/file.txt` → `[/usr/local/file.txt](file:///usr/local/file.txt)`
- `file:///` URL `file:///Users/name/photo.png` → `[/Users/name/photo.png](file:///Users/name/photo.png)` (display text strips the `file://` prefix)

**Edge Cases Handled**:
- Preserves existing markdown links (backward scan for `](`)
- Skips URLs/paths in inline code and fenced code blocks
- Handles multiple URLs/paths in single message
- Uses `file://` protocol prefix to distinguish file paths from URLs
- Trims trailing punctuation (`.`, `,`, `;`, etc.) from URLs

**`extractMediaPaths` — special handling**:
- Scans for `file:///` URLs **everywhere** including inside code blocks (agents commonly list file URLs in fenced code blocks; thumbnails are rendered separately and don't modify the code block text)
- Scans for bare absolute Unix/macOS paths **everywhere** including inside code blocks — `addIfPreviewable` filters to image/video extensions, avoiding false positives in code
- Scans for home-relative paths (`~/dir/file.ext`) everywhere
- Scans for bare Windows paths (`C:\dir\file.ext`, `D:/dir/file.ext`) everywhere — reuses the same `winPathRe` regex from `enrichContentWithLinks`
- Deduplicates paths

**Test File**: `src/lib/__tests__/content-enrichment.test.ts`

> **Implementation Note**: File path detection was expanded from a single simple-path regex to three regex passes: (1) space-aware paths with file extensions, (2) simple paths without spaces, (3) Windows paths. The broader space-aware regex runs first so it captures the longest possible match (e.g., `/Users/name/My Documents/report.pdf`), and the simple regex skips positions already covered. The `extractMediaPaths` `fileUrlRe` was also broadened from `/file:\/\/\/([\w.+/-]+)/g` to `/file:\/\/\/([^\n<>)\]\`]+)/g` to capture paths with spaces and special characters. `extractMediaPaths` was further enhanced to detect bare paths everywhere (including inside code blocks), added home-relative (`~/`) path detection and Windows path detection. Total test count increased from 25 to 38.

---

### Phase 2: Custom ReactMarkdown Components

#### 2.1 Create Enhanced Link Renderer

**New File**: `src/components/markdown/EnhancedLink.tsx`

**Purpose**: Custom ReactMarkdown link component with icons and Tauri API integration

**Component**: `EnhancedLink`

**Features**:
- Detects `file://` protocol to distinguish file paths from URLs
- Shows appropriate icon (file type icon for files, globe for URLs)
- Intercepts click events to use Tauri APIs instead of browser navigation
- For file paths: calls `api.revealInFinder(path)` to show file in Finder
- For URLs: calls `api.openExternal(url)` to open in default browser
- Path safety validation before opening files
- Displays full path in `title` attribute for hover tooltip
- Truncates very long paths in display (40 chars + "..." + 17 chars)

**Styling**:
- Inline flex layout with gap for icon + text
- Primary color with underline (matches existing prose styles)
- Hover effect (opacity 80%)
- Icons sized at 3.5x3.5 (14px)
- Text uses `break-all` for long URLs/paths

**Export**: `createMarkdownComponents()` function returns `Partial<Components>` for ReactMarkdown

**Security**: Validates paths with `isPathSafe()` to prevent directory traversal and access to sensitive system locations

**Custom `code` Component**:

AI agents commonly wrap `file:///` URLs and file paths in backticks (e.g., `` `file:///Users/name/data.xlsx` ``). The content enrichment step intentionally skips inline code, so these paths would render as plain `<code>` elements with no icons or click handlers.

`createMarkdownComponents()` now also returns a custom `code` component that:
- Only intercepts **inline** code (not fenced code blocks — fenced blocks have a `className` like `language-bash` from react-markdown)
- Detects if the inline code content is a `file:///` URL or an absolute file path (Mac `/...` or Windows `C:\...`)
- When detected, renders the content as an `EnhancedLink` (with icon, click-to-reveal) instead of `<code>`
- Falls through to standard `<code>` rendering for ordinary inline code (e.g., `` `npm install` ``)

Helper: `inlineCodeToHref(text: string): string | null` — returns the `file://` href if the text is a file path, or `null` for ordinary code.

**Test File**: `src/components/markdown/__tests__/EnhancedLink.test.tsx`

> **Implementation Note**: The custom `code` component is the primary fix for the "icons not displaying" issue. The root cause was that backtick-wrapped file URLs were skipped by content enrichment (correctly — modifying code blocks would break rendering), but then rendered as plain `<code>` with no interactivity. The `code` component intercepts at render time instead, reusing the existing `EnhancedLink` for consistent behavior. Total test count for this file increased from 6 to 12.

---

### Phase 3: Media Preview Components

#### 3.1 Create Media Thumbnail Component

**New File**: `src/components/media/MediaThumbnail.tsx`

**Component**: `MediaThumbnail`

**Props**:
- `filePath: string` - Absolute path to media file
- `onClick: () => void` - Callback when thumbnail is clicked

**Features**:
- Fixed size: 128x128px square with rounded borders
- Uses Tauri's `convertFileSrc(filePath)` to load local files securely via asset protocol
- Renders `<img>` for images, `<video>` for videos (no controls)
- Error state: Shows `AlertCircle` icon with "Failed to load" message
- Hover overlay: Semi-transparent black overlay with file type icon
- Click handler: Triggers modal preview

**Styling**:
- Border with hover effect (border-primary on hover)
- Object-fit: cover (fills square, maintains aspect ratio)
- Transition effects on border and overlay opacity

**Testing**: Component tests for rendering, error handling, and click events

> **Implementation Note**: Biome's `noNoninteractiveElementInteractions` rule flagged the `onError` handler on `<img>` as an accessibility issue. This is a false positive (`onError` is a lifecycle event, not a user interaction), so it's suppressed with a `biome-ignore` comment.

---

#### 3.2 Create Media Preview Modal

**New File**: `src/components/media/MediaPreviewModal.tsx`

**Component**: `MediaPreviewModal`

**Props**:
- `filePath: string | null` - Path to preview (null when closed)
- `open: boolean` - Modal open state
- `onOpenChange: (open: boolean) => void` - Close callback

**Features**:
- Reuses existing `Dialog` component from `src/components/ui/dialog.tsx`
- Header shows filename and controls
- "Show in Finder" button calls `api.revealInFinder(filePath)`
- Close button (X icon) in top-right corner
- ESC key closes modal (via useEffect keyboard listener)
- Content area: Black/transparent background with centered media
- Images: `<img>` with `max-h-[70vh]` and `object-contain`
- Videos: `<video>` with `controls` attribute enabled for playback
- Uses `convertFileSrc()` for secure file loading

**Styling**:
- Max width: 5xl (80rem)
- Responsive sizing with viewport-relative height limits
- Rounded corners on media elements
- Clean header with title and action buttons

**Keyboard Shortcuts**:
- ESC: Close modal

**Testing**: Component tests for open/close behavior, keyboard shortcuts, and button actions

---

#### 3.3 Create Media Gallery Component

**New File**: `src/components/media/MediaGallery.tsx`

**Component**: `MediaGallery`

**Props**:
- `filePaths: string[]` - Array of file paths from message content

**Features**:
- Filters input paths to only previewable media (images/videos)
- Renders nothing if no previewable files
- Flex wrap layout with 2-unit gap between thumbnails
- Single shared `MediaPreviewModal` for all thumbnails
- State management: `previewPath` tracks which file to preview
- Modal opens when thumbnail clicked, closes via modal callback

**Layout**:
- `mt-3` top margin (spacing from message content)
- Flex wrap allows responsive grid layout
- Thumbnails naturally flow to multiple rows if needed

**Test File**: `src/components/media/__tests__/MediaGallery.test.tsx`
**Test Coverage**:
- Render thumbnails for image files
- Render thumbnails for video files
- Filter out non-previewable files (PDFs, code files)
- Render nothing when no media files
- Correct thumbnail count with mixed file types

---

### Phase 4: Integration into MessageBubble

**Modified File**: `src/pages/Execution.tsx`

**Changes Required**:

#### 4.1 Add Imports (around line 42)

#### 4.2 Create Markdown Components Instance (inside MessageBubble, after displayContent useMemo)

#### 4.3 Enrich Content (after markdownComponents)

#### 4.4 Update ReactMarkdown Instances (3 locations: lines ~1370, ~1378, ~1384)

Replace all ReactMarkdown uses with:
```typescript
<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
  {displayedText}
</ReactMarkdown>
```

And use `enrichedContent` instead of `displayContent` in streaming/static rendering.

#### 4.5 Add Media Gallery (before timestamp, after message content around line 1387)

**Design Rationale**:
- Minimal changes to existing MessageBubble component
- All new logic encapsulated in utilities and components
- Preserves existing streaming functionality
- Uses existing prose styles for consistent look
- Media gallery only for assistant messages (most relevant use case)

---

### Phase 5: Type Safety and Build Validation

#### 5.1 Run Type Checking
```bash
pnpm typecheck
```
**Expected Result**: No TypeScript errors

#### 5.2 Run Test Suite
```bash
pnpm test
```
**Expected Result**: All tests pass

#### 5.3 Run Full Build
```bash
pnpm build
```
**Expected Result**: Build succeeds with no errors

#### 5.4 Run Code Quality Check
```bash
pnpm dlx ultracite check src/
```
**Expected Result**: No linting errors (or only minor warnings)

---

### Phase 6: End-to-End Testing

#### 6.1 Start Development Server
```bash
pnpm tauri dev
```

#### 6.2 Create Test Task

Create a new task with a prompt that will generate file references:
- "Please create a screenshot of the current window and save it to my Desktop"
- "List all PNG files in my Documents folder"
- "Show me the contents of /etc/hosts"

#### 6.3 Verify Functionality

1. Check that agent responses contain file paths
2. Verify file paths are rendered as clickable links with icons
3. Click file paths to verify they open/reveal correctly
4. If images are referenced, verify thumbnails appear
5. Click thumbnails to verify modal preview works

#### 6.4 Test URL Handling

Create a task that generates URLs:
- "Give me some useful links for learning Tauri development"
- "What's the GitHub repository URL for this project?"

Verify URLs are rendered with icons and clickable.

---

## Security Considerations

### Path Safety Validation

**Implementation**: `isPathSafe()` function in `file-utils.ts`

**Protections**:
1. **Directory Traversal**: Blocks paths containing `..` (prevents `../../etc/passwd`)
2. **Sensitive System Paths** (macOS-specific):
   - `/System/` - macOS system files
   - `/Library/Keychains/` - Keychain data
   - `/private/var/db/` - System databases
   - `/.Trash/` - Deleted files

**Enforcement**: `EnhancedLink` component validates paths before calling `revealInFinder()`

---

### URL Safety

**Implementation**: Process http(s) and `file:///` URLs in content enrichment

**Protections**:
1. Regex pattern only matches `http://`, `https://`, and `file:///` protocols
2. No support for `javascript:`, `data:`, or other potentially dangerous protocols
3. `file:///` URLs are routed through path safety validation (`isPathSafe()`) before opening
4. External links use `rel="noopener noreferrer"` for security

> **Implementation Note**: The original plan only matched `https?://`. This was expanded to `(?:https?|file)://` after real-world testing showed agents commonly output `file:///` URLs. The `file:///` URLs are treated as file paths by the `EnhancedLink` component (clicking reveals in Finder, not opens in browser).

---

### File Access Validation

**Tauri Integration**: All file access goes through Tauri's secure APIs
- `convertFileSrc()` - Converts local paths to secure asset protocol URLs
- `revealInFinder()` - Uses Tauri plugin with OS-level permissions
- `openExternal()` - Sandboxed external URL opening

No direct file system access from frontend JavaScript.

> **Implementation Note**: `convertFileSrc()` was added to `src/lib/tauri-api.ts` as a thin re-export of `tauriConvertFileSrc` from `@tauri-apps/api/core`. The Tauri asset protocol must be explicitly enabled in `src-tauri/tauri.conf.json` under `app.security.assetProtocol` with `"enable": true` and a `"scope"` array. Without this, the webview returns 403 Forbidden for all asset URLs. The scope is set to `["**"]` (all files) since the agent can reference files anywhere on the user's filesystem. The CSP is `null` (permissive) so no CSP changes were needed. The existing `core:default` permission in capabilities covers the asset protocol; `opener:default` covers `revealInFinder` and `openExternal`.

---

## Performance Optimization

### Memoization Strategy

**Content Processing**:
- `enrichContentWithLinks()` wrapped in `useMemo` with `[displayContent]` dependency
- `extractMediaPaths()` wrapped in `useMemo` with `[displayContent]` dependency
- `createMarkdownComponents()` wrapped in `useMemo` with `[]` (once per component lifetime)

**Component Rendering**:
- `EnhancedLink` uses `memo()` to prevent unnecessary re-renders
- `MediaThumbnail` uses `memo()` to cache thumbnail renders
- MessageBubble already uses `memo()` with custom equality function

**Result**: Content enrichment only runs when message content changes, not on every parent re-render

---

### Lazy Loading

**Thumbnail Loading**:
- Images/videos only load when thumbnail is rendered (conditional rendering)
- No eager loading of all media in message
- Browser handles lazy loading of `<img>` elements naturally

**Modal Loading**:
- Preview modal only renders when `open={true}`
- Full-size media only loads when modal opens (not on page load)

---

### Regex Performance

**Multi-Pass Processing**:
- URL regex executes once per message
- File path detection uses three sequential regex passes: (1) space-aware paths, (2) simple paths, (3) Windows paths — broader regexes run first to capture longest matches
- Each pass skips positions already covered by earlier matches (overlap check)
- Reverse processing order avoids repeated string scanning during replacement
- Negative lookbehind regex prevents double-processing markdown links

**Expected Performance**: <5ms for typical message (500 chars, 2-3 URLs/paths). The additional regex passes add negligible overhead since each match is checked against the existing match list (O(n*m) where n=matches and m is small).

---

## Success Criteria

Implementation is considered complete and successful when:

1. All 19 manual verification steps pass
2. Type checking passes (`pnpm typecheck`)
3. Test suite passes (`pnpm test`)
4. Build succeeds (`pnpm build`)
5. Code quality check passes (no critical issues)
6. Plain URLs render as clickable links with globe icon
7. File paths render as clickable links with file type icons
8. Image/video thumbnails display below message content
9. Modal preview works for images and videos
10. Security validation prevents access to sensitive paths
11. Code blocks are not linkified (URLs/paths remain plain)
12. Performance remains smooth (no visible lag)
13. Streaming text continues to work correctly
14. No console errors or warnings