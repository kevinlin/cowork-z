# Implementation Plan: Drag-and-Drop Support

## Context

This implements requirement 3.5 from the Cowork-Z feature requirements: **Drag-and-Drop File References**.

Users currently need to type full file paths manually when referencing files in chat prompts. This feature enables users to drag files or folders from their OS file manager (Finder, Explorer) directly into the chat input, automatically inserting them as `@path/to/file` references. Paths with spaces are automatically quoted as `@"path with spaces.txt"`.

This improves productivity by reducing friction when working with local files and aligns with the product vision of seamless local-first workflows.

## Implementation Approach

### Architecture Overview

The implementation consists of three layers:

1. **Path Formatting Utilities** — Pure functions for path formatting and cursor management
2. **DragDropInput Component** — Wrapper around existing Input component with Tauri native drag-drop handling
3. **Integration Layer** — Replace Input in Execution page with DragDropInput; add Tauri drag-drop listener to Home page TaskInputBar

This separation keeps concerns isolated, makes testing straightforward, and reuses existing path validation utilities.

### Key Design Decisions

- **Tauri Native Drag-Drop API**: Use `getCurrentWebview().onDragDropEvent()` from `@tauri-apps/api/webview` instead of HTML5 DOM drag-drop events. Tauri 2.x intercepts file drops at the native WebView level when `dragDropEnabled` is `true` (the default), which means HTML5 DOM `drop` events never fire with file data. The Tauri API provides absolute filesystem paths directly via `event.payload.paths`, which is simpler and more reliable than the non-standard `File.path` property used in Electron.
- **Component Wrapper Pattern**: Create `DragDropInput` wrapper instead of modifying `Input` directly, keeping the base component pristine
- **Security First**: All dropped paths are validated with existing `isPathSafe()` before insertion; unsafe paths are silently filtered
- **Cursor Position Tracking**: Use `selectionStart`/`selectionEnd` from input ref, stored in component state, updated on change/click/keyup. Refs (`valueRef`, `cursorPositionRef`) provide access to latest React state inside the async Tauri event callback.
- **Visual Feedback**: Match existing focus-visible styling (`ring-2 ring-ring`) for consistency
- **Multiple Files**: Join formatted paths with space separator

---

## Critical Files

### Files to Modify

1. **`src/lib/file-utils.ts`**
   - Add `needsQuoting(path: string): boolean` — Detects spaces/special chars requiring quotes
   - Add `formatPathForChat(path: string): string | null` — Formats as `@path` or `@"path"`, returns null for unsafe paths
   - Add `insertAtCursor(text, insertText, pos): { newText, newCursorPosition }` — Inserts text at cursor position

2. **`src/pages/Execution.tsx`** (lines 1069-1106)
   - Import `DragDropInput` from `@/components/ui/drag-drop-input`
   - Replace `<Input>` with `<DragDropInput>`
   - Add `onFilesDropped` callback that updates state and restores cursor position

3. **`src/components/landing/TaskInputBar.tsx`**
   - Add Tauri native drag-drop listener directly to the component (uses `<textarea>` not `<Input>`)
   - Import `getCurrentWebview` from `@tauri-apps/api/webview`, `formatPathForChat`, `insertAtCursor` from `@/lib/file-utils`, and `cn` from `@/lib/utils`
   - Track `isDraggingOver` and `cursorPosition` in local state
   - Add refs (`valueRef`, `cursorPositionRef`, `onChangeRef`) to access latest values inside the async Tauri event callback
   - Subscribe to `getCurrentWebview().onDragDropEvent()` in a `useEffect` with cleanup
   - Apply `ring-2 ring-ring` visual feedback via `cn()` on the wrapper div
   - Wire `onClick`/`onKeyUp` on the `<textarea>` for cursor tracking

### Files to Create

3. **`src/components/ui/drag-drop-input.tsx`** (NEW)
   - Wrapper component using Tauri's `onDragDropEvent` for native file drop handling
   - Tracks cursor position in local state, with refs for async callback access
   - Manages `isDraggingOver` state for visual feedback
   - Calls `onFilesDropped` callback with new value and cursor position

4. **`src/lib/__tests__/file-utils.test.ts`** (NEW)
   - Unit tests for `needsQuoting()` — paths with/without spaces, special chars
   - Unit tests for `formatPathForChat()` — Unix/Windows paths, unsafe paths, quoting
   - Unit tests for `insertAtCursor()` — insert at start/middle/end, empty string

