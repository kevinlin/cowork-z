# Right Rail Implementation Plan

> **For agentic workers:** this plan runs through agent-handoff. The driver delegates Tasks 1–3 to `fast_worker`, one background job per task, in order, and reviews each diff against its task before submitting the next. Workers do not commit: skip each task's commit step, the driver commits after review. Task 4 stays with the driver. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the file tree, External Folders, Todos and file previews out of the left sidebar into one resizable, hideable right rail, with previews as closable tabs that widen the rail to half the main content width.

**Architecture:** `filePreviewStore` holds a list of tabs instead of one file, plus an `openSeq` counter. A new `RightRail` component sits beside `<main>` in App.tsx's flex row, holds its own width state (pure helpers in `rail-width.ts`), and stays mounted when hidden. App.tsx owns `railHidden` and a corner toggle, and un-hides the rail whenever `openSeq` changes.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, Tailwind 3.4, lucide-react, Vitest + Testing Library (jsdom).

**Spec:** [design_right-rail.md](design_right-rail.md) and [requirements.md §4.7](../requirements.md#47-right-rail).

## Global Constraints

- Rail width: default 300px, minimum 240px, maximum = main content width − 360px; where the maximum is below 240px, 240px applies.
- Keyboard resize step: 16px. Left arrow widens, Right arrow narrows (the handle is on the rail's left edge).
- Nothing is persisted: `railHidden`, rail width, tabs and section open state reset on reload.
- No new dependencies.
- DESIGN.md: DM Sans only; `primary` (Deep Forest) only for action and selection; reuse the `.sidebar-resize-handle` styles for the rail handle.
- React 19: pass `ref` as a prop; no `React.forwardRef`.
- Path alias `@/` → `src/`.
- Format with `pnpm ultracite:fix` before handing back; `pnpm typecheck` and `pnpm test --run` must pass.
- Do not commit, push, or touch `.env` files or secrets.

## Review Focus

1. **Re-opening the file that's already active while the rail is hidden or narrowed.** The user expects the rail to show and widen again. `openSeq` must still bump (Task 1 test) and the rail must widen on a re-open (Task 2 test).
2. **Workspace switch with previews open and the rail auto-widened.** The user expects the tabs to close and the rail to return to its earlier width. Task 2 test: `closePreview()` restores the width.
3. **Main content narrows while the rail is wide, from a window resize or a left-sidebar drag.** The user expects the rail to give way so the chat keeps 360px. A left-sidebar drag fires no window `resize`, so the rail watches the wrapper with a `ResizeObserver`. Task 2 test: the observer callback re-clamps.
4. **Switching from a preview tab back to Files.** The user expects the tree exactly as they left it. Task 2 test: the Files body stays mounted while a preview is active.
5. **Agent-supplied unsafe path (traversal or system path) in a chat link.** The user expects nothing to happen: no tab, no widen, no un-hide. Task 1 test: no tab and `openSeq` unchanged.

Known simplification: the tree highlights the active preview's row. While the Files tab is showing there is no active preview, so no row is highlighted in the rail. The Skills Manager window, which has no Files tab, keeps its highlight.

---

### Task 1: Preview store holds tabs

**Files:**
- Modify: `src/stores/filePreviewStore.ts` (whole file)
- Modify: `src/stores/__tests__/filePreviewStore.test.ts` (whole file)
- Modify: `src/components/sidebar/FileTreePanel.tsx:27,242`
- Modify: `src/components/skills-manager/SkillsSidebar.tsx:9,15`
- Modify: `src/pages/SkillsManager.tsx:11,24`
- Modify: `src/App.tsx:31,55-56` (interim; Task 3 replaces this)

**Interfaces:**
- Consumes: `isPathSafe(path: string): boolean` from `@/lib/file-utils`; `DirectoryEntry` from `@/shared/types/workspace`.
- Produces (used by Tasks 2 and 3):
  - `useFilePreviewStore` state: `tabs: DirectoryEntry[]`, `activePath: string | null` (null = Files tab), `openSeq: number`.
  - Actions: `openPreview(file: DirectoryEntry): void`, `openPreviewByPath(path: string): void`, `closeTab(path: string): void`, `setActive(path: string | null): void`, `closePreview(): void`.
  - Selector: `selectActiveFile(state): DirectoryEntry | null`.
  - Removed: `selectedFile`, `isPreviewOpen`.

- [ ] **Step 1: Write the failing tests.** Replace `src/stores/__tests__/filePreviewStore.test.ts` with:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { selectActiveFile, useFilePreviewStore } from '../filePreviewStore';

function entry(path: string): DirectoryEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, isDirectory: false, isSymlink: false };
}

const store = () => useFilePreviewStore.getState();
const tabPaths = () => store().tabs.map((t) => t.path);

function openAll(...paths: string[]) {
  for (const path of paths) {
    store().openPreview(entry(path));
  }
}

beforeEach(() => {
  useFilePreviewStore.setState({ tabs: [], activePath: null, openSeq: 0 });
});

describe('filePreviewStore.openPreviewByPath', () => {
  it('opens a tab for a safe absolute path', () => {
    store().openPreviewByPath('/Users/name/Pictures/photo.png');
    const active = selectActiveFile(store());
    expect(tabPaths()).toEqual(['/Users/name/Pictures/photo.png']);
    expect(active?.name).toBe('photo.png');
    expect(active?.extension).toBe('png');
    expect(store().openSeq).toBe(1);
  });

  it('rejects paths with traversal segments without touching state', () => {
    store().openPreviewByPath('/Users/name/../../etc/passwd');
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(0);
  });

  it('rejects sensitive system paths without touching state', () => {
    for (const path of ['/System/Library/CoreServices/boot.efi', '/Library/Keychains/login.keychain', '/Users/name/.Trash/file.txt']) {
      store().openPreviewByPath(path);
    }
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(0);
  });
});

