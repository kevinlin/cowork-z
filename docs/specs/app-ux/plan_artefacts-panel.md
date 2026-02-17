# Implementation Plan: Artefacts Panel

## Context

Users need visibility into what files the AI agent creates or modifies during a task session. This helps them:
- Track the agent's work output
- Quickly access generated files
- Verify which files were touched during a session
- Resume work by seeing what was previously created

The Artefacts Panel (Requirement 3.4) will display a list of all files the agent has written during a session, positioned in the sidebar between the Folders and Todos sections.

## Design Approach

### Key Decision: Extract from Existing Data

**We will NOT create a new database table or modify the backend.** Instead, we'll extract artifacts from the existing `task_messages` table, which already stores tool calls with `tool_name` and `tool_input` fields.

**Rationale:**
- Zero backend changes required - purely frontend implementation
- Works retroactively with all historical tasks
- Follows the same pattern as TodoPanel (derived state)
- Leverages existing, indexed database columns
- Simple to implement and test

### What Qualifies as an Artifact

**Track:** `write_file` tool calls only
- Predictable structure: `{path: string, content: string}`
- Easy to extract file paths reliably
- Clear signal of file modification

**Don't Track:**
- `read_file` - Too noisy, doesn't modify state
- `bash` - Unreliable to parse for file operations
- Other tools - Not file-related

### Deduplication Strategy

Use a Map keyed by file path to deduplicate multiple writes to the same file, keeping only the latest write timestamp.

## Implementation Steps

### 1. Type Definitions

**File:** [src/shared/types/task.ts](../../../src/shared/types/task.ts)

Add the `Artifact` interface:

**File:** [src/shared/types/index.ts](../../../src/shared/types/index.ts)

Export the new type:

```typescript
export type { Artifact } from './task';
```

### 2. Artifact Extraction Utility

**File:** [src/stores/taskStore.ts](../../../src/stores/taskStore.ts)

Add utility function to extract artifacts from messages:

### 3. Store Integration

**File:** [src/stores/taskStore.ts](../../../src/stores/taskStore.ts)

**Add to TaskState interface (around line 57):**

**Initialize in create() (around line 96):**

**Add setArtifacts action (around line 140, near setTodos):**

**Update loadTaskById (around line 242):**
After setting currentTask, extract artifacts:

**Update addTaskUpdate (around line 580):**
After updating messages, extract artifacts:

**Update reset() action:**

### 4. ArtifactsPanel Component

**File:** [src/components/sidebar/ArtifactsPanel.tsx](../../../src/components/sidebar/ArtifactsPanel.tsx) (NEW)

Create the component following TodoPanel pattern. **Key improvement:** Reuse the existing `EnhancedLink` component to leverage its built-in file handling (reveals in Finder/Explorer), icon mapping, and styling.

**Benefits of using EnhancedLink:**
- Reveals file in Finder/Explorer (better UX than just opening)
- Reuses existing icon mapping logic from `icon-utils.ts`
- Handles path safety validation automatically
- Consistent styling with markdown file links
- Built-in error handling
- Truncates long paths automatically
- Shows file extension-based icons (code, image, document, etc.)

### 5. Sidebar Integration

**File:** [src/components/layout/Sidebar.tsx](../../../src/components/layout/Sidebar.tsx)

**Add import (around line 7):**

**Add empty array constant (around line 21):**

**Add selector (around line 33):**

**Add controlled state (around line 37):**

**Add panel in ScrollArea (after FoldersPanel, around line 185):**

### 6. Unit Tests

**File:** [src/stores/taskStore.test.ts](../../../src/stores/taskStore.test.ts) (NEW)

Create tests for the extraction utility:

**File:** [src/components/sidebar/ArtifactsPanel.test.tsx](../../../src/components/sidebar/ArtifactsPanel.test.tsx) (NEW)

Create component tests:

**Note:** Since we're using `EnhancedLink`, we mock it in tests rather than testing the click behavior directly. The click handling is already tested in the `EnhancedLink` component tests.

## Testing Strategy

### Manual Testing Checklist

- [ ] Start a new task that creates multiple files (e.g., "create 3 TypeScript files")
- [ ] Verify artifacts appear in the panel as files are written
- [ ] Verify panel is positioned between Folders and Todos sections
- [ ] Click on an artifact - verify file opens with OS default application
- [ ] Test with different file types (.ts, .json, .md, .png) - verify correct icons
- [ ] Test long file paths - verify truncation with ellipsis
- [ ] Write to the same file twice - verify only one entry appears (latest)
- [ ] Resume a previous task - verify artifacts persist
- [ ] Start a task that doesn't create files - verify "No files modified yet" message
- [ ] Test panel collapse/expand functionality
- [ ] Test auto-expand when first artifact appears

### Edge Cases

- **Duplicate paths:** Handled by Map-based deduplication
- **Deleted files:** Still shown (intentional - shows what was modified)
- **Invalid toolInput:** Try-catch skips malformed entries
- **Missing path field:** Guard check before creating artifact
- **Very long paths:** CSS truncation with ellipsis
- **Files without extensions:** Shows blank extension, uses default File icon

## Files Modified

### New Files
- [src/components/sidebar/ArtifactsPanel.tsx](../../../src/components/sidebar/ArtifactsPanel.tsx) - Component
- [src/stores/taskStore.test.ts](../../../src/stores/taskStore.test.ts) - Store tests
- [src/components/sidebar/ArtifactsPanel.test.tsx](../../../src/components/sidebar/ArtifactsPanel.test.tsx) - Component tests

### Modified Files
- [src/shared/types/task.ts](../../../src/shared/types/task.ts) - Add Artifact interface
- [src/shared/types/index.ts](../../../src/shared/types/index.ts) - Export Artifact
- [src/stores/taskStore.ts](../../../src/stores/taskStore.ts) - Add artifacts Map, extraction utility, integration
- [src/components/layout/Sidebar.tsx](../../../src/components/layout/Sidebar.tsx) - Integrate ArtifactsPanel

### Documentation Updates
- [docs/specs/cowork-z/requirements.md](../../../docs/specs/cowork-z/requirements.md) - Mark 3.4 as complete, update TODO
- [docs/specs/cowork-z/plan_rich-file-url-display-in-chat.md](../../../docs/specs/cowork-z/plan_rich-file-url-display-in-chat.md) - This implementation plan

## Success Criteria

✅ Artefacts panel appears in sidebar between Folders and Tasks
✅ Shows all files created/modified via `write_file` tool
✅ Clicking artifact opens file with OS default application
✅ Artifacts persist when task is resumed (loaded from messages)
✅ Panel auto-expands when first artifact appears
✅ Deduplicates multiple writes to same file (shows latest)
✅ No database changes required
✅ Works with all historical tasks retroactively
✅ Unit tests pass for extraction utility and component
✅ Manual testing checklist completed

## Out of Scope (Future Enhancements)

- Parsing bash commands for file operations
- File preview/diff on hover
- Group artifacts by directory
- Filter by file type
- "Reveal in Finder" context menu
- Track file deletions
- Show file size
- Syntax-highlighted preview

## Estimated Effort

- **Types & Store:** 30 minutes
- **ArtifactsPanel Component:** 45 minutes (simplified by reusing EnhancedLink)
- **Sidebar Integration:** 15 minutes
- **Unit Tests:** 1 hour
- **Manual Testing:** 30 minutes
- **Total:** ~3 hours

## Dependencies

- No new dependencies required
- Reuses existing components: `EnhancedLink`, `CollapsibleSection`
- Reuses existing utilities: `file-utils.ts`, `icon-utils.ts`
