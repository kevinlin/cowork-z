# Skills Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a browsable Skills Catalog section to the Home screen that lets users install bundled OpenCode skill templates into `~/.config/opencode/skills/`, with checksum-based re-install detection.

**Architecture:** New Rust module `skills.rs` reads 77 skill directories from `resources/skill-templates/`, parses `SKILL.md` frontmatter, derives categories from folder-name prefixes, and tracks install state via `.coworkz-checksum` files. The frontend renders a new `SkillsCatalog` component below Starter Packs, with category tabs, search, and install/re-install buttons.

**Tech Stack:** Rust (sha2 crate for SHA256), Tauri 2 commands, React 19, TypeScript, Zustand (no new state — local component state only), Vitest + Testing Library.

**Design doc:** `docs/specs/skills-catalog/design.md`

---

## Task 1: Add `sha2` crate + scaffold `skills.rs` with pure helpers

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/skills.rs`

**Step 1: Add sha2 to Cargo.toml**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
sha2 = "0.10"
hex = "0.4"
```

**Step 2: Create `src-tauri/src/commands/skills.rs` with types and pure helpers**

**Step 3: Run tests to verify they fail (module not yet wired)**

```bash
cd src-tauri && cargo test commands::skills 2>&1 | head -20
```

Expected: compile error — module not found (we haven't added it to mod.rs yet).

**Step 4: Add `tempfile` dev-dependency to Cargo.toml**

In `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

**Step 5: Run just the helper tests (isolated)**

```bash
cd src-tauri && cargo test commands::skills::tests 2>&1 | head -30
```

Expected: module not found until Task 2 wires it up.

---

## Task 2: Add install logic + Tauri commands + wire into mod.rs and lib.rs

**Files:**
- Modify: `src-tauri/src/commands/skills.rs` (add install functions + commands)
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add install helpers and Tauri commands to `skills.rs`**

Append after the `collect_files` function (before `#[cfg(test)]`):

**Step 2: Add `pub mod skills;` to `src-tauri/src/commands/mod.rs`**

```rust
pub mod skills;
```

Add it after `pub mod packs;`.

**Step 3: Register commands in `src-tauri/src/lib.rs`**

In the `invoke_handler!` macro, after the packs commands:

```rust
// Skills
commands::skills::skills_list_with_status,
commands::skills::skills_install,
```

**Step 4: Run cargo check**

```bash
cd src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: no errors.

**Step 5: Run Rust tests**

```bash
cd src-tauri && cargo test commands::skills::tests -- --nocapture 2>&1 | tail -20
```

Expected: all 7 helper tests PASS.

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/skills.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add skills catalog Rust backend (skills.rs, checksum, Tauri commands)"
```

---

## Task 3: Add TypeScript API bindings

**Files:**
- Modify: `src/lib/tauri-api.ts`
- Modify: `src/lib/tauri-api-interface.ts`

**Step 1: Add types and functions to `tauri-api.ts`**

Find the `// Packs` section (around line 1173). After the packs section, add a new `// Skills` section:

Also add both functions to the returned object from `getTauriApi()`. Search for the `// Packs` section in the return object:

```ts
    // Skills
    listSkillsWithStatus,
    installSkill,
```

**Step 2: Add to the `TauriAPI` interface in `tauri-api-interface.ts`**

After the import line `import type { PackInstallResult, PackMeta } from './tauri-api';`, add `SkillWithStatus` to the import:

```ts
import type { PackInstallResult, PackMeta, SkillWithStatus } from './tauri-api';
```

Then after the `// Packs` section in the `TauriAPI` interface (after `installPackDefault`):

```ts
  // Skills
  listSkillsWithStatus(): Promise<SkillWithStatus[]>;
  installSkill(skillId: string): Promise<void>;
```

**Step 3: Run typecheck**

```bash
cd /path/to/cowork-z && pnpm typecheck 2>&1 | grep -E "error TS" | head -10
```

Expected: no TypeScript errors.

**Step 4: Commit**

```bash
git add src/lib/tauri-api.ts src/lib/tauri-api-interface.ts
git commit -m "feat: add skills TypeScript API bindings (listSkillsWithStatus, installSkill)"
```

---

## Task 4: Create `SkillsCatalog.tsx` component (TDD)

**Files:**
- Create: `src/components/landing/__tests__/SkillsCatalog.test.tsx`
- Create: `src/components/landing/SkillsCatalog.tsx`

### Step 1: Write the failing tests first

Create `src/components/landing/__tests__/SkillsCatalog.test.tsx`:

### Step 2: Run tests to verify they fail

```bash
pnpm test src/components/landing/__tests__/SkillsCatalog.test.tsx --run 2>&1 | tail -15
```

Expected: FAIL — `SkillsCatalog` module not found.

### Step 3: Implement `SkillsCatalog.tsx`

Create `src/components/landing/SkillsCatalog.tsx`:

### Step 4: Run tests to verify they pass

```bash
pnpm test src/components/landing/__tests__/SkillsCatalog.test.tsx --run 2>&1 | tail -15
```

Expected: all 8 tests PASS.

### Step 5: Commit

```bash
git add src/components/landing/SkillsCatalog.tsx src/components/landing/__tests__/SkillsCatalog.test.tsx
git commit -m "feat: add SkillsCatalog React component with tests"
```

---

## Task 5: Integrate `SkillsCatalog` into `Home.tsx`

**Files:**
- Modify: `src/pages/Home.tsx`

**Step 1: Add import to Home.tsx**

At the top of `src/pages/Home.tsx`, after the existing `TaskInputBar` import:

```ts
import SkillsCatalog from '../components/landing/SkillsCatalog';
```

**Step 2: Render SkillsCatalog below Starter Packs**

In `Home.tsx`, find the closing `</div>` of the Starter Packs section (the `{/* Starter Packs Section */}` block ends around line 239). After it, add:

```tsx
{/* Skills Catalog Section */}
<SkillsCatalog />
```

The full Card content block will now have:
1. `<CardContent>` — TaskInputBar
2. Starter Packs `<div>`
3. `<SkillsCatalog />`

**Step 3: Run typecheck**

```bash
pnpm typecheck 2>&1 | grep -E "error TS" | head -10
```

Expected: no errors.

**Step 4: Run all frontend tests**

```bash
pnpm test --run 2>&1 | tail -20
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat: integrate SkillsCatalog into Home page below Starter Packs"
```

---

## Task 6: Run cargo check + final validation

**Step 1: Cargo check**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no errors.

**Step 2: Run all Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -10
```

Expected: all tests PASS.

**Step 3: Run all frontend tests**

```bash
pnpm test --run 2>&1 | tail -10
```

Expected: all tests PASS.

**Step 4: Update requirements doc**

In `docs/specs/cowork-z/requirements.md`:
- Add `✅` to the Skills Catalog requirement heading
- Add plan reference: `> **Plan:** [Skills Catalog](../app-ux/plan_skills-catalog.md)`

**Step 5: Update UPDATE_LOG.md**

Append to the current version section:
```
- Skills Catalog — Browsable skill template catalog on Home screen with category tabs, search, install/re-install via SHA256 checksum comparison
```

**Step 6: Final commit**

```bash
git add docs/specs/cowork-z/requirements.md docs/UPDATE_LOG.md
git commit -m "docs: mark Skills Catalog requirement complete, update log"
```

---

## Summary of All Files Changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `sha2 = "0.10"`, `hex = "0.4"`, `tempfile = "3"` (dev) |
| `src-tauri/src/commands/skills.rs` | New — types, frontmatter parser, checksum, install logic, Tauri commands, unit tests |
| `src-tauri/src/commands/mod.rs` | Add `pub mod skills;` |
| `src-tauri/src/lib.rs` | Register `skills_list_with_status`, `skills_install` in invoke_handler |
| `src/lib/tauri-api.ts` | Add `SkillMeta`, `SkillStatus`, `SkillWithStatus` types + `listSkillsWithStatus`, `installSkill` functions |
| `src/lib/tauri-api-interface.ts` | Add skills methods to `TauriAPI` interface + import |
| `src/components/landing/SkillsCatalog.tsx` | New — React component with category tabs, search, install/re-install |
| `src/components/landing/__tests__/SkillsCatalog.test.tsx` | New — 8 unit tests |
| `src/pages/Home.tsx` | Import and render `<SkillsCatalog />` below Starter Packs |

---

## Implementation Log

### 2026-02-17 — Category color badges

**Change:** Added color-coded category badges to each skill card in `SkillsCatalog.tsx`, following the same pattern as `COMPLEXITY_COLORS` in `StarterPacks.tsx`.

**Files modified:**
- `src/components/landing/SkillsCatalog.tsx` — Added `CATEGORY_COLORS` constant mapping each category to Tailwind color classes (light + dark mode). Rendered a `rounded-full` badge pill beneath each skill card's name/description row showing the skill's category in its assigned color.
- `docs/specs/skills-catalog/design.md` — Documented the category color tagging feature inline: color mapping table, badge rendering details, fallback behavior, and updated wireframe.

**Category → Color mapping:**

| Category | Color |
|----------|-------|
| Marketing | Pink |
| Sales | Orange |
| Finance | Emerald |
| Enterprise | Purple |
| Legal | Slate |
| Product | Blue |
| Support | Amber |
| Data | Cyan |
| Productivity | Violet |
| General | Muted (default) |

**Pattern:** Mirrors `StarterPacks.tsx` `COMPLEXITY_COLORS` — a top-level `Record<string, string>` constant mapping display names to Tailwind class strings, consumed via template literal in JSX with a `??` fallback for unknown categories.

### 2026-02-18 — Success toast after skill installation

Added a success toast (via `sonner`) after a skill is installed or re-installed. The toast shows the skill name with "installed" or "re-installed" depending on prior state, and a description confirming the skill is available to the agent. Mirrors the same pattern added to `StarterPacks.tsx` for pack installations.

**Files modified:**
- `src/components/landing/SkillsCatalog.tsx` — Import `toast` from `sonner`; after successful `installSkill` + `listSkillsWithStatus`, show `toast.success()` with the skill name and install/re-install distinction.