describe('filePreviewStore tabs', () => {
  it('re-opening an open path activates its tab without duplicating it and still bumps openSeq', () => {
    openAll('/w/a.md', '/w/b.md', '/w/a.md');
    expect(tabPaths()).toEqual(['/w/a.md', '/w/b.md']);
    expect(store().activePath).toBe('/w/a.md');
    expect(store().openSeq).toBe(3);
  });

  it('closing the active tab activates the tab to its right', () => {
    openAll('/w/a.md', '/w/b.md', '/w/c.md');
    store().setActive('/w/b.md');
    store().closeTab('/w/b.md');
    expect(tabPaths()).toEqual(['/w/a.md', '/w/c.md']);
    expect(store().activePath).toBe('/w/c.md');
  });

  it('closing the active last tab activates the tab to its left', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closeTab('/w/b.md');
    expect(store().activePath).toBe('/w/a.md');
  });

  it('closing the only tab returns to the Files tab', () => {
    openAll('/w/a.md');
    store().closeTab('/w/a.md');
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(selectActiveFile(store())).toBeNull();
  });

  it('closing an inactive tab keeps the active one', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closeTab('/w/a.md');
    expect(tabPaths()).toEqual(['/w/b.md']);
    expect(store().activePath).toBe('/w/b.md');
  });

  it('closing an unknown path changes nothing', () => {
    openAll('/w/a.md');
    store().closeTab('/w/zzz.md');
    expect(tabPaths()).toEqual(['/w/a.md']);
    expect(store().activePath).toBe('/w/a.md');
  });

  it('setActive(null) shows the Files tab without closing previews', () => {
    openAll('/w/a.md');
    store().setActive(null);
    expect(tabPaths()).toEqual(['/w/a.md']);
    expect(selectActiveFile(store())).toBeNull();
  });

  it('closePreview clears every tab but keeps openSeq', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closePreview();
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `pnpm test --run src/stores/__tests__/filePreviewStore.test.ts`
Expected: FAIL (`selectActiveFile` is not exported; `tabs` is undefined).

- [ ] **Step 3: Implement the store.** Replace `src/stores/filePreviewStore.ts` with:

```ts
import { create } from 'zustand';

import { isPathSafe } from '@/lib/file-utils';
import type { DirectoryEntry } from '@/shared/types/workspace';

interface FilePreviewState {
  /** Open preview tabs, in tab-strip order */
  tabs: DirectoryEntry[];
  /** Path of the active preview tab; null means the right rail's Files tab */
  activePath: string | null;
  /** Bumped on every successful open, including re-opening the active file.
   * App un-hides the rail and RightRail widens it when this changes. */
  openSeq: number;
  /** Open a file as a tab (or activate its existing tab) */
  openPreview: (file: DirectoryEntry) => void;
  /**
   * Open preview from a file path string (e.g. from MediaGallery).
   * Constructs a minimal DirectoryEntry from the path.
   */
  openPreviewByPath: (path: string) => void;
  /** Close one tab; if it was active, activate the tab to its right, else left, else Files */
  closeTab: (path: string) => void;
  /** Switch tabs; null shows the Files tab */
  setActive: (path: string | null) => void;
  /** Close every preview tab */
  closePreview: () => void;
}

/** The active tab's entry, or null while the Files tab is showing */
export const selectActiveFile = (state: Pick<FilePreviewState, 'tabs' | 'activePath'>): DirectoryEntry | null =>
  state.activePath === null ? null : (state.tabs.find((t) => t.path === state.activePath) ?? null);

export const useFilePreviewStore = create<FilePreviewState>((set, get) => ({
  tabs: [],
  activePath: null,
  openSeq: 0,

  openPreview: (file) =>
    set((state) => ({
      tabs: state.tabs.some((t) => t.path === file.path) ? state.tabs : [...state.tabs, file],
      activePath: file.path,
      openSeq: state.openSeq + 1,
    })),

  openPreviewByPath: (path) => {
    // Agent-supplied paths (markdown links, media thumbnails, tool cards)
    // must pass the same gate as chat links — no traversal segments or
    // sensitive system paths (2026-06-12 review #10).
    if (!isPathSafe(path)) return;

    const segments = path.replace(/\\/g, '/').split('/');
    const name = segments[segments.length - 1] || path;
    const lastDot = name.lastIndexOf('.');
    const extension = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : undefined;

    get().openPreview({ name, path, isDirectory: false, isSymlink: false, extension });
  },

  closeTab: (path) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.path === path);
      if (index === -1) return {};
      const tabs = state.tabs.filter((t) => t.path !== path);
      if (state.activePath !== path) return { tabs };
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activePath: next?.path ?? null };
    }),

  setActive: (path) => set({ activePath: path }),

  closePreview: () => set({ tabs: [], activePath: null }),
}));
```

- [ ] **Step 4: Run the store tests to verify they pass.**

Run: `pnpm test --run src/stores/__tests__/filePreviewStore.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Move the store's readers to the new shape.**

`src/components/sidebar/FileTreePanel.tsx` — change the import on line 27 and the destructure on line 242:

```tsx
import { selectActiveFile, useFilePreviewStore } from '@/stores/filePreviewStore';
```

```tsx
  const openPreview = useFilePreviewStore((s) => s.openPreview);
  const selectedFile = useFilePreviewStore(selectActiveFile);
```

`src/components/skills-manager/SkillsSidebar.tsx` — the same two edits (import on line 9, destructure on line 15):

```tsx
import { selectActiveFile, useFilePreviewStore } from '@/stores/filePreviewStore';
```

```tsx
  const openPreview = useFilePreviewStore((s) => s.openPreview);
  const selectedFile = useFilePreviewStore(selectActiveFile);
```

`src/pages/SkillsManager.tsx` — import on line 11, and replace line 24 (`const { selectedFile, isPreviewOpen, closePreview } = useFilePreviewStore();`) with:

```tsx
import { selectActiveFile, useFilePreviewStore } from '@/stores/filePreviewStore';
```

```tsx
  const selectedFile = useFilePreviewStore(selectActiveFile);
  const closePreview = useFilePreviewStore((s) => s.closePreview);
  const isPreviewOpen = selectedFile !== null;
```

`src/App.tsx` — interim, so the old preview panel keeps compiling until Task 3. Import on line 31, and replace lines 55-56:

```tsx
import { selectActiveFile, useFilePreviewStore } from './stores/filePreviewStore';
```

```tsx
  // File preview state (interim: Task 3 moves previews into the right rail)
  const selectedFile = useFilePreviewStore(selectActiveFile);
  const closePreview = useFilePreviewStore((s) => s.closePreview);
  const isPreviewOpen = selectedFile !== null;
```

- [ ] **Step 6: Run the gates.**

Run: `pnpm typecheck && pnpm test --run`
Expected: typecheck clean; all tests pass. (`EnhancedLink.test.tsx` and `MediaGallery.test.tsx` mock `openPreviewByPath`, whose name and signature are unchanged.)

- [ ] **Step 7: Commit (driver, after review).**

```bash
git add src/stores/filePreviewStore.ts src/stores/__tests__/filePreviewStore.test.ts src/components/sidebar/FileTreePanel.tsx src/components/skills-manager/SkillsSidebar.tsx src/pages/SkillsManager.tsx src/App.tsx
git commit -m "feat(preview): hold previews as tabs in filePreviewStore"
```

---

### Task 2: RightRail component

**Files:**
- Create: `src/components/layout/rail-width.ts`
- Create: `src/components/layout/__tests__/rail-width.test.ts`
- Create: `src/components/layout/RightRail.tsx`
- Create: `src/components/layout/__tests__/RightRail.test.tsx`
- Create: `src/components/file-preview/__tests__/FilePreviewPanel.test.tsx`
- Modify: `src/components/file-preview/FilePreviewPanel.tsx:32-36,172-178,217-224`
- Modify: `src/pages/SkillsManager.tsx` (the preview wrapper `<div className="shrink-0" style={{ width: previewWidth }}>`)
- Modify: `src/styles/globals.css` (after the `.sidebar-resize-handle` block, ~line 189)

**Interfaces:**
- Consumes (Task 1): `useFilePreviewStore` fields `tabs`, `activePath`, `openSeq`, actions `setActive`, `closeTab`; `selectActiveFile`.
- Consumes (existing): `FileTreePanel` (default export, `@/components/sidebar/FileTreePanel`), `FoldersPanel` (default export), `CollapsibleSection` (default export, props `title`, `open`, `onOpenChange`), `TodoPanel` (named export, prop `todos: Todo[]`), `FilePreviewPanel` (named export from `@/components/file-preview`), `formatPathForChat(path: string): string | null` from `@/lib/file-utils`, `useTaskStore` from `@/stores/taskStore`.
- Produces (used by Task 3):
  - `export default function RightRail(props: { hidden: boolean; contentRef: RefObject<HTMLDivElement | null> })`. It renders `<aside id="right-rail">`.
  - `rail-width.ts`: `RAIL_DEFAULT_WIDTH = 300`, `RAIL_MIN_WIDTH = 240`, `CHAT_MIN_WIDTH = 360`, `RAIL_KEYBOARD_STEP = 16`, `railMaxWidth(contentWidth)`, `clampRailWidth(width, contentWidth)`, `widthOnOpen(width, contentWidth)`.
  - `FilePreviewPanel` prop `onClose` becomes optional; with no `onClose` the header shows no X.

- [ ] **Step 1: Write the failing width tests.** Create `src/components/layout/__tests__/rail-width.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHAT_MIN_WIDTH, clampRailWidth, RAIL_MIN_WIDTH, railMaxWidth, widthOnOpen } from '../rail-width';

