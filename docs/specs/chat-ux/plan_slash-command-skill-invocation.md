# Plan: Slash Command Skill Invocation (3.8)

## Context

Users need a way to invoke installed skills directly from the task input or chat follow-up input, similar to Claude Code's `/` slash command UX. Currently, skills can only be browsed and installed via the Skills Catalog on the Home page, but there's no way to explicitly invoke a skill when starting a task or sending a follow-up message.

This feature adds a `/skill` autocomplete popover to both input surfaces (TaskInputBar and ChatInput). Typing `/` at the start of input shows installed skills in a popover. Selecting a skill renders it as a visual pill/chip above the textarea. On submit, the prompt is prefixed with `/skill-id`.

## Requirement Addition

Add `3.8 Slash Command Invocation` to `docs/specs/requirements.md` under section 3

## Implementation Plan

### Step 1: Create `skillsStore.ts` — Installed skills cache

**File:** `src/stores/skillsStore.ts` (new)

A small Zustand store to cache installed skills globally, so both input components and the SkillsCatalog can share the same data.

- `fetchInstalledSkills()` calls `api.listSkillsWithStatus()`, filters to `status.installed === true`, extracts `.meta` array
- Deduplicate fetch calls (guard against concurrent fetches)

### Step 2: Create `SkillPill` component

**File:** `src/components/ui/skill-pill.tsx` (new)

Pure presentational component displaying a selected skill as a chip.

- Skill name rendered as a `<button>` with `hover:underline` — clicking opens the skill's SKILL.md in FilePreviewPanel via optional `onClick` prop
- X icon button (lucide `X`) to remove via `onRemove` prop
- Uses primary-tinted styling for high visibility across all themes: `border-primary/30 bg-primary/10 text-primary`
- Tailwind: `inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-sm text-primary`

### Step 3: Create `SkillAutocompletePopover` component

**File:** `src/components/ui/skill-autocomplete-popover.tsx` (new)

Renders the filtered skill list relative to the input.

- Supports configurable positioning via `position` prop (default `'above'`):
  - `'above'`: `absolute bottom-full left-0 right-0 mb-2` — used by ChatInput (bottom of screen)
  - `'below'`: `absolute top-full left-0 right-0 mt-2` — used by TaskInputBar (Home page, popover drops below the input)
- Uses existing design tokens: `bg-popover text-popover-foreground border rounded-md shadow-md`
- Max height `max-h-[240px]` with `overflow-y-auto`
- Each item row: skill name (font-medium) + description (text-muted-foreground, truncated)
- Highlighted item uses `bg-accent` background
- Auto-scrolls highlighted item into view via `scrollIntoView` (with guard for jsdom test environments)
- Each item has `role="option"`, `aria-selected`, and `onKeyDown` for a11y compliance
- Empty state: "No skills match"

### Step 4: Create `useSkillAutocomplete` hook

**File:** `src/hooks/useSkillAutocomplete.ts` (new)

Core shared logic for slash command detection, filtering, selection, and keyboard navigation.

**Key logic:**
- Popover opens when `text.startsWith('/') && !selectedSkill`
- Query = `text.slice(1)` — filters installed skills by case-insensitive substring match on id, name, description
- `handleKeyDown`: intercepts ArrowUp/Down (navigate), Tab/Enter (select), Escape (dismiss) when popover is open; passes through otherwise
- `selectSkill`: sets `selectedSkill`, calls `onTextChange('')` to clear the `/query` text, closes popover
- `composePrompt`: returns `/${selectedSkill.id} ${text}`.trimEnd() if skill selected, otherwise `text`
- Fetches from `useSkillsStore` (triggers `fetchInstalledSkills()` on mount if not loaded)

### Step 5: Integrate into `TaskInputBar.tsx`

**File:** `src/components/landing/TaskInputBar.tsx` (modify)

Add two optional props: `selectedSkill`, `onSkillChange`

