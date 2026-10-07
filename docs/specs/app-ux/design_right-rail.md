# Right Rail — Design Document

> **Requirements:** [4.7 Right Rail](../requirements.md#47-right-rail)
> **Research:** [open-worker right rail](../../research/open-worker-right-rail-collapse.md)

## Overview

The right rail is one resizable, hideable column on the right of the main content. It holds the workspace's working context: the file tree, External Folders, Todos, and file previews as closable tabs.

Before this change:

- The file tree was the "Files" tab of the left sidebar, next to Sessions and Auto.
- External Folders and Todos were pinned to the bottom of the left sidebar.
- A preview opened as a separate single-file panel right of the chat, 280–700px wide, 400px by default.

After it:

- The left sidebar is for sessions: workspace switcher, New Task, the Sessions | Auto tabs and the footer.
- The rail holds everything else. A corner button hides it and gives the chat its full width.

The model is open-worker's `RightRail`, adapted to this codebase. The research doc covers how open-worker does it. This doc only notes where we differ.

## Layout

```
<div flex h-screen>
  <Sidebar/>                          left: switcher, New Task, Sessions | Auto, footer
  <div flex-1 min-w-0 (ref)>          "main content": the area right of the left sidebar
    <main relative flex-1 min-w-0>
      routes ...
      [PanelRight toggle]             absolute top-right, outside the route animation
    </main>
    <RightRail hidden={railHidden}/>
  </div>
</div>
```

- The rail is a flex sibling of `<main>`, where the old preview panel was. When the rail's width changes the chat reflows on its own. open-worker positions its rail absolutely and offsets the chat with margins and `:has()` rules. A flex row needs none of that.
- **Main content width** is the measured width of the wrapper `div` (chat plus rail). The auto-widen rule uses it.
- The rail shows on Home, Execution and Arena. The Skills Manager window has its own layout and doesn't get one.

### Toggle button

- There is one icon button (lucide `PanelRight`), rendered once by App.tsx and pinned to the top-right corner of `<main>`. Because `<main>` ends where the rail starts, the button follows the rail's left edge and stays in the window corner when the rail is hidden.
- Accessibility: `aria-label` "Hide side panel" or "Show side panel", plus `aria-expanded` and `aria-controls` pointing at the rail.
- Pages make room for it. Home's Arena button moves left. The Execution task header and `ArenaInputBar` get extra right padding.
- It carries the `no-drag` class, like the Execution back button, so the fixed `.drag-region` strip at the top of the window never swallows the click.

## Rail anatomy

```
+--------------------------------------+
| Files | report.md  x | chart.png  x  |   tab strip, scrolls sideways
+--------------------------------------+
|                                      |
|  Files tab:   FileTreePanel          |   fills free height
|               ---------------------- |
|               > External Folders     |   pinned, capped at 50% height,
|               > Todos                |   scrolls on its own
|                                      |
|  Preview tab: FilePreviewPanel       |   active tab only
+--------------------------------------+
^ resize handle on the left edge
```

- **Resize handle.** It reuses `.sidebar-resize-handle` styles (clay on hover, Deep Forest while dragging, per DESIGN.md), mirrored to the left edge. It has `role="separator"`, `aria-orientation="vertical"` and `aria-valuenow`/`min`/`max`. When focused, Left/Right arrows move it 16px.
- **Tab strip.** `role="tablist"`. The **Files** tab comes first and has no close button. After it comes one tab per open preview, showing the file name (full path in the tooltip) and an X with `aria-label="Close <name>"`. With many tabs the strip scrolls sideways, and the active tab scrolls into view.
- **Files tab body.** `FileTreePanel` takes the free height. `FoldersPanel` and the Todos `CollapsibleSection` sit below it in a pinned block capped at half the rail height, with its own scroll, so an opened section can't squash the tree to nothing.
- **Preview tab body.** `FilePreviewPanel` for the active tab only, `key={path}`. Switching tabs re-reads the file, which is cheap and avoids keeping several iframes and PDF embeds alive.
- **`FilePreviewPanel.onClose` becomes optional.** The rail doesn't pass it, so the panel header drops its own X because the tab owns closing. Fullscreen, Open externally and Add to Chat stay. Skills Manager still passes `onClose` and doesn't change.

### Hide without unmounting

Two things hide content in the rail, and neither unmounts it:

- **Rail hidden.** The rail stays mounted and gets the `hidden` class (`display: none`).
- **A preview tab is active.** The Files body stays mounted and hidden.

The reason is that `FileTreePanel` keeps its expanded folders and search text in local hook state, and both sections decide their open state on mount. If they unmounted, every hide/show or tab switch would collapse the tree back to its root and re-run the open-on-mount logic. open-worker returns `null` instead. That works there because the state it cares about (section flags, the selected artifact) lives in `RightRail` itself, which stays mounted.

Preview bodies are the exception: only the active one is mounted, as above.

### Section defaults

External Folders and Todos move as they are, with no change to their open logic:

- **External Folders** keeps `defaultOpen={allPermissions.length > 0}`. That value is read once on mount and permissions load asynchronously, so at launch it usually starts collapsed. It opens when permissions are already in the store at mount time.
- **Todos** keeps `useState(hasTodos)` plus the effect that expands it when todos arrive (requirement 3.3 AC#5). At launch Home has no current task, so it starts collapsed.

## Left sidebar changes

[Sidebar.tsx](../../../src/components/layout/Sidebar.tsx) loses:

- the `files` value of `SidebarTab` and its tab button (and the `FolderTree` import);
- the pinned block holding `FoldersPanel` and the Todos section;
- the todos selector and `todosOpen` state, which move to `RightRail`.

It keeps the workspace switcher, New Task and search, the Sessions | Auto tabs, the footer, its own resize handle, and the workspace-change subscriber. The subscriber gains one line to clear the preview tabs.

## State

### `filePreviewStore`

The store holds a list of tabs instead of one file:

```ts
tabs: DirectoryEntry[]
activePath: string | null       // null = Files tab
openSeq: number                 // +1 on every open, including re-opening the active file

openPreview(file)               // add a tab unless the path is open; activate it; openSeq++
openPreviewByPath(path)         // same isPathSafe gate as today, then openPreview
closeTab(path)                  // if active: activate right neighbour, else left, else Files
setActive(path | null)
closePreview()                  // clear all tabs

selectActiveFile(state)         // exported selector: the active tab's entry or null
```

- `openPreviewByPath` rejects an unsafe path before touching any state, so a rejected open adds no tab and doesn't bump `openSeq`.
- `selectedFile` and `isPreviewOpen` go away. Their readers switch to `selectActiveFile`: `FileTreePanel` (row highlight), `SkillsSidebar` and `SkillsManager`.
- `closePreview` keeps its name and means "close the preview" (all tabs). Skills Manager calls it for its X and Escape, so its one-preview-at-a-time behaviour stays the same.
- Each Tauri window runs its own JS context, so the Skills Manager window has its own store and its tabs never show up in the main window.

### `railHidden`

A single `useState(false)` in App.tsx, flipped by the corner button. It isn't persisted.

App also watches `openSeq`. Any change sets `railHidden` to false, so a preview opened from any entry point (tree, chat file link, media thumbnail, tool card, the three input bars) always lands somewhere visible. `openSeq` exists because re-opening the file that's already active changes no other field. This plays the role of open-worker's `ocw-open-artifact` un-hide listener (UX-016) without a window event.

### Rail width

Local state in `RightRail`, not persisted.

| Rule | Value |
|------|-------|
| Default | 300px |
| Minimum | 240px |
| Maximum | main content width − 360px, so the chat keeps at least 360px |
| Maximum below minimum (small window) | the minimum wins |
| Window resize | clamp again, as the left sidebar does |
| Keyboard | Left/Right on the focused handle, 16px per step |

**Auto-widen.** When `openSeq` changes:

1. The target is half the main content width.
2. If the rail is narrower than the target, remember its current width (only if nothing is remembered yet) and widen to the target, clamped.
3. If it's already at or over the target, leave it alone.

**Restore.** When the tab list becomes empty (the last tab is closed, or a workspace switch clears them), go back to the remembered width, clamped, and forget it.

**A manual drag** (mouse or keyboard) forgets the remembered width. The user has taken over, so closing tabs won't snap the rail back. This is open-worker's rule for its left-nav auto-collapse, where `toggleNav` clears `navBeforePreview`.

The rule measures the wrapper `div`, not the rail, so it works the same when the open also un-hides a hidden rail.

The arithmetic lives in two pure functions next to `RightRail` so it can be tested without layout:

```ts
clampRailWidth(width, contentWidth)   // apply min, max, min-wins
widthOnOpen(width, contentWidth)      // width after an open: the target if below it, else unchanged
```

### Workspace and task switches

- **Workspace switch** clears all tabs, because their files belong to the old folder. That's one call to `closePreview()` in Sidebar.tsx's existing workspace-change subscriber.
- **Task switch inside a workspace** keeps the tabs, since the files are workspace-scoped.

## Edge cases

| Case | Behaviour |
|------|-----------|
| Open a file that's already in a tab | That tab becomes active; no duplicate. It still bumps `openSeq`, so it still widens and un-hides. |
| File deleted while its tab is open | The preview shows the read error it already shows. No auto-close. |
| Fullscreen | Per tab, same as today. Escape exits. Switching tabs remounts the preview, so it goes back to docked (6.4.4 AC#4 still holds). |
| Arena page | The rail narrows the three columns. Hiding it gives the space back. |
| 800px minimum window | Sidebar 260 + rail 240 leaves the chat about 300px. The corner button is the way out. |

## Testing

Vitest only. There are no Rust, sidecar or IPC changes, so `cargo test` and Jest aren't touched.

- **`filePreviewStore.test.ts`** (extended):
  - opening a path twice keeps one tab;
  - closing the active tab moves focus right, then left, then to Files;
  - `closePreview` clears every tab;
  - `openSeq` goes up on a re-open;
  - the three existing `isPathSafe` cases are rewritten against the tab shape.
- **Width functions:**
  - `clampRailWidth` applies the min and the max, and the min wins when they cross;
  - `widthOnOpen` widens only below half and never shrinks.
- **`RightRail` component test:**
  - Files is the default tab and has no X;
  - a preview tab's X closes it;
  - the Files body stays in the DOM while a preview is active;
  - `hidden` applies `display: none`;
  - one case stubs the wrapper's `clientWidth` (jsdom has no layout) to cover widen-on-open, then restore after the last tab closes.
- **By hand in `pnpm tauri dev`:**
  - the corner toggle on Home, Execution and Arena;
  - dragging the handle, and moving it with the arrow keys;
  - a drag stopping the restore;
  - a chat file link un-hiding a hidden rail;
  - a workspace switch clearing the tabs;
  - tree expansion surviving a hide/show and a tab switch.
- **Gates:** `pnpm typecheck`, `pnpm test --run`, `pnpm ultracite:fix`.

## Decisions

| Decision | Why |
|----------|-----|
| Tabbed rail, not a split of tree and preview | At the default 1200px window a split leaves the preview about 230px. Tabs give it the whole half. The cost is that the tree and a preview can't be seen together. |
| Hand-rolled resize, no `react-resizable-panels` | The widen rule is a few lines of arithmetic. A library would add percentage-based sizing and leave the left sidebar on a different resize mechanism. The old preview handle moves into the rail, so the app keeps two handles, as today. |
| Flex sibling, not absolute plus margins | The app shell is already a flex row and the old preview panel already sat in it. |
| `display: none`, not unmount | It keeps tree expansion, search text and section state. See "Hide without unmounting". |
| `openSeq` counter in the store | It lets `railHidden` stay plain App.tsx state and still hear about opens from eight call sites, including re-opening the active file. |
| No persistence | Matches open-worker and the left sidebar's current width handling. Easy to add later. |

## Out of scope

- Persisting rail visibility, width, tabs or section state.
- A keyboard shortcut to toggle the rail.
- A show/hide animation.
- Auto-collapsing the left sidebar while a preview is open (open-worker #3).
- A cap on the number of tabs.
- `src/components/sidebar/ArtifactsPanel.tsx` is unused since the workspace-as-folder change. It stays as it is.

## Key source locations

| Path | Change |
|------|--------|
| `src/App.tsx` | `railHidden`, corner toggle, content wrapper; the old preview panel and its resize code are removed |
| `src/components/layout/RightRail.tsx` | New: handle, tab strip, Files body, preview body, width rules |
| `src/components/layout/Sidebar.tsx` | Files tab, External Folders and Todos removed; clears tabs on workspace switch |
| `src/stores/filePreviewStore.ts` | Tabs, `activePath`, `openSeq`, `closeTab`, `setActive`, `selectActiveFile` |
| `src/components/file-preview/FilePreviewPanel.tsx` | `onClose` optional |
| `src/components/sidebar/FileTreePanel.tsx` | Highlight via `selectActiveFile` |
| `src/components/skills-manager/SkillsSidebar.tsx`, `src/pages/SkillsManager.tsx` | Read via `selectActiveFile` |
| `src/pages/Home.tsx`, `src/pages/Execution.tsx`, `src/components/arena/ArenaInputBar.tsx` | Room for the corner toggle |
| `src/styles/globals.css` | Left-edge variant of the resize handle |
