# Right Rail Implementation Plan

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

## Review Focus

1. **Re-opening the file that's already active while the rail is hidden or narrowed.** The user expects the rail to show and widen again. `openSeq` must still bump (Task 1 test) and the rail must widen on a re-open (Task 2 test).
2. **Workspace switch with previews open and the rail auto-widened.** The user expects the tabs to close and the rail to return to its earlier width. Task 2 test: `closePreview()` restores the width.
3. **Main content narrows while the rail is wide, from a window resize or a left-sidebar drag.** The user expects the rail to give way so the chat keeps 360px. A left-sidebar drag fires no window `resize`, so the rail watches the wrapper with a `ResizeObserver`. Task 2 test: the observer callback re-clamps.
4. **Switching from a preview tab back to Files.** The user expects the tree exactly as they left it. Task 2 test: the Files body stays mounted while a preview is active.
5. **Agent-supplied unsafe path (traversal or system path) in a chat link.** The user expects nothing to happen: no tab, no widen, no un-hide. Task 1 test: no tab and `openSeq` unchanged.

Known simplification: the tree highlights the active preview's row. While the Files tab is showing there is no active preview, so no row is highlighted in the rail. The Skills Manager window, which has no Files tab, keeps its highlight.

---

### Task 1: Preview store holds tabs

Replaced the single `selectedFile` in `filePreviewStore` with `tabs: DirectoryEntry[]`, `activePath: string | null` (null = the Files tab) and `openSeq: number`, plus `openPreview`, `openPreviewByPath`, `closeTab`, `setActive`, `closePreview` and an exported `selectActiveFile` selector (`selectedFile` and `isPreviewOpen` were removed). Re-opening an open path activates its tab without duplicating it but still bumps `openSeq`; closing the active tab activates its right neighbour, else its left, else Files; `openPreviewByPath` rejects unsafe paths (traversal segments, sensitive system paths) before touching any state. The readers (`FileTreePanel`, `SkillsSidebar`, `SkillsManager`) moved to `selectActiveFile`, with an interim `App.tsx` edit that kept the old preview panel compiling until Task 3; see [design_right-rail.md](design_right-rail.md#state) for the state model.

### Task 2: RightRail component

Added `RightRail` (default export, props `{ hidden, contentRef }`, renders `<aside id="right-rail">`) with a left-edge resize handle (the `.rail-resize-handle` variant of `.sidebar-resize-handle`), a tab strip (pinned Files tab plus one closable tab per preview), the Files body (tree plus a pinned External Folders / Todos block capped at half the rail height) and only the active preview. The width rules live as pure helpers in `rail-width.ts` (`railMaxWidth`, `clampRailWidth`, `widthOnOpen`) so they test without layout: the rail remembers its pre-widen width on an auto-widen, restores it when the last tab closes unless the user dragged or pressed arrow keys, and re-clamps through a `ResizeObserver` on the content wrapper, which keeps working while the rail is hidden. `FilePreviewPanel.onClose` became optional because the rail's tab X owns closing, and its docked `border-l` moved to the Skills Manager preview wrapper because the rail draws its own; Todos kept its open-on-first-todos logic from the left sidebar, and closing a tab hands focus to the newly active tab.

### Task 3: Mount the rail and slim the left sidebar

`App.tsx` now wraps `<main>` and `RightRail` in a measured flex row (`contentRef`), owns `railHidden`, renders the corner `PanelRight` toggle inside `<main>` outside the route animation, and un-hides the rail whenever `openSeq` changes; its old preview panel and resize code were deleted. `Sidebar.tsx` lost the Files tab, the pinned External Folders / Todos block and the todos state, and its workspace-change subscriber now calls `closePreview()` because the tabs point at files in the old workspace. Home's Arena button and the Execution and Arena input-bar headers got extra right spacing so the toggle never covers them.

### Task 4: Acceptance (driver)

Full gates on the integrated branch, a manual pass in `pnpm tauri dev` (jsdom can't show layout), then marking §4.7 done in `requirements.md`. The manual pass and the ✅ are not recorded as done; see Outstanding follow-ups.

## Critical Files — Summary

| File | Role |
|---|---|
| `src/components/layout/RightRail.tsx` | The rail: handle, tab strip, Files body, active preview, width state |
| `src/components/layout/rail-width.ts` | Pure width rules: constants, `railMaxWidth`, `clampRailWidth`, `widthOnOpen` |
| `src/stores/filePreviewStore.ts` | Tabs, `activePath`, `openSeq`, `selectActiveFile` |
| `src/App.tsx` | `railHidden`, corner toggle, content wrapper; old preview panel and resize code removed |
| `src/components/layout/Sidebar.tsx` | Files tab and pinned panels removed; clears tabs on workspace switch |
| `src/components/file-preview/FilePreviewPanel.tsx` | `onClose` optional; no docked border |
| `src/pages/SkillsManager.tsx` | Preview wrapper owns the border; still passes `onClose` |
| `src/styles/globals.css` | `.rail-resize-handle` left-edge variant |
| `src/components/layout/__tests__/RightRail.test.tsx`, `rail-width.test.ts`, `src/stores/__tests__/filePreviewStore.test.ts` | Coverage for the Review Focus scenarios |

## Outstanding follow-ups

- Manual check in `pnpm tauri dev` (done by the user; jsdom can't show layout):
  - The corner toggle hides and shows the rail on Home, Execution and Arena, and never covers the Arena button, the Execution status badge or the Arena model pickers. On Arena, the model tabs and input controls still work with the rail at half width.
  - Widening the left sidebar with a preview open makes the rail give way so the chat keeps 360px.
  - Hiding the rail while a preview is in fullscreen leaves the overlay up until Escape or the minimize button docks it.
  - At launch the rail is 300px on the Files tab, External Folders and Todos are collapsed (External Folders open if permissions were already loaded), and the tree fills the height.
  - A tree click, a chat file link, a media thumbnail and a tool-card "open" each open a tab, widen the rail to half the main content, and un-hide a hidden rail. Re-clicking the active file's link while the rail is hidden shows it again.
  - Dragging the handle (and Left/Right on the focused handle) resizes; after a drag, closing the last tab keeps the dragged width; without a drag it restores.
  - Expanded folders and the search text survive a Files ↔ preview switch and a hide/show.
  - Switching workspace closes all tabs; switching tasks in the same workspace keeps them.
  - The Skills Manager window still previews with its own X and Escape.
- Add ✅ to the `#### 4.7 Right Rail` heading in `docs/specs/requirements.md` once the manual checks pass (the heading carries no ✅ yet).

## Changelog

- 2026-10-07 — **Compacted post-implementation.** Removed the agent-handoff preamble, process-only constraints (formatting, no-commit, path alias, `forwardRef`), per-task `Files:` / `Steps:` / `Verify:` / commit blocks, and every code snippet (test files, store, width helpers, `RightRail`, App and Sidebar edits) now that the feature has shipped (#95). Thinned Tasks 1–4 to past-tense intent paragraphs under their original headings and added a Critical Files summary in place of the per-task file lists. Preserved Goal, Architecture, the product Global Constraints, Review Focus and the known simplification; kept the manual acceptance checklist as Outstanding follow-ups. Original plan recoverable via git history.
