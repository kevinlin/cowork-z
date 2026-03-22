---
name: Tool Call Card Redesign
overview: Redesign ToolCallCard to match Cursor's compact, borderless tool call styling with hover-reveal controls (expand, copy, open file) and reduced spacing.
---

# Tool Call Card Redesign (Cursor-Style)

## Reference: Cursor's Tool Call UI

From the screenshot, Cursor's tool call rows have these characteristics:

- **Borderless rows** -- no card border, just a subtle rounded background (`rounded-md` not `rounded-lg`)
- **Compact** -- minimal vertical padding (`py-1.5` or `py-1`), tighter horizontal padding
- **Collapsed row**: checkbox/status icon on left, tool label + monospace summary, chevron on right
- **Hover controls**: on mouse-over, a set of small icon buttons appear on the right side of the row (copy icon, expand/external-link icon, three-dot menu)
- **Expanded state**: shows an embedded terminal/code block with the output, with a "Review" button for file-based tools
- **Grouped**: consecutive tool calls stack tightly with minimal gap between them

## Changes

### 1. Restyle `ToolCallCard.tsx`

Current: `rounded-lg border border-border bg-muted/50` with `px-3 py-2`

Target:

- Remove the border: `rounded-md bg-muted/30` (no `border`)
- Reduce padding: `px-2.5 py-1.5` on the collapsed row
- Reduce icon sizes from `h-4 w-4` / `h-3.5 w-3.5` to `h-3.5 w-3.5` / `h-3 w-3` consistently
- Add a `group` class to the outer container for hover-reveal controls

### 2. Add Hover Controls

On hover, show a row of small icon buttons on the right side (replacing the static chevron/check):

- **Copy button** -- copies `toolInput` + `toolOutput` to clipboard (uses `Copy`/`Check` icons)
- **Expand/collapse toggle** -- `ChevronDown`/`ChevronRight` (already exists, just repositioned)
- **Open in file viewer** -- for file-based tools (`Read`, `Write`, `Edit`, `MultiEdit`, `patch`, `multiedit`), show an `ExternalLink` icon that calls `useFilePreviewStore.openPreviewByPath(filePath)`

The controls container: `opacity-0 group-hover:opacity-100 transition-opacity` positioned on the right side of the row. The status indicator (spinner/check) remains visible always; the hover controls appear alongside it.

### 3. File-Based Tool "Open File" Action

Tools that operate on files: `Read`, `Write`, `Edit`, `MultiEdit`, `patch`, `multiedit`

When the tool input contains a `path` or `file_path` field:

- Show an `ExternalLink` icon button in the hover controls
- On click, call `useFilePreviewStore.getState().openPreviewByPath(filePath)` to open the file in the built-in file preview panel
- This reuses the existing `openPreviewByPath` from `[src/stores/filePreviewStore.ts](src/stores/filePreviewStore.ts)`

### 4. Update `MessageBubble.tsx` Tool Wrapper

The `motion.div` wrapper for tool messages in `[MessageBubble.tsx](src/components/chat/MessageBubble.tsx)` (lines 126-134) currently adds `group` class. Ensure the wrapper doesn't add extra padding/margin that conflicts with the new compact styling. Reduce the entrance animation `y` offset from `8` to `4` for subtlety.

### 5. Update Design Doc

Add a new subsection under "Tool Call Display" in `[docs/specs/chat-ux/design_chat-ux.md](docs/specs/chat-ux/design_chat-ux.md)` documenting:

- The hover controls behavior (copy, expand, open file)
- The compact borderless styling
- The file-based tool "open in viewer" action

### 6. Update `UPDATE_LOG.md`

Add entry under `v0.6.1` (or new `v0.6.2` section) describing the tool call card redesign.

---

## Files to Modify

- `[src/components/chat/ToolCallCard.tsx](src/components/chat/ToolCallCard.tsx)` -- main redesign: compact styling, hover controls, copy button, open-file button
- `[src/components/chat/MessageBubble.tsx](src/components/chat/MessageBubble.tsx)` -- minor: reduce tool wrapper animation/spacing
- `[docs/specs/chat-ux/design_chat-ux.md](docs/specs/chat-ux/design_chat-ux.md)` -- document new hover controls and styling
- `[UPDATE_LOG.md](UPDATE_LOG.md)` -- add changelog entry

