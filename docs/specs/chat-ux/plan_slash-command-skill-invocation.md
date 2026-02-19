# Plan: Slash Command Skill Invocation (3.8)

## Context

Users need a way to invoke installed skills directly from the task input or chat follow-up input, similar to Claude Code's `/` slash command UX. Currently, skills can only be browsed and installed via the Skills Catalog on the Home page, but there's no way to explicitly invoke a skill when starting a task or sending a follow-up message.

This feature adds a `/skill` autocomplete popover to both input surfaces (TaskInputBar and ChatInput). Typing `/` at the start of input shows installed skills in a popover. Selecting a skill renders it as a visual pill/chip above the textarea. On submit, the prompt is prefixed with `/skill-id`.

## Requirement Addition

Add `3.8 Slash Command Invocation` to `docs/specs/cowork-z/requirements.md` under section 3

## Implementation Plan

### Step 1: Create `skillsStore.ts` — Installed skills cache

**File:** `src/stores/skillsStore.ts` (new)

A small Zustand store to cache installed skills globally, so both input components and the SkillsCatalog can share the same data.

- `fetchInstalledSkills()` calls `api.listSkillsWithStatus()`, filters to `status.installed === true`, extracts `.meta` array
- Deduplicate fetch calls (guard against concurrent fetches)

### Step 2: Create `SkillPill` component

**File:** `src/components/ui/skill-pill.tsx` (new)

Pure presentational component displaying a selected skill as a chip.

- Shows skill name (from `skill.name`)
- X icon button (lucide `X`) to remove
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

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `docs/specs/cowork-z/requirements.md` | Modify | Add requirement 3.8 |
| `src/stores/skillsStore.ts` | Create | Installed skills Zustand cache |
| `src/components/ui/skill-pill.tsx` | Create | Skill chip/pill component |
| `src/components/ui/skill-autocomplete-popover.tsx` | Create | Autocomplete popover UI (configurable position) |
| `src/hooks/useSkillAutocomplete.ts` | Create | Shared slash command hook |
| `src/components/landing/TaskInputBar.tsx` | Modify | Add popover (below) + pill integration with controlled-mode sync |
| `src/pages/Home.tsx` | Modify | Manage skill state, compose prompt |
| `src/components/chat/ChatInput.tsx` | Modify | Add popover (above) + pill for follow-ups |
| `src/components/landing/SkillsCatalog.tsx` | Modify | Refresh cache after install |
| `src/hooks/__tests__/useSkillAutocomplete.test.ts` | Create | Hook tests (16 tests) |
| `src/components/ui/__tests__/skill-pill.test.tsx` | Create | Pill tests (2 tests) |
| `src/components/ui/__tests__/skill-autocomplete-popover.test.tsx` | Create | Popover tests (5 tests) |

## Verification

1. `pnpm typecheck` — passes
2. `pnpm test --run` — 258 tests pass (18 files), including 23 new tests
3. Manual testing:
   - Type `/` in TaskInputBar → popover appears **below** the input with installed skills
   - Type `/mar` → filters to marketing skills
   - Press Tab or click → skill pill appears above textarea, popover closes, textarea cleared
   - Type query text → appears in textarea below pill
   - Press Enter → task starts with prompt `/skill-id query text`
   - Click X on pill → pill removed, back to normal input
   - Same flow in ChatInput follow-up (popover appears **above** the input)
   - Install a new skill in Catalog → immediately available in autocomplete