Changes:
- Container div uses `relative` positioning and `flex-col` layout for pill + input row stacking
- Use `useSkillAutocomplete` hook internally, wiring `text=value`, `onTextChange=onChange`
- All selection/removal flows through the hook (`selectSkill`/`clearSkill`); a `useEffect` syncs the hook's `selectedSkill` to `onSkillChange` when in controlled mode — this ensures both keyboard (Tab/Enter) and mouse selection propagate to the parent
- When `controlledSkill` prop is provided (`!== undefined`), use it for rendering; otherwise fall back to hook's internal state
- Render `<SkillPill>` above the textarea row when a skill is selected
- Render `<SkillAutocompletePopover position="below">` so the dropdown appears below the input (avoids clipping by the parent Card's `overflow-hidden`)
- Modify `handleKeyDown`: pass through hook's `handleKeyDown` first; if the hook handled the event (prevented default), skip existing Enter-to-submit logic

Visual layout:
```
┌─ container (relative, flex-col) ──────────────────────┐
│  [🔧 My Skill  ×]          ← SkillPill (if selected) │
│  ┌─ textarea ──────────────────────────────────┐      │
│  │ Type your query here...                     │ [▶]  │
│  └─────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
   ┌─ SkillAutocompletePopover (absolute, below) ──┐
   │ skill-a   Description text here...             │
   │ skill-b   Another description...          [hl] │
   └────────────────────────────────────────────────┘
```

### Step 6: Update `Home.tsx` — compose prompt on submit

**File:** `src/pages/Home.tsx` (modify)

- Add state: `const [selectedSkill, setSelectedSkill] = useState<SkillMeta | null>(null)`
- Pass to TaskInputBar: `selectedSkill={selectedSkill} onSkillChange={setSelectedSkill}`
- Modify `handleSubmit`: compose prompt using `selectedSkill ? \`/${selectedSkill.id} ${prompt}\`.trimEnd() : prompt`
- Clear `selectedSkill` before calling `executeTask` (set to `null`)

### Step 7: Integrate into `ChatInput.tsx`

**File:** `src/components/chat/ChatInput.tsx` (modify)

- Use `useSkillAutocomplete` hook internally (ChatInput manages its own `followUp` state, so skill state is internal too)
- Add `selectedSkill` internal state via the hook
- Render `<SkillPill>` and `<SkillAutocompletePopover>` in the follow-up input section
- Modify `handleFollowUp`: use `composePrompt()` from the hook before calling `onSend()`
- Clear skill after sending
- Wrap the follow-up input section in a relatively-positioned container

### Step 8: Update `SkillsCatalog.tsx` — refresh cache on install

**File:** `src/components/landing/SkillsCatalog.tsx` (modify)

- After successful install (inside `handleInstall`), call `useSkillsStore.getState().fetchInstalledSkills()` to refresh the shared cache
- This ensures the autocomplete popover reflects newly installed skills immediately

### Step 9: Initialize skills cache on app mount

No explicit `App.tsx` change needed. The `useSkillAutocomplete` hook triggers `fetchInstalledSkills()` on mount if `!isLoaded`, so the first component that renders the hook (TaskInputBar on the Home page) bootstraps the cache automatically.

### Step 10: Write tests

**New test files:**
- `src/hooks/__tests__/useSkillAutocomplete.test.ts` — filtering, selection, keyboard nav, prompt composition
- `src/components/ui/__tests__/skill-pill.test.tsx` — renders name, X click calls onRemove
- `src/components/ui/__tests__/skill-autocomplete-popover.test.tsx` — renders items, highlights, click selection, empty states

## Keyboard Interaction Reference

| Key | Popover Closed | Popover Open |
|-----|---------------|-------------|
| `/` (at pos 0, no skill) | Opens popover | Part of filter query |
| Characters | Normal typing | Updates filter |
| ArrowUp/Down | Normal cursor | Navigates list (wraps) |
| Tab | Default | Selects highlighted skill |
| Enter | Submit message | Selects highlighted skill |
| Shift+Enter | Newline | Newline |
| Escape | — | Dismisses popover, clears `/` text |
| Backspace | Normal | Updates filter; dismisses if text becomes empty |

### Step 11: Clickable skill pill — open SKILL.md in FilePreviewPanel

**Files:**
- `src-tauri/src/commands/skills.rs` (modify) — Add `skills_get_skill_file_path` Tauri command
- `src-tauri/src/lib.rs` (modify) — Register the new command
- `src/lib/tauri-api.ts` (modify) — Add `getSkillFilePath(skillId, workspacePath?)` function
- `src/lib/tauri-api-interface.ts` (modify) — Add interface method
- `src/components/ui/skill-pill.tsx` (modify) — Add optional `onClick` prop; render skill name as a `<button>` with `hover:underline`
- `src/components/chat/ChatInput.tsx` (modify) — Wire `onClick` on SkillPill to resolve and open SKILL.md
- `src/components/landing/TaskInputBar.tsx` (modify) — Wire `onClick` on SkillPill to resolve and open SKILL.md

**Skill file resolution** follows OpenCode's discovery order:
1. Project-level: `<workspace>/.opencode/skills/<id>/SKILL.md`, `<workspace>/.claude/skills/<id>/SKILL.md`, `<workspace>/.agents/skills/<id>/SKILL.md`
2. Global: `~/.config/opencode/skills/<id>/SKILL.md`, `~/.claude/skills/<id>/SKILL.md`, `~/.agents/skills/<id>/SKILL.md`
3. Bundled templates: `resources/skill-templates/<id>/SKILL.md`

The frontend passes `activeWorkspace.folderPath` from `useWorkspaceStore` to enable project-level resolution.

### Step 12: Integrate slash commands into ArenaInputBar

**File:** `src/components/arena/ArenaInputBar.tsx` (modify)

ArenaInputBar converted from uncontrolled to controlled textarea to support `useSkillAutocomplete` hook:
- Added `inputValue` state and wired to textarea `value`/`onChange`
- Integrated `useSkillAutocomplete` hook, `SkillAutocompletePopover` (position below), and `SkillPill`
- `handleStart` and `handleFollowUp` use `composePrompt()` to prefix skill ID
- `handleKeyDown` passes through hook's key handler before checking Cmd+Enter
- Skill pill click opens SKILL.md via `getSkillFilePath` (same pattern as ChatInput/TaskInputBar)

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `docs/specs/requirements.md` | Modify | Add requirement 3.8 |
| `src/stores/skillsStore.ts` | Create | Installed skills Zustand cache |
| `src/components/ui/skill-pill.tsx` | Create | Skill chip/pill component (clickable name opens SKILL.md) |
| `src/components/ui/skill-autocomplete-popover.tsx` | Create | Autocomplete popover UI (configurable position) |
| `src/hooks/useSkillAutocomplete.ts` | Create | Shared slash command hook |
| `src/components/landing/TaskInputBar.tsx` | Modify | Add popover (below) + pill integration with controlled-mode sync + pill click |
| `src/pages/Home.tsx` | Modify | Manage skill state, compose prompt |
| `src/components/chat/ChatInput.tsx` | Modify | Add popover (above) + pill for follow-ups + pill click |
| `src/components/arena/ArenaInputBar.tsx` | Modify | Add slash command support + pill click (controlled textarea) |
| `src/components/landing/SkillsCatalog.tsx` | Modify | Refresh cache after install |
| `src-tauri/src/commands/skills.rs` | Modify | Add `skills_get_skill_file_path` command |
| `src-tauri/src/lib.rs` | Modify | Register new command |
| `src/lib/tauri-api.ts` | Modify | Add `getSkillFilePath()` |
| `src/lib/tauri-api-interface.ts` | Modify | Add interface method |
| `src/hooks/__tests__/useSkillAutocomplete.test.ts` | Create | Hook tests (16 tests) |
| `src/components/ui/__tests__/skill-pill.test.tsx` | Create | Pill tests (2 tests) |
| `src/components/ui/__tests__/skill-autocomplete-popover.test.tsx` | Create | Popover tests (5 tests) |

## Verification

1. `pnpm typecheck` — passes
2. `pnpm test --run` — all tests pass
3. `cd src-tauri && cargo check` — passes
4. Manual testing:
   - Type `/` in TaskInputBar → popover appears **below** the input with installed skills
   - Type `/mar` → filters to marketing skills
   - Press Tab or click → skill pill appears above textarea, popover closes, textarea cleared
   - Type query text → appears in textarea below pill
   - Press Enter → task starts with prompt `/skill-id query text`
   - Click X on pill → pill removed, back to normal input
   - Click skill name on pill → SKILL.md opens in FilePreviewPanel
   - Same flow in ChatInput follow-up (popover appears **above** the input)
   - Same flow in ArenaInputBar (popover appears **below** the input)
   - Install a new skill in Catalog → immediately available in autocomplete
   - Project-level skills (`.opencode/skills/`) resolve before global skills

## Enhancement: Cursor-aware Trigger + Multi-Skill (v0.6.8)

### Problem

- The popover only opened when `text.startsWith('/')`. Typing `/` after existing prose did nothing, and filtering used the whole remainder of the input rather than only the characters between `/` and the caret. Any text before the `/` broke matching.
- Only one skill could be referenced per prompt — state was a single `selectedSkill: SkillMeta | null` and the pill UI was rendered as one element.

### Design changes

- **Cursor-aware trigger.** `useSkillAutocomplete` accepts `cursorPosition`. A new `findSlashTrigger(text, cursor)` scans backward from `cursor - 1` for a `/` preceded by string start or whitespace, with no whitespace between the `/` and the cursor. Query is `text.slice(slashStart + 1, cursor)`.
- **Multi-skill state.** `selectedSkill: SkillMeta | null` is replaced by `selectedSkills: SkillMeta[]` (ordered, id-deduped). `selectSkill(skill)` appends; `removeSkill(id)` removes by id; `clearAllSkills()` replaces the old `clearSkill`.
- **Selection preserves prose.** On `selectSkill`, the hook removes only the `[slashStart, cursor)` range from text, not the whole textarea. `onTextChange` gains an optional `cursor` argument so callers can restore the textarea's `selectionStart` after React flushes.
- **Escape clears only the `/query` token** — not the entire input.
- **Popover open predicate** no longer gates on `!selectedSkill`; a `/` can be typed even while pills are shown.
- **`composePrompt`** concatenates all selected skill IDs in selection order: `"/skill-a /skill-b user text"` (or just the prefix if text is empty).

### Trigger detection examples

| Input (cursor at end) | Trigger? | Why |
|---|---|---|
| `/mar` | ✅ query=`mar` | `/` at position 0 |
| `Explain this: /mar` | ✅ query=`mar` | `/` preceded by space |
| `/foo bar /mar` | ✅ query=`mar` | nearest `/` to cursor, preceded by space |
| `http://foo` | ❌ | `/` preceded by `:` |
| `@src/Foo` | ❌ | `/` preceded by `c` |
| `/foo ` (trailing space) | ❌ | whitespace between `/` and cursor |

### Affected files

- `src/hooks/useSkillAutocomplete.ts` — new trigger detection, array state, extended `onTextChange(text, cursor?)` signature
- `src/components/landing/TaskInputBar.tsx` — controlled props renamed to `onSkillsChange: (skills: SkillMeta[]) => void`; `selectedSkill` prop removed; pill list render
- `src/pages/Home.tsx` — array state (`selectedSkills`); map-based compose; `pendingPrompt` state preserves composed prompt across the settings-dialog retry
- `src/components/chat/ChatInput.tsx` — cursor tracked in state (was a ref); pill list render
- `src/components/arena/ArenaInputBar.tsx` — cursor tracked in state; pill list render; `doInsertText` now updates cursor state
- `src/hooks/__tests__/useSkillAutocomplete.test.ts` — updated for new API + new cases (cursor-aware trigger, multi-skill, dedupe, Escape semantics)

### Keyboard interaction (updated)

| Key | Popover closed | Popover open |
|-----|----------------|--------------|
| `/` at start or after whitespace | Opens popover | Part of the slash token |
| Characters | Normal typing | Updates filter |
| Space after `/query` | Normal typing | Closes popover |
| ArrowUp/Down | Normal cursor | Navigates list (wraps) |
| Tab | Default | Selects highlighted skill; removes only `/query` token |
| Enter | Submit message | Selects highlighted skill; removes only `/query` token |
| Shift+Enter | Newline | Newline |
| Escape | — | Dismisses popover; removes only the `/query` token |
| Backspace | Normal | Updates filter; closes popover if `/` is deleted |

## Fix: Symlink-Installed Skills Not Appearing in Autocomplete (v0.6.11)

### Problem

Skills installed via the Skills Manager on macOS/Linux are symbolic links pointing to the repo cache directory. The `skills_list_with_status` Rust command determined install status solely by checking for a `.coworkz-checksum` file inside the install directory. Symlink-based installs do not contain this file (the symlink itself is the tracking mechanism), so they were reported as `installed: false` and excluded from the slash command autocomplete.

### Root cause

In `src-tauri/src/commands/skills.rs`, `list_skills_with_status()` used a single condition:

```rust
let status = if !checksum_file.exists() {
    SkillStatus { installed: false, needs_update: false }
} else { ... };
```

This only recognized copy-based installs (which write `.coworkz-checksum`). The Skills Manager's own `skills_list_installed` command in `skill_repos.rs` correctly handled symlinks by checking `path.is_dir()` + `SKILL.md` existence, but the Skills Catalog command did not.

### Fix

Updated the install detection to a three-branch check:

1. **`.coworkz-checksum` exists** — copy-based install (Windows / legacy): compare checksums for `needs_update`
2. **Directory exists with `SKILL.md` but no checksum file** — symlink install (macOS/Linux): mark `installed: true`, `needs_update: false` (symlinks always reflect the latest repo cache)
3. **Neither** — not installed

No frontend changes were needed. `ChatInput.tsx` and `Home.tsx` already correctly filter by `s.status.installed` from the store.

### Affected files

- `src-tauri/src/commands/skills.rs` — updated `list_skills_with_status()` install detection logic

## Fix: Custom Skills in `~/.config/opencode/skills` Not Appearing in Autocomplete (v0.6.11)

### Problem

Skills that exist directly in `~/.config/opencode/skills/<id>/` but were never registered in the Skills Catalog — for example, folders the user copies in by hand or skills installed from custom repos that do not ship as bundled templates — never appeared in the `/` slash command autocomplete.

The Skills Catalog UI also missed them, since `listSkillsWithStatus()` is the single source of truth for the `skillsStore` cache that drives both surfaces.

### Root cause

`list_skills_with_status()` in `src-tauri/src/commands/skills.rs` enumerated only the bundled `resources/skill-templates/` directory and looked up each template's install state at `<skills_dir>/<id>`. Any skill present in the global skills dir without a matching bundled template was therefore invisible — the function never opened that directory for enumeration.

The earlier v0.6.11 fix (above) only changed install *detection* for IDs already in the bundled set. It did not address skills that are not in the bundled set at all.

### Fix

Refactored the body of `list_skills_with_status()` into a pure helper `list_skills_in_dirs(templates_dir, skills_dir)` that performs two passes:

1. **Bundled templates pass** — same as before. Each template gets an install/needs_update status by inspecting `<skills_dir>/<id>` (checksum file → copy install, `SKILL.md` only → symlink install, neither → not installed).
2. **Custom skills pass** — `read_dir(skills_dir)` and, for every entry not already produced by pass 1 that is a directory containing `SKILL.md`, parse the frontmatter and emit a `SkillWithStatus { installed: true, needs_update: false }`. `is_dir()` follows symlinks, so symlink-installed skills from custom repos are also covered.

Bundled-template entries take precedence on ID collision so existing `needs_update` semantics are preserved.

### Why no frontend changes

`skillsStore.fetchInstalledSkills()` already filters by `s.status.installed` and the autocomplete already binds to that store, so newly enumerated custom skills flow through automatically.

### Tests

Added three unit tests in `src-tauri/src/commands/skills.rs`:

- `test_list_skills_in_dirs_includes_custom_skills_in_global_dir` — a custom skill present only in the skills dir is enumerated as installed; an uninstalled bundled template stays uninstalled.
- `test_list_skills_in_dirs_template_takes_precedence_over_custom` — when an ID exists in both sets, the bundled-template entry (with checksum-based status) wins.
- `test_list_skills_in_dirs_skips_custom_entries_without_skill_md` — directories without `SKILL.md` and dotfile entries are ignored.

### Affected files

- `src-tauri/src/commands/skills.rs` — extracted `list_skills_in_dirs()` and added the custom-skill discovery pass; new unit tests