describe('railMaxWidth', () => {
  it('leaves the chat its minimum width', () => {
    expect(railMaxWidth(1000)).toBe(1000 - CHAT_MIN_WIDTH);
  });

  it('never drops below the rail minimum', () => {
    expect(railMaxWidth(500)).toBe(RAIL_MIN_WIDTH);
  });
});

describe('clampRailWidth', () => {
  it('keeps a width inside the bounds', () => {
    expect(clampRailWidth(400, 1000)).toBe(400);
  });

  it('raises a width below the minimum', () => {
    expect(clampRailWidth(100, 1000)).toBe(240);
  });

  it('lowers a width above the maximum', () => {
    expect(clampRailWidth(900, 1000)).toBe(640);
  });

  it('lets the minimum win when the window is too small', () => {
    expect(clampRailWidth(300, 540)).toBe(240);
  });

  it('treats an unmeasured container as the minimum', () => {
    expect(clampRailWidth(300, 0)).toBe(240);
  });
});

describe('widthOnOpen', () => {
  it('widens a narrower rail to half the main content', () => {
    expect(widthOnOpen(300, 1000)).toBe(500);
  });

  it('leaves a rail already at half unchanged', () => {
    expect(widthOnOpen(500, 1000)).toBe(500);
  });

  it('leaves a wider rail unchanged', () => {
    expect(widthOnOpen(600, 1000)).toBe(600);
  });

  it('rounds an odd half down', () => {
    expect(widthOnOpen(300, 1001)).toBe(500);
  });

  it('caps the target so the chat keeps its minimum', () => {
    expect(widthOnOpen(240, 600)).toBe(240);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `pnpm test --run src/components/layout/__tests__/rail-width.test.ts`
Expected: FAIL (cannot resolve `../rail-width`).

- [ ] **Step 3: Implement the width helpers.** Create `src/components/layout/rail-width.ts`:

```ts
/** Right-rail width rules (requirements 4.7.3, 4.7.5). Pure, so they test without layout. */

export const RAIL_DEFAULT_WIDTH = 300;
export const RAIL_MIN_WIDTH = 240;
/** The chat column keeps at least this much of the main content width. */
export const CHAT_MIN_WIDTH = 360;
export const RAIL_KEYBOARD_STEP = 16;

/** Widest the rail may get while leaving the chat its minimum; never below the rail minimum. */
export function railMaxWidth(contentWidth: number): number {
  return Math.max(RAIL_MIN_WIDTH, contentWidth - CHAT_MIN_WIDTH);
}

/** Clamp to [RAIL_MIN_WIDTH, railMaxWidth]. In a window too small for both, the minimum wins. */
export function clampRailWidth(width: number, contentWidth: number): number {
  return Math.min(Math.max(width, RAIL_MIN_WIDTH), railMaxWidth(contentWidth));
}

/** Width after a preview opens: half the main content if the rail is narrower, otherwise unchanged. */
export function widthOnOpen(width: number, contentWidth: number): number {
  const target = Math.floor(contentWidth / 2);
  return width < target ? clampRailWidth(target, contentWidth) : width;
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `pnpm test --run src/components/layout/__tests__/rail-width.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing FilePreviewPanel test.** Create `src/components/file-preview/__tests__/FilePreviewPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePreviewPanel } from '../FilePreviewPanel';

vi.mock('@/lib/tauri-api', () => ({
  readFileContent: vi.fn(() => Promise.resolve('')),
  openFilePath: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => path),
}));

// A binary file skips content loading, so the header renders synchronously.
const file = { name: 'blob.bin', path: '/Users/me/ws/blob.bin', isDirectory: false, isSymlink: false, extension: 'bin' };

describe('FilePreviewPanel close button', () => {
  it('has no header close button when onClose is omitted (the rail tab owns closing)', () => {
    render(<FilePreviewPanel file={file} />);
    expect(screen.queryByTitle('Close preview')).toBeNull();
  });

  it('shows the close button when onClose is given (Skills Manager)', () => {
    const onClose = vi.fn();
    render(<FilePreviewPanel file={file} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Close preview'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: Run to verify it fails.**

Run: `pnpm test --run src/components/file-preview/__tests__/FilePreviewPanel.test.tsx`
Expected: the first test FAILS (the X renders unconditionally); typecheck would also reject the missing `onClose`.

- [ ] **Step 7: Make `onClose` optional and move the docked border to the Skills Manager wrapper.**

In `src/components/file-preview/FilePreviewPanel.tsx`, the props interface:

```tsx
interface FilePreviewPanelProps {
  file: DirectoryEntry;
  /** Omit inside the right rail, where the tab's X closes the preview */
  onClose?: () => void;
  onAddToChat?: (file: DirectoryEntry) => void;
}
```

The panel root (drop the docked `border-l`, because the rail already draws its own left border):

```tsx
  const panel = (
    <div className={cn(expanded ? 'fixed inset-0 z-50 bg-background/95 shadow-2xl backdrop-blur-xl' : 'h-full')}>
```

The close button, rendered only when `onClose` is given:

```tsx
            {onClose && (
              <button
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={onClose}
                title="Close preview"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
```

In `src/pages/SkillsManager.tsx`, the preview wrapper takes over the border:

```tsx
            <div className="shrink-0 border-border border-l" style={{ width: previewWidth }}>
```

- [ ] **Step 8: Run to verify it passes.**

Run: `pnpm test --run src/components/file-preview/__tests__/FilePreviewPanel.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 9: Write the failing RightRail tests.** Create `src/components/layout/__tests__/RightRail.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '@/shared';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import RightRail from '../RightRail';

vi.mock('@/components/sidebar/FileTreePanel', () => ({ default: () => <div data-testid="file-tree" /> }));
vi.mock('@/components/sidebar/FoldersPanel', () => ({ default: () => <div data-testid="folders-panel" /> }));
vi.mock('@/components/file-preview', () => ({
  FilePreviewPanel: ({ file }: { file: { path: string } }) => <div data-testid="preview">{file.path}</div>,
}));
// The active task's todos, mutable per test; rerender to deliver a change.
const mockTask = vi.hoisted(() => ({ todos: [] as Todo[] }));
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (state: { todos: Map<string, Todo[]>; currentTask: { id: string } }) => unknown) =>
    selector({ todos: new Map([['task-1', mockTask.todos]]), currentTask: { id: 'task-1' } }),
}));

// jsdom has no layout: the main content wrapper is a stub with a settable width,
// and the ResizeObserver hands its callback to the test to fire.
const content = { clientWidth: 1000 };
const contentRef = { current: content } as unknown as RefObject<HTMLDivElement | null>;
let fireContentResize: () => void = () => {};
class CapturingResizeObserver {
  constructor(callback: () => void) {
    fireContentResize = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', CapturingResizeObserver);

const todo = (id: string): Todo => ({ id, content: `todo ${id}`, status: 'pending', priority: 'medium' });

const rail = () => document.getElementById('right-rail') as HTMLElement;
const handle = () => screen.getByRole('separator', { name: 'Resize side panel' });
const open = (path: string) =>
  act(() => {
    useFilePreviewStore.getState().openPreviewByPath(path);
  });
const renderRail = (hidden = false) => render(<RightRail contentRef={contentRef} hidden={hidden} />);

beforeEach(() => {
  useFilePreviewStore.setState({ tabs: [], activePath: null, openSeq: 0 });
  content.clientWidth = 1000;
  mockTask.todos = [];
});

describe('RightRail', () => {
  it('starts at 300px on the Files tab, which has no close button', () => {
    renderRail();
    expect(rail().style.width).toBe('300px');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Close Files' })).toBeNull();
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByTestId('folders-panel')).toBeInTheDocument();
  });

  it('opens Todos when the task gets its first todos, and leaves a manual collapse alone', () => {
    const { rerender } = renderRail();
    const todosHeader = () => screen.getByRole('button', { name: /Todos/ });
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');

    mockTask.todos = [todo('1')];
    rerender(<RightRail contentRef={contentRef} hidden={false} />);
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(todosHeader());
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');

    mockTask.todos = [todo('1'), todo('2')];
    rerender(<RightRail contentRef={contentRef} hidden={false} />);
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a preview as the active tab and keeps the Files body mounted but hidden', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    expect(screen.getByRole('tab', { name: 'notes.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('preview')).toHaveTextContent('/Users/me/ws/notes.md');
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Files', hidden: true })).toHaveClass('hidden');
  });

  it('closes a preview tab from its X and returns to Files', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.md' }));
    expect(screen.queryByRole('tab', { name: 'notes.md' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus to the newly active tab after closing one', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    open('/Users/me/ws/b.md');
    fireEvent.click(screen.getByRole('button', { name: 'Close b.md' }));
    expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveFocus();
  });

  it('switches back to Files from the Files tab without closing the preview', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('tab', { name: 'notes.md' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Files' })).not.toHaveClass('hidden');
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('hides with the hidden class instead of unmounting', () => {
    renderRail(true);
    expect(rail()).toHaveClass('hidden');
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
  });

  it('widens to half the main content on open and restores when the last tab closes', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    expect(rail().style.width).toBe('500px');
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(rail().style.width).toBe('300px');
  });

  it('restores the width when a workspace switch clears the tabs', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    open('/Users/me/ws/b.md');
    expect(rail().style.width).toBe('500px');
    act(() => {
      useFilePreviewStore.getState().closePreview();
    });
    expect(rail().style.width).toBe('300px');
  });

  it('keeps a dragged width when the last tab closes', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    fireEvent.mouseDown(handle(), { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 480 });
    fireEvent.mouseUp(document);
    expect(rail().style.width).toBe('520px');
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(rail().style.width).toBe('520px');
  });

  it('resizes from the keyboard in 16px steps', () => {
    renderRail();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(rail().style.width).toBe('316px');
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(rail().style.width).toBe('300px');
  });

  it('widens again when the active file is re-opened after the rail was narrowed', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    }
    expect(rail().style.width).toBe('436px');
    open('/Users/me/ws/a.md');
    expect(rail().style.width).toBe('500px');
  });

  it('re-clamps when the main content narrows (window resize or left-sidebar drag)', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    content.clientWidth = 700;
    act(() => {
      fireContentResize();
    });
    expect(rail().style.width).toBe('340px');
  });
});
```

- [ ] **Step 10: Run to verify it fails.**

Run: `pnpm test --run src/components/layout/__tests__/RightRail.test.tsx`
Expected: FAIL (cannot resolve `../RightRail`).

- [ ] **Step 11: Add the left-edge handle variant.** In `src/styles/globals.css`, directly after the `.sidebar-resize-handle:active::after` rule:

```css
/* Right rail: the same handle, on the rail's left edge */
.rail-resize-handle,
.rail-resize-handle::after {
  left: 0;
  right: auto;
}
```

- [ ] **Step 12: Implement RightRail.** Create `src/components/layout/RightRail.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { FilePreviewPanel } from '@/components/file-preview';
import CollapsibleSection from '@/components/sidebar/CollapsibleSection';
import FileTreePanel from '@/components/sidebar/FileTreePanel';
import FoldersPanel from '@/components/sidebar/FoldersPanel';
import { TodoPanel } from '@/components/sidebar/TodoPanel';
import { formatPathForChat } from '@/lib/file-utils';
import { cn } from '@/lib/utils';
import type { Todo } from '@/shared';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { selectActiveFile, useFilePreviewStore } from '@/stores/filePreviewStore';
import { useTaskStore } from '@/stores/taskStore';
import { clampRailWidth, RAIL_DEFAULT_WIDTH, RAIL_KEYBOARD_STEP, RAIL_MIN_WIDTH, railMaxWidth, widthOnOpen } from './rail-width';

// Stable empty array to avoid creating new references in selectors
const EMPTY_TODOS: Todo[] = [];

const TAB_CLASS = 'flex shrink-0 items-center gap-1 font-medium text-xs transition-colors';
const tabStateClass = (active: boolean) =>
  active ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground';

interface RightRailProps {
  /** Hidden with display:none, never unmounted, so tree, section and tab state survive (4.7.1 AC#6) */
  hidden: boolean;
  /** The main content wrapper (chat + rail). Its width drives clamping and widen-on-open. */
  contentRef: RefObject<HTMLDivElement | null>;
}

export default function RightRail({ hidden, contentRef }: RightRailProps) {
  const tabs = useFilePreviewStore((s) => s.tabs);
  const activePath = useFilePreviewStore((s) => s.activePath);
  const openSeq = useFilePreviewStore((s) => s.openSeq);
  const activeFile = useFilePreviewStore(selectActiveFile);
  const setActive = useFilePreviewStore((s) => s.setActive);
  const closeTab = useFilePreviewStore((s) => s.closeTab);

  // Todos section: same open logic it had in the left sidebar — starts open only
  // if todos already exist, and auto-expands when todos arrive (3.3 AC#5).
  const todos = useTaskStore((s) => s.todos.get(s.currentTask?.id ?? '') ?? EMPTY_TODOS);
  const hasTodos = todos.length > 0;
  const [todosOpen, setTodosOpen] = useState(hasTodos);
  useEffect(() => {
    if (hasTodos) {
      setTodosOpen(true);
    }
  }, [hasTodos]);

  // ── Width ─────────────────────────────────────────────────────────
  const contentWidth = useCallback(() => contentRef.current?.clientWidth ?? 0, [contentRef]);
  const [width, setWidth] = useState(RAIL_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  // Width before a preview auto-widened the rail. A manual resize clears it,
  // so closing the last tab only snaps back if the user never took over.
  const widthBeforeWiden = useRef<number | null>(null);

  // Clamp once mounted (the ref is attached by then) and whenever the main content
  // changes width. A ResizeObserver on the wrapper catches a window resize and a
  // left-sidebar drag alike, and keeps working while the rail is hidden (4.7.3 AC#4).
  useEffect(() => {
    const onResize = () => setWidth((w) => clampRailWidth(w, contentWidth()));
    onResize();
    const wrapper = contentRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(onResize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [contentRef, contentWidth]);

  // Every open (openSeq bump) widens to half the main content (4.7.5).
  const seenOpenSeq = useRef(openSeq);
  useEffect(() => {
    if (openSeq === seenOpenSeq.current) return;
    seenOpenSeq.current = openSeq;
    const next = widthOnOpen(width, contentWidth());
    if (next !== width) {
      if (widthBeforeWiden.current === null) {
        widthBeforeWiden.current = width;
      }
      setWidth(next);
    }
  }, [openSeq, width, contentWidth]);

  // No tabs left (last one closed, or a workspace switch): restore the pre-widen width.
  const tabCount = tabs.length;
  useEffect(() => {
    if (tabCount > 0 || widthBeforeWiden.current === null) return;
    setWidth(clampRailWidth(widthBeforeWiden.current, contentWidth()));
    widthBeforeWiden.current = null;
  }, [tabCount, contentWidth]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        widthBeforeWiden.current = null;
        // The handle is on the left edge: dragging left widens the rail.
        setWidth(clampRailWidth(startWidth + (startX - ev.clientX), contentWidth()));
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, contentWidth]
  );

  const handleResizeKey = (e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = RAIL_KEYBOARD_STEP;
    if (e.key === 'ArrowRight') delta = -RAIL_KEYBOARD_STEP;
    if (delta === 0) return;
    e.preventDefault();
    widthBeforeWiden.current = null;
    setWidth((w) => clampRailWidth(w + delta, contentWidth()));
  };

  // ── Tabs ──────────────────────────────────────────────────────────
  const activeTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activePath !== null) {
      activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activePath]);

  // Closing a tab removes the focused X from the DOM; hand focus to the newly
  // active tab once the store update has rendered (4.7.4 AC#8).
  const tablistRef = useRef<HTMLDivElement>(null);
  const refocusActiveTab = useRef(false);
  useEffect(() => {
    if (!refocusActiveTab.current) return;
    refocusActiveTab.current = false;
    tablistRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [activePath, tabs]);

  const handleCloseTab = (path: string) => {
    refocusActiveTab.current = true;
    closeTab(path);
  };

  const handleAddToChat = useCallback((file: DirectoryEntry) => {
    const formatted = formatPathForChat(file.path);
    if (formatted) {
      window.dispatchEvent(new CustomEvent('add-to-chat', { detail: { text: formatted } }));
    }
  }, []);

  const filesActive = activePath === null;

  return (
    <aside
      aria-label="Side panel"
      className={cn('relative h-full shrink-0 flex-col border-border border-l bg-card', hidden ? 'hidden' : 'flex')}
      id="right-rail"
      style={{ width }}
    >
      <div
        aria-label="Resize side panel"
        aria-orientation="vertical"
        aria-valuemax={railMaxWidth(contentWidth())}
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuenow={width}
        className={cn('sidebar-resize-handle rail-resize-handle', isResizing && 'active')}
        onKeyDown={handleResizeKey}
        onMouseDown={handleResizeStart}
        role="separator"
        tabIndex={0}
      />

      {/* Tab strip: pinned Files tab, then one closable tab per preview */}
      <div aria-label="Side panel tabs" className="flex shrink-0 overflow-x-auto border-border border-b" ref={tablistRef} role="tablist">
        <button
          aria-controls="right-rail-files"
          aria-selected={filesActive}
          className={cn(TAB_CLASS, 'px-3 py-2', tabStateClass(filesActive))}
          onClick={() => setActive(null)}
          role="tab"
          type="button"
        >
          Files
        </button>
        {tabs.map((tab) => {
          const isActive = tab.path === activePath;
          return (
            <div className={cn(TAB_CLASS, 'border-border border-l', tabStateClass(isActive))} key={tab.path} ref={isActive ? activeTabRef : undefined}>
              <button
                aria-controls="right-rail-preview"
                aria-selected={isActive}
                className="max-w-40 truncate py-2 pl-3"
                onClick={() => setActive(tab.path)}
                role="tab"
                title={tab.path}
                type="button"
              >
                {tab.name}
              </button>
              <button
                aria-label={`Close ${tab.name}`}
                className="mr-2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => handleCloseTab(tab.path)}
                title={`Close ${tab.name}`}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Files body stays mounted while a preview is active (4.7.2 AC#5) */}
      <div aria-label="Files" className={cn('min-h-0 flex-1 flex-col', filesActive ? 'flex' : 'hidden')} id="right-rail-files" role="tabpanel">
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileTreePanel />
        </div>
        {/* Pinned sections, capped so the tree always keeps visible space (4.7.2 AC#4) */}
        <div className="max-h-[50%] shrink-0 overflow-y-auto border-border border-t">
          <FoldersPanel />
          <CollapsibleSection onOpenChange={setTodosOpen} open={todosOpen} title="Todos">
            {hasTodos ? (
              <TodoPanel todos={todos} />
            ) : (
              <div className="px-2 py-3 text-center text-muted-foreground text-xs">No active todos</div>
            )}
          </CollapsibleSection>
        </div>
      </div>

      {/* Only the active preview is mounted; switching tabs re-reads the file */}
      {activeFile && (
        <div aria-label={activeFile.name} className="min-h-0 flex-1" id="right-rail-preview" role="tabpanel">
          <FilePreviewPanel file={activeFile} key={activeFile.path} onAddToChat={handleAddToChat} />
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 13: Run the RightRail tests to verify they pass.**

Run: `pnpm test --run src/components/layout/__tests__/RightRail.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 14: Run the gates.**

Run: `pnpm ultracite:fix && pnpm typecheck && pnpm test --run`
Expected: clean format; typecheck clean; all tests pass. `RightRail` is not mounted anywhere yet; that is Task 3.

- [ ] **Step 15: Commit (driver, after review).**

```bash
git add src/components/layout/rail-width.ts src/components/layout/RightRail.tsx src/components/layout/__tests__/rail-width.test.ts src/components/layout/__tests__/RightRail.test.tsx src/components/file-preview/FilePreviewPanel.tsx src/components/file-preview/__tests__/FilePreviewPanel.test.tsx src/pages/SkillsManager.tsx src/styles/globals.css
git commit -m "feat(layout): add RightRail with preview tabs and width rules"
```

---

### Task 3: Mount the rail and slim the left sidebar

**Files:**
- Modify: `src/App.tsx` (imports; lines 55-100 state and resize code; lines 211-288 layout)
- Modify: `src/components/layout/Sidebar.tsx` (imports; lines 25-51; workspace subscriber at 136-150; lines 230-264)
- Modify: `src/pages/Home.tsx:114`
- Modify: `src/pages/Execution.tsx:465`
- Modify: `src/components/arena/ArenaInputBar.tsx:219`

**Interfaces:**
- Consumes (Task 1): `useFilePreviewStore` field `openSeq`, action `closePreview`.
- Consumes (Task 2): `RightRail` default export, props `{ hidden: boolean; contentRef: RefObject<HTMLDivElement | null> }`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: App.tsx — replace the preview state and resize code with rail state.**

Imports: remove `import { FilePreviewPanel } from './components/file-preview';`, `formatPathForChat` from `./lib/file-utils` (drop the whole import line if nothing else remains on it), and `selectActiveFile` from the store import. Add:

```tsx
import { AlertTriangle, Loader2, PanelRight } from 'lucide-react';
import RightRail from './components/layout/RightRail';
import { useFilePreviewStore } from './stores/filePreviewStore';
```

Delete everything from the `// File preview state` comment through the end of `handleResizeStart` (the Task 1 interim lines, `handleAddFileToChat`, and the whole `// ── Resizable preview panel ──` block). Put this in its place:

```tsx
  // Right rail visibility (4.7.1). Not persisted. Any preview open un-hides it,
  // so a file link clicked in chat always lands somewhere visible.
  const [railHidden, setRailHidden] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const openSeq = useFilePreviewStore((s) => s.openSeq);
  useEffect(() => {
    if (openSeq > 0) {
      setRailHidden(false);
    }
  }, [openSeq]);
```

These hooks sit with the other hooks, above the `loading` and `error` early returns.

- [ ] **Step 2: App.tsx — new layout.** Replace the `<main>` element and the `{isPreviewOpen && selectedFile && (...)}` block (everything between `<Sidebar />` and `<TaskLauncher />`) with:

```tsx
      <div className="flex min-w-0 flex-1 overflow-hidden" ref={contentRef}>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {/* ...the existing <Routes> block, unchanged... */}
          </AnimatePresence>
          <button
            aria-controls="right-rail"
            aria-expanded={!railHidden}
            aria-label={railHidden ? 'Show side panel' : 'Hide side panel'}
            className="no-drag absolute top-3 right-3 z-20 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setRailHidden((h) => !h)}
            title={railHidden ? 'Show side panel' : 'Hide side panel'}
            type="button"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </main>
        <RightRail contentRef={contentRef} hidden={railHidden} />
      </div>
```

Keep the existing `<Routes key={location.pathname} location={location}>` block inside `AnimatePresence` exactly as it is.

- [ ] **Step 3: Sidebar.tsx — remove the Files tab and the pinned panels; clear tabs on workspace switch.**

Imports: drop `FolderTree` from the lucide import, and delete the `FileTreePanel`, `FoldersPanel`, `TodoPanel`, `CollapsibleSection` and `import type { Todo } from '@/shared';` imports. Add:

```tsx
import { useFilePreviewStore } from '@/stores/filePreviewStore';
```

Delete the `EMPTY_TODOS` constant and its comment, the `currentTaskTodos` / `hasTodos` lines, and the `todosOpen` state with its effect (they live in `RightRail` now). Change the tab type:

```tsx
type SidebarTab = 'sessions' | 'automations';
```

In the workspace-change subscriber, close the previews with the rest of the reset:

```tsx
      if (currentId && currentId !== prevId) {
        useTaskStore.getState().reset();
        useArenaStore.getState().reset();
        // Preview tabs point at files in the old workspace (4.7.4 AC#5)
        useFilePreviewStore.getState().closePreview();
        navigate('/');
```

In the JSX, delete the third tab button (the one with `<FolderTree ...>` and the label `Files`), the `{activeTab === 'files' && (...)}` block, and the whole `{/* Pinned Panels ... */}` `<div className="shrink-0 border-border border-t">` block holding `FoldersPanel` and the Todos section.

- [ ] **Step 4: Make room for the corner toggle on each page.**

`src/pages/Home.tsx:114`:

```tsx
          className="absolute top-6 right-14 z-10"
```

`src/pages/Execution.tsx:465`:

```tsx
        <div className="flex-shrink-0 border-border border-b bg-card/50 py-4 pr-14 pl-6">
```

`src/components/arena/ArenaInputBar.tsx:219`:

```tsx
    <div className="flex-shrink-0 border-border border-b bg-card/50 py-3 pr-14 pl-4">
```

- [ ] **Step 5: Run the gates.**

Run: `pnpm ultracite:fix && pnpm typecheck && pnpm test --run`
Expected: clean format; typecheck clean (no unused imports or variables left in App.tsx or Sidebar.tsx); all tests pass.

Run: `grep -n -E "isPreviewOpen|selectedFile|handleResizeStart|PREVIEW_(MIN|MAX|DEFAULT)_WIDTH" src/App.tsx; grep -n -E "'files'|FoldersPanel|TodoPanel|FileTreePanel" src/components/layout/Sidebar.tsx`
Expected: no output.

- [ ] **Step 6: Commit (driver, after review).**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx src/pages/Home.tsx src/pages/Execution.tsx src/components/arena/ArenaInputBar.tsx
git commit -m "feat(layout): mount the right rail and move files, folders and todos into it"
```

---

### Task 4: Acceptance (driver)

**Files:**
- Modify: `docs/specs/requirements.md` (§4.7 heading gets ✅ once the manual checks pass)

- [ ] **Step 1: Full gates on the integrated branch.**

Run: `pnpm ultracite:fix && pnpm typecheck && pnpm test --run`
Expected: all green.

- [ ] **Step 2: Manual check in `pnpm tauri dev`** (done by the user; jsdom can't show layout).
  - The corner toggle hides and shows the rail on Home, Execution and Arena, and never covers the Arena button, the Execution status badge or the Arena model pickers. On Arena, the model tabs and input controls still work with the rail at half width.
  - Widening the left sidebar with a preview open makes the rail give way so the chat keeps 360px.
  - Hiding the rail while a preview is in fullscreen leaves the overlay up until Escape or the minimize button docks it.
  - At launch the rail is 300px on the Files tab, External Folders and Todos are collapsed (External Folders open if permissions were already loaded), and the tree fills the height.
  - A tree click, a chat file link, a media thumbnail and a tool-card "open" each open a tab, widen the rail to half the main content, and un-hide a hidden rail. Re-clicking the active file's link while the rail is hidden shows it again.
  - Dragging the handle (and Left/Right on the focused handle) resizes; after a drag, closing the last tab keeps the dragged width; without a drag it restores.
  - Expanded folders and the search text survive a Files ↔ preview switch and a hide/show.
  - Switching workspace closes all tabs; switching tasks in the same workspace keeps them.
  - The Skills Manager window still previews with its own X and Escape.

- [ ] **Step 3: Mark the requirement done and commit (driver).**

Add ✅ to the `#### 4.7 Right Rail` heading in `docs/specs/requirements.md`.

```bash
git add docs/specs/requirements.md
git commit -m "specs: Mark 4.7 Right Rail done"
```