5. **`src/components/ui/__tests__/drag-drop-input.test.tsx`** (NEW)
   - Component rendering tests
   - Drag-over/drag-leave visual feedback tests
   - Single file drop test
   - Multiple file drop test (space-separated)
   - Path quoting test (paths with spaces)
   - Unsafe path filtering test
   - Cursor position restoration test
   - Callback invocation tests

6. **`src/pages/__tests__/Execution.dragdrop.test.tsx`** (NEW, OPTIONAL)
   - Integration tests for full drag-drop flow with task state
   - Can be skipped if time-constrained — component tests provide sufficient coverage

### Files to Reference (No Changes)

- **`src/components/ui/input.tsx`** — Base Input component styling patterns (focus-visible ring)
- **`src/lib/content-enrichment.ts`** — Existing path detection regex patterns (for reference)
- **`src/components/markdown/EnhancedLink.tsx`** — Existing `isPathSafe()` usage pattern

---

## Implementation Steps

### Step 1: Path Formatting Utilities (Est. 30 min) ✅

**In `src/lib/file-utils.ts`:**

Add three new exported functions at the end of the file:

**Create `src/lib/__tests__/file-utils.test.ts`:**

Add comprehensive unit tests covering:
- `needsQuoting()`: simple path, path with spaces, path with quotes/parens, empty string
- `formatPathForChat()`: Unix absolute, Windows absolute, path with spaces, unsafe path (../ traversal), sensitive system path
- `insertAtCursor()`: insert at start (pos 0), insert at middle, insert at end, insert into empty string, multiple sequential insertions

**Verification:**
```bash
pnpm test file-utils.test.ts
```

---

### Step 2: DragDropInput Component (Est. 45 min) ✅

**Create `src/components/ui/drag-drop-input.tsx`:**

Uses Tauri's native `getCurrentWebview().onDragDropEvent()` API to listen for file drops. HTML5 DOM drag-drop events (`onDragOver`/`onDrop` with `e.dataTransfer.files`) do not work in Tauri 2.x because the native WebView intercepts file drops before they reach the web content (when `dragDropEnabled` is `true`, which is the default). The Tauri API provides file paths directly via `event.payload.paths`.

**Create `src/components/ui/__tests__/drag-drop-input.test.tsx`:**

