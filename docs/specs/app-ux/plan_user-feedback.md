# Plan: User Feedback (Requirement 4.5)

## Context

Users need a way to report bugs and suggest features directly from the app. The feedback flow opens pre-filled GitHub issue templates in the default browser, with environment metadata auto-appended. This avoids building an in-app form — the user writes their issue on GitHub, which also creates a public record.

## Approach

Add a `DropdownMenu` button to the sidebar bottom bar (between logo and settings). Two menu items — "Report Bug" and "Suggest Feature" — each construct a GitHub issue URL with appropriate labels, body templates, and environment info, then open it via `openExternal()`.

## Steps

### 1. Add `get_arch()` Rust command

**File:** `src-tauri/src/lib.rs`

- Add command near existing `get_version`/`get_platform` (~line 309):
  ```rust
  #[tauri::command]
  fn get_arch() -> String {
      std::env::consts::ARCH.to_string()
  }
  ```
- Register `get_arch` in the `invoke_handler!` macro (~line 1848, after `get_platform`)

**Verify:** `cd src-tauri && cargo check`

### 2. Expose `getArch()` in frontend API layer

**Files:**
- `src/lib/tauri-api.ts` — Add `getArch()` function (after `getPlatform`, ~line 47) and add it to the `getTauriApi()` return object (~line 1121)
- `src/lib/tauri-api-interface.ts` — Add `getArch(): Promise<string>` to `TauriAPI` interface (~line 29)

**Verify:** `pnpm typecheck`

### 3. Create feedback utility module

**New file:** `src/lib/feedback.ts`

- Constants: `GITHUB_ISSUES_URL = 'https://github.com/kevinlin/cowork-z/issues/new'`
- `getEnvironmentInfo()` — calls `getVersion()`, `getPlatform()`, `getArch()` with try/catch fallback to `"unknown"`
- `formatEnvironmentSection(env)` — returns markdown string for the Environment footer
- `buildBugReportUrl()` — constructs URL with `labels=bug`, title placeholder `[Bug]: `, body template (Description, Steps to Reproduce, Expected Behavior, Actual Behavior) + environment section
- `buildFeatureRequestUrl()` — constructs URL with `labels=enhancement`, title placeholder `[Feature]: `, body template (Description, Use Case, Proposed Solution) + environment section
- Use `URLSearchParams` or manual `encodeURIComponent()` for query params

### 4. Add analytics trackers

**File:** `src/lib/analytics.ts`

Add `trackFeedbackBug` and `trackFeedbackFeature` methods following the existing pattern (e.g., `trackOpenSettings` at line 53).

### 5. Create FeedbackButton component

**New file:** `src/components/layout/FeedbackButton.tsx`

- Uses `DropdownMenu` from `@/components/ui/dropdown-menu` (no new state management needed)
- Trigger: `Button` with `variant="ghost"` `size="icon"`, icon `MessageSquareHeart` from lucide-react
- Content: `side="top"` (opens upward from bottom bar), two `DropdownMenuItem`s:
  - "Report Bug" with `Bug` icon — calls `buildBugReportUrl()` then `openExternal()`
  - "Suggest Feature" with `Lightbulb` icon — calls `buildFeatureRequestUrl()` then `openExternal()`
- `data-testid="sidebar-feedback-button"`

### 6. Integrate into Sidebar

**File:** `src/components/layout/Sidebar.tsx` (~lines 217-237)

- Import `FeedbackButton`
- Wrap the right-side buttons in `<div className="flex items-center gap-1">` containing `<FeedbackButton />` followed by the existing settings `<Button>`
- Layout: `[Logo] ---- [Feedback] [Settings]`

### 7. Write tests

**New file:** `src/lib/__tests__/feedback.test.ts`
- Mock `@/lib/tauri-api` (`getVersion`, `getPlatform`, `getArch`)
- Test `buildBugReportUrl()` has `labels=bug`, contains "Steps to Reproduce", contains environment section
- Test `buildFeatureRequestUrl()` has `labels=enhancement`, contains "Use Case", contains environment section
- Test fallback to "unknown" when API calls fail
- Test URL is properly encoded

**New file:** `src/components/layout/FeedbackButton.test.tsx`
- Mock `@/lib/tauri-api` (`openExternal`) and `@/lib/feedback` (`buildBugReportUrl`, `buildFeatureRequestUrl`)
- Test button renders with correct test ID
- Test clicking opens dropdown with both options
- Test each option calls the right URL builder and `openExternal()`

## Files Summary

| File | Action |
|------|--------|
| `src-tauri/src/lib.rs` | Modify — add `get_arch()` command |
| `src/lib/tauri-api.ts` | Modify — add `getArch()` |
| `src/lib/tauri-api-interface.ts` | Modify — add `getArch()` to interface |
| `src/lib/feedback.ts` | **Create** — URL construction utilities |
| `src/lib/analytics.ts` | Modify — add feedback trackers |
| `src/components/layout/FeedbackButton.tsx` | **Create** — dropdown component |
| `src/components/layout/Sidebar.tsx` | Modify — insert FeedbackButton |
| `src/lib/__tests__/feedback.test.ts` | **Create** — utility tests |
| `src/components/layout/FeedbackButton.test.tsx` | **Create** — component tests |

## Verification

1. `cd src-tauri && cargo check` — Rust compiles
2. `pnpm typecheck` — TypeScript compiles
3. `pnpm test --run` — all tests pass
4. `pnpm tauri dev` — manual test:
   - Feedback button visible in sidebar bottom bar between logo and settings
   - Click opens dropdown with "Report Bug" and "Suggest Feature"
   - "Report Bug" opens browser to GitHub issue page with bug label, body template, and environment section
   - "Suggest Feature" opens browser with enhancement label and feature template
   - Environment section shows correct version, OS, and architecture
