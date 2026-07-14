# Plan: Design Overhaul

## Homescreen Design Polish

### Context

Part of the ongoing "Impeccable" design overhaul: bringing each surface into line with [`DESIGN.md`](../../../DESIGN.md) ("The Helpful Colleague" system) and [`PRODUCT.md`](../../../PRODUCT.md). The chat surface was the first pass (commits `cb8631e` init, `d648e59` chat). This plan covers the **Homescreen** — the task launcher at [src/pages/Home.tsx](src/pages/Home.tsx) and its three landing tabs.

No numbered requirement drives this. The driver is DESIGN.md rule compliance (the One Green Rule, the Whisper Rule, no glassmorphism, token-only color, 6px button radius) plus WCAG 2.1 AA (reduced motion, contrast) from PRODUCT.md. It is a quality/refinement pass on shipped UI, not a new feature.

### Approach

Audit the Homescreen against the design system, classify each deviation by root cause (missing token / one-off implementation / conceptual misalignment), and fix by category. Keep changes surgical and token-driven. Where a deviation is a documented cross-surface decision (skill-category colors), defer to a system-level call rather than change it unilaterally.

### Changes

1. Card: kill the heavy shadow and glassmorphism
**File:** [src/pages/Home.tsx](src/pages/Home.tsx) — main launcher `Card`

- `shadow-xl` → `shadow-md`. `shadow-xl` uses 20px+ offsets/blur, far outside the system's tight-blur (≤6px) "whisper" shadow vocabulary. `shadow-md` matches the design's hover-lift.
  - Rule: **The Whisper Rule** (DESIGN.md §4).
- Dropped `backdrop-blur-md` + `bg-card/95` → solid `bg-card`. Decorative glass is a named ban, and the blur resolved to nothing over a solid backdrop.
  - Rule: **No glassmorphism / SaaS gloss** (DESIGN.md §6, PRODUCT.md anti-references).

2. Page background: stop misusing a state token
**File:** [src/pages/Home.tsx](src/pages/Home.tsx) — outer container