Test cases:
- Renders with all props passed through to Input
- Shows ring styling when isDraggingOver is true
- Removes ring styling on dragLeave
- Calls onFilesDropped with formatted path on drop
- Handles multiple files (space-separated)
- Quotes paths with spaces
- Filters out unsafe paths (returns early, doesn't call callback)
- Tracks cursor position on change/click/keyup
- Handles empty drop (no files)

**Verification:**
```bash
pnpm test drag-drop-input.test.tsx
```

---

### Step 3: Integration into Execution Page (Est. 15 min) ✅

**In `src/pages/Execution.tsx` (around line 20):**

Add import:
```typescript
import { DragDropInput } from '@/components/ui/drag-drop-input';
```

**Replace `<Input>` component (lines 1075-1099) with:**

**Verification:**
```bash
pnpm typecheck
pnpm tauri dev
```

Manually test:
1. Open a task that allows follow-up
2. Drag a file from Finder onto the input
3. Verify path appears as `@/path/to/file`
4. Drag a file with spaces in name
5. Verify it appears as `@"path with spaces.txt"`
6. Drag multiple files
7. Verify they appear space-separated
8. Type some text, position cursor in the middle, drag a file
9. Verify file path is inserted at cursor position

---

### Step 3b: Integration into Home Page TaskInputBar (Est. 15 min) ✅

The Home page (`src/pages/Home.tsx`) uses `TaskInputBar` — a custom component with a `<textarea>`, not `<Input>`. Since it's a different element type, the Tauri drag-drop listener is added directly to TaskInputBar rather than using the `DragDropInput` wrapper.

**In `src/components/landing/TaskInputBar.tsx`:**

1. Import `getCurrentWebview` from `@tauri-apps/api/webview`, `formatPathForChat`, `insertAtCursor` from `@/lib/file-utils`, and `cn` from `@/lib/utils`
2. Add `isDraggingOver` and `cursorPosition` state
3. Add refs (`valueRef`, `cursorPositionRef`, `onChangeRef`) to access latest values inside the async Tauri event callback
4. Add a `useEffect` that subscribes to `getCurrentWebview().onDragDropEvent()` — handles `over` (visual feedback), `drop` (path formatting + insertion), and `cancel` (clear feedback) events
5. Apply `ring-2 ring-ring ring-offset-2` class to wrapper div when `isDraggingOver` is true
6. Add `handleTextareaChange` (tracks cursor + calls `onChange`), `handleSelectionChange` (click/keyup) for cursor position tracking
7. Wire `onClick` and `onKeyUp` on the `<textarea>` for cursor tracking
8. No DOM drag-drop handlers (`onDragOver`/`onDragLeave`/`onDrop`) on the wrapper `<div>` — Tauri handles this natively

**Verification:**
```bash
pnpm typecheck
pnpm test --run
```

Manually test:
1. Open the Home screen
2. Drag a file from Finder onto the task input
3. Verify path appears as `@/path/to/file`
4. Drag a file with spaces in name
5. Verify it appears as `@"path with spaces.txt"`
6. Drag multiple files
7. Verify they appear space-separated
8. Type some text, position cursor in the middle, drag a file
9. Verify file path is inserted at cursor position

---

### Step 4: Update Requirements Document (Est. 5 min) ✅

**In `docs/specs/requirements.md`:**
Marks the feature as complete in the requirements doc.

---

### Step 5: Final Verification (Est. 10 min) ✅

Run all checks:

```bash
# Type checking
pnpm typecheck

# Run all tests
pnpm test --run

# Linting/formatting check
pnpm dlx ultracite check src/

# Build verification
pnpm build
```

Expected results:
- ✅ No TypeScript errors
- ✅ All tests pass
- ✅ No linting errors
- ✅ Build succeeds

---

## Testing Strategy

### Unit Tests (15+ test cases)

**`file-utils.test.ts`:**
- `needsQuoting()` with various path types
- `formatPathForChat()` with Unix/Windows/unsafe paths
- `insertAtCursor()` at different positions

**`drag-drop-input.test.tsx`:**
- Component rendering and prop forwarding
- Visual feedback (ring appears/disappears)
- Drop handler with single/multiple files
- Path quoting and safety filtering
- Cursor position tracking
- Callback invocation

### Manual Testing Checklist

**Execution Page (follow-up input):**
- [ ] Drag single file from Finder → inserts `@/path/to/file`
- [ ] Drag file with spaces → inserts `@"path with spaces.txt"`
- [ ] Drag multiple files → inserts space-separated paths
- [ ] Drag to cursor position → inserts at correct position
- [ ] Visual feedback appears during drag-over
- [ ] Visual feedback disappears on drag-leave or drop
- [ ] Cursor position restored after drop
- [ ] Can still type normally after drop
- [ ] Can send message with dropped file path
- [ ] Unsafe paths (../, system paths) are filtered out

**Home Page (task input bar):**
- [ ] Drag single file from Finder → inserts `@/path/to/file`
- [ ] Drag file with spaces → inserts `@"path with spaces.txt"`
- [ ] Drag multiple files → inserts space-separated paths
- [ ] Drag to cursor position → inserts at correct position
- [ ] Visual feedback appears during drag-over (ring on wrapper div)
- [ ] Visual feedback disappears on drag-leave or drop
- [ ] Cursor position restored after drop
- [ ] Can still type normally after drop
- [ ] Can submit task with dropped file path

---

## Risk Mitigation

### Known Limitations

1. **Tauri `dragDropEnabled` default**: Tauri 2.x sets `dragDropEnabled: true` by default in the window config, which intercepts file drops at the native WebView level. HTML5 DOM `drop` events will not receive file data. This is why we use Tauri's `onDragDropEvent()` API instead. If `dragDropEnabled` is ever set to `false`, the Tauri API will stop firing and HTML5 DOM events would need to be used instead.

2. **Cursor position timing**: React's state update batching may cause cursor position to reset. The `setTimeout(..., 0)` workaround ensures cursor restoration happens after render.

3. **Folder support**: Tauri's `onDragDropEvent` provides paths for both files and folders. Folder paths are handled correctly by `formatPathForChat()` — no special handling needed.

---

## Success Criteria

✅ All acceptance criteria from requirement 3.5 are met:
1. Support drag-drop of files onto chat input (both Home and Execution pages)
2. Insert as `@path` at cursor position
3. Multiple files space-separated
4. Works from OS file managers (Finder, Explorer)
5. Paths with spaces are quoted
6. Visual feedback on drag hover

✅ Technical criteria:
- All tests pass (`pnpm test --run`)
- No TypeScript errors (`pnpm typecheck`)
- No linting errors (`pnpm dlx ultracite check src/`)
- Build succeeds (`pnpm build`)
- Requirements document updated with ✅
