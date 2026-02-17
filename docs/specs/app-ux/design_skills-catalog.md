# Skills Catalog — Design Document

## Overview

The Skills Catalog surfaces OpenCode skill templates bundled with the app on the Home screen as a peer tab alongside Starter Packs. Users can browse by category, install any skill into their OpenCode global skills directory (`~/.config/opencode/skills/`), and re-install when a skill's bundled version has changed.

---

## Requirements

- Display all bundled skill templates on the Home screen in a "Skills Catalog" tab (alongside the "Starter Packs" tab)
- Skills install to the OpenCode user-level skills folder: `~/.config/opencode/skills/<skill_id>/`
- Group skills by category, derived automatically from folder name prefix
- Track install state per skill using a checksum file (`.coworkz-checksum`) inside each installed skill directory
- Show a **Re-install** button when the bundled checksum differs from the installed checksum
- Allow re-install even when up-to-date (overwrites the installed folder)

---

## Source Data

**Location:** `src-tauri/resources/skill-templates/` — 72 skill folders, each containing a `SKILL.md` with YAML frontmatter:

```yaml
---
name: competitor-alternatives
description: Plan and draft competitor comparison and alternative-page strategies...
---
```

**Category derivation** (from folder name prefix, no SKILL.md changes required):

| Folder prefix | Display category |
|---------------|-----------------|
| `marketing-*` | Marketing |
| `sales-*` | Sales |
| `finance-*` | Finance |
| `enterprise-*` | Enterprise |
| `legal-*` | Legal |
| `product-*` | Product |
| `support-*` | Support |
| `data-*` | Data |
| `productivity-*` | Productivity |
| other / no prefix | General |

---

## Backend Architecture

### New Rust module: `src-tauri/src/commands/skills.rs`

**Types:**

```rust
pub struct SkillMeta {
    pub id: String,          // folder name (e.g. "competitor-alternatives")
    pub name: String,        // parsed from SKILL.md frontmatter
    pub description: String, // parsed from SKILL.md frontmatter
    pub category: String,    // derived from folder prefix
}

pub struct SkillStatus {
    pub installed: bool,
    pub needs_update: bool,  // true if checksums differ
}

pub struct SkillWithStatus {
    pub meta: SkillMeta,
    pub status: SkillStatus,
}
```

**Tauri commands:**

| Command | Signature | Description |
|---------|-----------|-------------|
| `skills_list_with_status` | `() -> Vec<SkillWithStatus>` | List all bundled skills with install status |
| `skills_install` | `(skill_id: String) -> Result<(), String>` | Install or re-install a skill (overwrites) |

### Checksum Logic

1. Enumerate all files in the bundled skill directory, sorted by relative path
2. Compute SHA256 over the concatenated contents of all files
3. On install: write the hex digest as `~/.config/opencode/skills/<skill_id>/.coworkz-checksum`
4. On status check: recompute bundled checksum, read installed `.coworkz-checksum`, compare
   - File missing → `installed: false`
   - Checksums match → `installed: true, needs_update: false`
   - Checksums differ → `installed: true, needs_update: true`

### Install Path Resolution

```
~/.config/opencode/skills/<skill_id>/
```

Created via `fs::create_dir_all` if it doesn't exist. Install overwrites the entire directory (copies all files, then writes `.coworkz-checksum`).

### SKILL.md Frontmatter Parsing

Lightweight line-by-line parser (no new Rust dependencies):
- Look for `---` start/end markers
- Extract `name:` and `description:` values
- On parse failure: skip the skill with a `eprintln!` warning (no crash)

---

## Frontend Architecture

### Component: `src/components/landing/SkillsCatalog.tsx`

**State:**

```ts
interface State {
  skills: SkillWithStatus[];
  loading: boolean;
  installingId: string | null;
  activeCategory: string;   // 'All' | category name
  query: string;
  errors: Record<string, string>;
}
```

**Layout:**

The Home screen Card has a tab bar below the task input with two tabs: **Starter Packs** and **Skills Catalog**. The active tab renders its content below; only one tab is visible at a time.

```
┌─ Task Input ──────────────────────────────────────────────┐
│  [Describe a task and let AI handle the rest]     [Send]  │
├───────────────────────────────────────────────────────────┤
│  [ Starter Packs ]  [ Skills Catalog ]                    │  ← tab bar
├───────────────────────────────────────────────────────────┤
│  subtitle text                          [search input]    │
│  [All] [Marketing] [Sales] [Finance] [Data] [Legal] …    │  ← scrollable category tabs
│  ┌─────────────────────────┐  ┌─────────────────────────┐│
│  │ competitor-alternatives  │  │ content-strategy        ││
│  │ description (2 lines)…  │  │ description (2 lines)…  ││
│  │                [Install] │  │          [Installed ✓]  ││
│  └─────────────────────────┘  └─────────────────────────┘│
│  (max-h-[400px] overflow-y-auto)                          │
└───────────────────────────────────────────────────────────┘
```

**Button states per skill card:**

| State | Button | Style |
|-------|--------|-------|
| Not installed | `Install` | Primary (blue) |
| Installing | `Installing…` | Disabled |
| Installed, up-to-date | `Installed ✓` + small `Re-install` | Muted badge + ghost link |
| Installed, needs update | `Re-install` | Amber/warning |

**Category tabs:** Dynamically generated from unique categories in the skills list. Horizontally scrollable pill strip. "All" tab always first.

**Search:** Filters by skill `name`, `description`, and `category` (case-insensitive).

### Changes to `src/pages/Home.tsx`

- Added a `HomeTab` state (`'packs' | 'skills'`) with a tab bar below the task input
- Starter Packs and Skills Catalog render as mutually exclusive tab panels
- The tab bar uses a bottom-border active indicator style

### TypeScript API bindings in `src/lib/tauri-api.ts`

```ts
export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface SkillStatus {
  installed: boolean;
  needs_update: boolean;
}

export interface SkillWithStatus {
  meta: SkillMeta;
  status: SkillStatus;
}

export async function listSkillsWithStatus(): Promise<SkillWithStatus[]>
export async function installSkill(skillId: string): Promise<void>
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Install fails (permission denied, disk full) | Inline error text under the skill card (same pattern as `packErrors`) |
| `~/.config/opencode/skills/` missing | Auto-created by `fs::create_dir_all` during install |
| SKILL.md parse failure | Skill skipped, warning logged, no crash |
| Skills list fails to load | Muted "Failed to load skills" message in the catalog section |
| Re-install on up-to-date skill | Allowed — overwrites existing files, writes fresh checksum |

---

## File Checklist

**New files:**
- `src-tauri/src/commands/skills.rs` — Rust commands (list, install, checksum)
- `src/components/landing/SkillsCatalog.tsx` — React component

**Modified files:**
- `src-tauri/src/commands/mod.rs` — expose `skills` module
- `src-tauri/src/lib.rs` — register new Tauri commands in `invoke_handler`
- `src/lib/tauri-api.ts` — add `SkillMeta`, `SkillStatus`, `SkillWithStatus` types + API functions
- `src/lib/tauri-api-interface.ts` — add `listSkillsWithStatus`, `installSkill` to the `TauriAPI` interface
- `src/pages/Home.tsx` — add tab bar, render `<SkillsCatalog />` as tab panel alongside Starter Packs
- `src-tauri/Cargo.toml` — add `sha2` crate for SHA256

---

## Non-Goals (YAGNI)

- Skill update notifications / background polling
- Skill uninstall (out of scope — user can delete manually)
- Per-workspace skill installs (global only for now)
- Remote/online skill catalog