- `bg-accent` → `bg-muted`. `accent` (#e8e8e8) is the hover-state fill token; `muted` (#efefef) is the intended subtle-background token. The card still separates via shadow + border.
  - Root cause: **wrong token** (one-off).

3. Button radii: standardize to the 6px spec
**Files:** [src/pages/Home.tsx](src/pages/Home.tsx) (Arena), [src/components/landing/TaskInputBar.tsx](src/components/landing/TaskInputBar.tsx) (submit), [src/components/landing/SkillsCatalog.tsx](src/components/landing/SkillsCatalog.tsx) (Open), [src/components/landing/StarterPacks.tsx](src/components/landing/StarterPacks.tsx) (Install)

- `rounded-lg` (8px) → `rounded-md` (6px) on all four action buttons. DESIGN.md buttons are 6px; `rounded-md` = `calc(var(--radius) - 2px)` = 6px.
- Arena button: `bg-card/80` → solid `bg-card` with a proper `hover:bg-accent` (Hover Gray is the correct ghost/outline hover fill).
  - Rule: **Components — Buttons, 6px** (DESIGN.md §5); consistent affordances (product register).

4. Accessibility: reduced-motion guards
**File:** [src/pages/Home.tsx](src/pages/Home.tsx)

- Added `useReducedMotion()`; entrance transforms on the title and card, and the tab-underline transition, collapse to opacity-only / instant when the user prefers reduced motion.
  - Rule: **Reduced-motion alternative for every animation** (DESIGN.md §6, PRODUCT.md WCAG AA).

5. Tabs: DRY + animated selection indicator
**File:** [src/pages/Home.tsx](src/pages/Home.tsx) — tab bar

- Collapsed the three copy-pasted tab buttons into a `HOME_TABS` map.
- Replaced the hard `border-b-2` swap with a sliding underline via framer-motion `layoutId="home-tab-underline"` (`springs.snappy`). Motion conveys selection state — the sanctioned product-motion case, not decoration.

6. Starter-pack difficulty chips: Restrained neutral
**File:** [src/components/landing/StarterPacks.tsx](src/components/landing/StarterPacks.tsx)

- Removed the local `COMPLEXITY_COLORS` map (four arbitrary Tailwind hues, including the banned legacy `blue`). Difficulty now renders one Restrained chip using the `secondary` token (Sage Mist fill / Forest Ink text) — the system's "gentle emphasis" surface. Distinct from the neutral tag chips beside it, no rainbow. The `Advanced` / `Beginner-Intermediate` label carries the ordinal meaning.
  - Rules: **One Green Rule / Restrained default / token-only color, no raw hex** (DESIGN.md §2, §6).
  - Decision: skill-category colors were **left untouched** (see Deferred).

### Files Summary

| File | Action |
|------|--------|
| `src/pages/Home.tsx` | Modify — shadow, bg token, glass removal, button radius, reduced-motion, DRY tabs + animated underline |
| `src/components/landing/TaskInputBar.tsx` | Modify — submit button radius `rounded-lg` → `rounded-md` |
| `src/components/landing/SkillsCatalog.tsx` | Modify — Open button radius `rounded-lg` → `rounded-md` |
| `src/components/landing/StarterPacks.tsx` | Modify — Install button radius; retire `COMPLEXITY_COLORS`, neutral `secondary` difficulty chip |

### Verification

- `pnpm typecheck` — clean.
- `pnpm dlx ultracite check` on the four files — clean.
- `pnpm test --run src/components/landing` — 10/10 pass.
- No live screenshot: Tauri native window, not drivable headless; verified via code inspection of the real interaction path.

### Deferred / systemic follow-ups

These are real but out of scope for a Homescreen pass — they are app-wide, system-level calls:

- **`ease-accomplish` is an ease-IN curve** — `cubic-bezier(0.64, 0, 0.78, 0)` (both control points at y=0 → slow start, then accelerate). Backwards for micro-interactions; DESIGN.md wants ease-out. It's a shared token ([tailwind.config.ts](tailwind.config.ts)) used across the app; changing the value is a system-wide decision.
- **Chip radius** — category / tag / difficulty chips are `rounded-full`; DESIGN.md specs chips at 6px. Kept `rounded-full` for within-row consistency. A system-wide chip-radius call for later.
- **Skill-category color map** — the 13-hue `CATEGORY_COLORS` ([src/lib/skill-categories.ts](src/lib/skill-categories.ts)) conflicts with the One Green Rule and the no-raw-color ban, but it is documented as an intentional shared taxonomy also used by the Skills Manager. Per user decision, left as-is this pass; category color-coding is a legit scannable pattern (Notion/Linear). Revisit at the system level if the One Green Rule is to be enforced everywhere.

## Chat Surface Design Polish

### Context

Second surface in the "Impeccable" overhaul: the **active-task chat view** — [src/pages/Execution.tsx](src/pages/Execution.tsx) and its chat components (`MessageList`, `MessageBubble`, `ToolCallCard`, `ThinkingIndicator`, `PermissionModal`, `QuestionDialog`). This is the daily-driver loop, so the bar was flagship (meticulous full pass), not MVP.

Same driver as the Homescreen pass: DESIGN.md rule compliance (One Green Rule, Whisper Rule, no gradient text, no bounce, token-only color) plus WCAG 2.1 AA (reduced motion, contrast, keyboard reachability) from PRODUCT.md. Quality/refinement on shipped UI, not a new feature.

### Approach

Audit against the design system, classify each deviation by root cause (missing token / one-off implementation / conceptual misalignment), fix by category. Surgical and token-driven. Where a fix required extending the system rather than applying it, flag it for the DESIGN.md owner rather than change principle unilaterally.

### Changes

1. Running badge: kill gradient text
**File:** [src/pages/Execution.tsx](src/pages/Execution.tsx) — `getStatusBadge`

- The "Running" badge used `bg-clip-text` + `animate-shimmer` gradient text — a hard ban. Replaced with solid `text-primary` and a pulsing "live" dot (`animate-ping`, `motion-reduce:hidden` on the ring). Motion conveys the active state; the green stays a state signal.
  - Rule: **Gradient text ban** (DESIGN.md §6, absolute bans).

2. Status badges + error text: tokenize
**File:** [src/pages/Execution.tsx](src/pages/Execution.tsx)

- Status badges and the queued-state clocks used Tailwind defaults (`amber-600`, `green-600`, `destructive`) instead of brand tokens. Routed to `warning` / `success` / `destructive` with AA-readable `-emphasis` text (see change 3). Error-card message → `text-destructive-emphasis`.
  - Root cause: **missing token** (values should route through the semantic palette).

3. Semantic color tokens: add AA-readable emphasis shades **(system addition — needs ratification)**
**File:** [tailwind.config.ts](tailwind.config.ts)

- Added `emphasis` shades to `warning`, `success`, and `destructive` — darker shades of the same brand hue. The brand semantic colors as specified (#EE7909, #019E55, tomato #e54d2e) all fail 4.5:1 as small label text, and even white-on-solid fails for these mid-tones at 12px. The emphasis shades are used only for small text/icons on tinted backgrounds. This is the one place the pass extended the system rather than applying it.
  - Rule: **AA body-text contrast** (PRODUCT.md); technique per the polish color rule (darker shade of the hue).

4. ToolCallCard: fix nested interactive elements + keyboard reach
**File:** [src/components/chat/ToolCallCard.tsx](src/components/chat/ToolCallCard.tsx)

- Copy / open-file affordances were `<span role="button">` nested **inside** the toggle `<button>` (invalid interactive nesting, screen-reader-hostile) and keyboard-invisible (`opacity-0`, hover-only reveal). Restructured to a toggle `<button>` with sibling real `<button>`s, revealed on `focus-within`. Collapsed-view summary text lifted off faded opacity to full `muted-foreground` for AA.
  - Rules: **Every interactive component has all states** (product register); WCAG keyboard + contrast.

5. MessageBubble: copy button, hover bug, token, timestamp
**File:** [src/components/chat/MessageBubble.tsx](src/components/chat/MessageBubble.tsx)

- Copy button was hover-only (`opacity-0 group-hover:opacity-100`) — added `focus-visible:opacity-100` so keyboard focus reveals it.
- **Bug:** the copied-state class `!hover:bg-green-500/20` is malformed Tailwind (important modifier misplaced), so the hover did nothing. Fixed to valid `hover:!bg-success/20` and routed off-token green → `success`.
- Timestamps dropped seconds (`3:45:12 PM` → `3:45 PM`).

6. ThinkingIndicator: sub-hint contrast
**File:** [src/components/chat/ThinkingIndicator.tsx](src/components/chat/ThinkingIndicator.tsx)

- Tool-name parenthetical, elapsed-time, and first-task hint were `text-muted-foreground/60`–`/50` (≈2.1–2.5:1, failing). Bumped to full `muted-foreground` (AA).

7. Permission / Question dialogs: no bounce, tokenize
**Files:** [src/components/chat/PermissionModal.tsx](src/components/chat/PermissionModal.tsx), [src/components/chat/QuestionDialog.tsx](src/components/chat/QuestionDialog.tsx)

- `springs.bouncy` → `springs.gentle` on both modal entrances (no-bounce rule).
- `getOperationBadgeClasses` used six off-system Tailwind hues (red / orange / yellow / green / blue / gray, including the banned legacy blue). Collapsed to the 3-color semantic vocabulary the system actually has: delete → destructive, overwrite → warning, create → success, everything else → neutral `muted`. Delete-warning visuals and the delete button moved off `red-600` to `destructive` tokens (`-emphasis` where AA-critical).
  - Rules: **token-only color / One Green Rule / no side vocabulary** (DESIGN.md §2, §6).

8. Reduced motion: global guard
**File:** [src/main.tsx](src/main.tsx)

- There was **no** global reduced-motion handling; every framer-motion entrance ignored the OS setting. Wrapped the app in `<MotionConfig reducedMotion="user">` — transforms degrade to a plain crossfade system-wide. One systemic fix instead of per-component guards.
  - Rule: **Reduced-motion alternative for every animation** (DESIGN.md §6, PRODUCT.md WCAG AA).

### Files Summary

| File | Action |
|------|--------|
| `tailwind.config.ts` | Modify — add `warning` / `success` / `destructive` `emphasis` shades (AA small-text) |
| `src/main.tsx` | Modify — global `MotionConfig reducedMotion="user"` |
| `src/pages/Execution.tsx` | Modify — gradient-text removal + pulsing live dot, tokenize status badges + clocks + error text |
| `src/components/chat/MessageBubble.tsx` | Modify — copy-button focus reveal, malformed hover-class bug, `success` token, timestamp |
| `src/components/chat/ToolCallCard.tsx` | Modify — nested-button a11y fix, `focus-within` reveal, tokenize, AA summary text |
| `src/components/chat/ThinkingIndicator.tsx` | Modify — sub-hint contrast to AA |
| `src/components/chat/PermissionModal.tsx` | Modify — bounce → gentle, tokenize all colors, delete button |
| `src/components/chat/QuestionDialog.tsx` | Modify — bounce → gentle |

### Verification

- `pnpm typecheck` — clean.
- `pnpm dlx ultracite check` on the eight files — clean.
- `pnpm test --run` on `Execution.test.tsx` + `QuestionDialog.test.tsx` — 12/12 pass.
- `pnpm build` — succeeds; the three emphasis-shade hsl values confirmed present in the compiled CSS bundle.
- No live screenshot: the surface renders an error state outside the Tauri runtime (`isRunningInTauri()` gate) and the chat needs opencode + a provider to produce content, so it is not drivable headless. Verified via build, compiled-CSS inspection, tests, and code inspection of the real interaction path.

### Deferred / systemic follow-ups

- **Emphasis shades need DESIGN.md sign-off** — change 3 extends the semantic palette. The alternative (solid-fill status badges) still fails AA for these brand hues, so the underlying issue is that the semantic colors are too light for AA small text app-wide. System-level call.
- **Modal whole-card drag** — both dialogs make the entire `Card` draggable (`cursor-grab`), so interactive controls inside show a grab cursor. Intentional product behavior; left as-is.
- **DebugLogPanel** — uses off-token `zinc` / `red` classes. Developer-only surface, arguably deliberately terminal-flavored; out of scope.

## Delight Pass

### Context

Third pass in the "Impeccable" overhaul: adding personality at **earned moments** rather than fixing deviations. Register is product (per [`PRODUCT.md`](../../../PRODUCT.md)), so delight lives at specific moments — completion, first-run, background events — never spread across pages. Constraints: no confetti, no sparkle, no mascots (PRODUCT.md anti-reference: toy-like AI novelty); "The Helpful Colleague" voice; reduced-motion alternative for every animation.

### Approach

Survey the app's natural delight moments (success, empty, loading, error, milestones), pick only the ones the product earns, keep each under ~1s and state-conveying. The core payoff of Cowork-Z — an agent finishing real work — had no moment at all: the "Completed" badge just swapped in. That gap drove the pass.

### Changes

1. Completion moment: checkmark draw + spring pop
**File:** [src/pages/Execution.tsx](src/pages/Execution.tsx) — `TaskStatusBadge`

- `getStatusBadge()` extracted into a `TaskStatusBadge` component. On a **live** transition (running/starting → completed) the badge springs in (`springs.bouncy`) and the check draws itself via SVG `pathLength` — circle ~300ms, then tick ~250ms.
- Live-only guard: prev-status tracked via the React "adjust state during render" pattern; component mounted with `key={task.id}` so switching tasks resets tracking. Opening an already-completed task renders the static badge — the celebration can never replay.
- Reduced motion: static badge, no draw.
  - Rules: **motion conveys state** (product register); celebrate success at the moment it happens (delight reference).

2. Background completion: sidebar check pop
**File:** [src/components/ui/task-status-icon.tsx](src/components/ui/task-status-icon.tsx)

- `TaskStatusIcon` pops the check (`scale 0 → 1`, `springs.bouncy`) when a task completes while on screen — makes a background task's "done" visible without a toast. Same prev-status guard: no pop on mount, no pop from `queued`, skipped under reduced motion.
- Arena list items inherit for free (shared component).

3. Time-aware Home greeting
**File:** [src/pages/Home.tsx](src/pages/Home.tsx)

- "What will you accomplish today?" → hour-segmented: "this morning" (5–12) / "this afternoon" (12–17) / "this evening" (17–22) / "tonight" (22–5). Computed once per mount (lazy `useState`). Same sentence shape, plain-spoken; the kind of detail that compounds with daily use (daily-driver positioning).

### Files Summary

| File | Action |
|------|--------|
| `src/pages/Execution.tsx` | Modify — `getStatusBadge()` → `TaskStatusBadge` component with live-completion checkmark draw |
| `src/components/ui/task-status-icon.tsx` | Modify — spring pop on live running → completed transition |
| `src/pages/Home.tsx` | Modify — time-aware greeting |
| `src/components/ui/__tests__/task-status-icon.test.tsx` | Add — transition-guard tests (pop on live transition; no pop on mount / from queued) |

### Verification

- `pnpm typecheck` — clean.
- `pnpm dlx ultracite check` on the four files — clean.
- Full frontend suite — 30 files, 356 tests pass (4 new).
- No live screenshot (no browser automation in repo; Tauri-gated surface). Transition logic verified by unit tests; badge draw worth one live look in `pnpm tauri dev`.

### Considered and rejected

- **Rotating "thinking" messages** — noise next to existing startup-stage copy; cliched loading copy is an AI tell.
- **Softer failure copy** — "Task failed" is honest and plain; warmth shouldn't blur state reporting.
- **Sound** — desktop app, unprompted audio; no.

## Changelog

- **2026-07-13** — Initial Homescreen design-system alignment pass (this plan).
- **2026-07-13** — Chat Surface flagship polish pass (Execution view + chat components).
- **2026-07-13** — Delight pass: completion checkmark draw, sidebar completion pop, time-aware greeting.
- **2026-07-14** — Investigated "delight animations not visible" report. Verdict: no code defect. Full-app browser replication (WebKit + Chromium, dev + prod React, real store, realistic completion event bursts) plays both animations every time; OS Reduce Motion off; sidecar logs prove the frontend processed `task:complete` live. Root cause: the installed release app was an older pre-delight build — the release pipeline experiments republished tag `v0.8.4` from the delight commit while the repo was already at 0.8.5, and v0.8.5 was never published. Both animations are also live-only and never replay (by design), so any missed completion moment looks permanently static.
- **2026-07-14** — Cleanup found during the investigation: removed dead frontend listeners for events with no Rust emitter (`task:status-change`, `task:update-batch`, `task:summary`) plus the code only they fed — `taskStore.updateTaskStatus` / `addTaskUpdateBatch`, `arenaStore.handleStatusChange` / `handleTaskUpdateBatch` (incl. their event-buffer variants), the `saveTaskStatus` API wrapper, and registrations in `Execution.tsx`, `Sidebar.tsx`, `Arena.tsx`. Republished v0.8.5 via the `release` branch.
