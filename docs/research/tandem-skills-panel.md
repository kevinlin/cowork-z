---
date: "2026-02-17T12:38:51Z"
researcher: Claude Sonnet 4.5
git_commit: a57979893599b9b9ea16e91ac3cdd4c9c4a7c36f
branch: main
repository: tandem
topic: "SkillsPanel End-to-End: Catalog, Search, Install, and Delete"
tags: [research, codebase, skills, skill-templates, IPC, tauri-commands]
status: complete
last_updated: "2026-02-17"
last_updated_by: Claude Sonnet 4.5
---

# Research: Skills Panel Feature

**Date**: 2026-02-17T12:38:51Z
**Researcher**: Claude Sonnet 4.5
**Git Commit**: a57979893599b9b9ea16e91ac3cdd4c9c4a7c36f
**Branch**: main
**Repository**: [tandem](https://github.com/frumu-ai/tandem)

## Summary

SkillsPanel is a full-screen panel within the Extensions view that lets users browse a catalog of 78+ bundled skill templates, search/filter them, install them to either a project-local or global location, and manage installed skills. The entire skill lifecycle (listing, parsing, writing, deleting) is handled by the Rust backend using `std::fs` — the OpenCode sidecar is not involved in any skill CRUD operation.

Skills are stored as `SKILL.md` files in subdirectories. Project skills live at `<workspace>/.opencode/skill/<name>/SKILL.md`; global skills at `~/.config/opencode/skills/<name>/SKILL.md`. The sidecar discovers them by reading those same paths at prompt-processing time.

---

## Component Hierarchy

```
App.tsx (effectiveView === "extensions")
  └─ Extensions.tsx (activeTab === "skills")
       └─ SkillsTab.tsx  [owns: skills[], loading state, fetch lifecycle]
            └─ SkillsPanel.tsx  [receives: skills[], onRefresh, projectPath, onRestartSidecar]
                 └─ SkillCard.tsx  [per-skill: SkillInfo, onDelete callback]
```

### Mounting Chain

1. `App.tsx:1307-1322` renders `<Extensions>` when `effectiveView === "extensions"`, passing `workspacePath` derived from `activeProject?.path || state?.workspace_path || null`.
2. `Extensions.tsx:115-116` renders `<SkillsTab>` when `activeTab === "skills"` (the default tab).
3. `SkillsTab.tsx:49-64` renders `<SkillsPanel>` with four props:
   - `skills` — the fetched `SkillInfo[]` array
   - `projectPath` — `workspacePath ?? undefined`
   - `onRefresh` — async function that re-calls `listSkills()` and updates state
   - `onRestartSidecar` — stops sidecar, waits 500ms, restarts, waits 1000ms

---

## Detailed Findings

### 1. Prebuilt Catalog (Skill Templates)

#### Where templates are stored

Templates are bundled as Tauri resources at `src-tauri/resources/skill-templates/`. Each template is a subdirectory (directory name = template ID) containing at minimum a `SKILL.md`. Some templates include auxiliary files (fonts, reference docs, JS templates).

Bundling is configured in `src-tauri/tauri.conf.json:51`:
```json
"resources": ["resources/skill-templates/**/*"]
```

There are 78+ templates spanning domains: marketing, data analysis, finance, legal, product management, sales, support, biology, design, creative, and productivity.

#### How the catalog loads

1. `SkillsPanel.tsx:104-116` — On mount, a `useEffect` calls `listSkillTemplates()`.
2. `src/lib/tauri.ts:1164-1166` — `listSkillTemplates()` invokes `"skills_list_templates"` Tauri command.
3. `src-tauri/src/commands.rs:4942-4947` — `skills_list_templates()` delegates to `skill_templates::list_skill_templates()`.
4. `src-tauri/src/skill_templates.rs:14-53` — `resolve_templates_dir()` resolves the path:
   - **Debug**: `CARGO_MANIFEST_DIR/resources/skill-templates` (avoids stale copies in `target/`).
   - **Release**: `app.path().resource_dir()/resources/skill-templates` or `resource_dir/skill-templates`.
5. `src-tauri/src/skill_templates.rs:67-108` — `list_skill_templates()` reads the directory, parses each `SKILL.md`'s frontmatter via `skills::parse_skill_frontmatter()`, and returns `Vec<SkillTemplateInfo>` sorted alphabetically by name.

#### SkillTemplateInfo shape

```typescript
// src/lib/tauri.ts:1157-1162
interface SkillTemplateInfo {
  id: string;           // directory name
  name: string;         // from frontmatter
  description: string;  // from frontmatter
  requires?: string[];  // runtime dependencies (python, node, bash)
}
```

```rust
// src-tauri/src/skill_templates.rs:6-12
pub struct SkillTemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires: Vec<String>,
}
```

#### Template card rendering

`SkillsPanel.tsx:406-442` renders templates in a 2-column grid. Each card shows:
- Template name (bold) and description (muted text)
- An "Install" button
- Runtime dependency pills (Python/Node/Bash) in the bottom-right corner, color-coded:
  - Python → yellow
  - Node → emerald
  - Bash → sky blue

---

### 2. Search and Filtering

#### Search input
`SkillsPanel.tsx:355-361` — A text `<Input>` bound to `query` state with placeholder "Search skills (youtube, writing, data...)".

#### Filtering logic

**Templates** (`SkillsPanel.tsx:232-256`):
```typescript
const filteredTemplates = useMemo(() => {
  const filtered = templates.filter((t) => {
    if (!queryLower) return true;
    const hay = `${t.name} ${t.description}`.toLowerCase();
    return hay.includes(queryLower);
  });
  // Marketing-intent ranking (see below)
  ...
}, [templates, queryLower, ...]);
```
Matching is a case-insensitive substring search against `name + " " + description`.

**Installed skills** (`SkillsPanel.tsx:258-264`):
Same approach — case-insensitive substring match against name and description.

#### Marketing template ranking

When the query matches a marketing-related regex (`/(marketing|seo|social|linkedin|twitter|x |email|drip|copy|launch|competitor|alternative|content)/`), or when there's no query at all, templates are sorted by a priority rank:
- **Rank 0 (canonical)**: `product-marketing-context`, `content-strategy`, `seo-audit`, `social-content`, `copywriting`, `copy-editing`, `email-sequence`, `competitor-alternatives`, `launch-strategy`
- **Rank 1 (everything else)**
- **Rank 2 (legacy)**: `marketing-content-creation`, `marketing-campaign-planning`, `marketing-brand-voice`, `marketing-competitive-analysis`, `marketing-research-posting-plan`

Within the same rank, templates are sorted alphabetically by name.

---

### 3. Installing a Skill

#### Frontend flow

1. User clicks "Install" on a template card.
2. `SkillsPanel.tsx:152-166` — `handleInstallTemplate(templateId)`:
   - Sets `installingTemplateId` to the template ID (disables all Install buttons during install).
   - Calls `installSkillTemplate(templateId, location)`.
   - On success, calls `onRefresh()` to re-fetch the installed skills list.
   - Calls `onRestartSidecar()` to restart the AI engine so it picks up the new skill.

#### IPC layer

```typescript
// src/lib/tauri.ts:1168-1173
export async function installSkillTemplate(templateId: string, location: SkillLocation): Promise<SkillInfo> {
  return invoke<SkillInfo>("skills_install_template", { templateId, location });
}
```

#### Rust backend

`commands.rs:4949-5004` — `skills_install_template`:

1. Calls `get_skill_template_dir(&app, &template_id)` to verify the bundled template exists.
2. Reads `SKILL.md` and parses it with `parse_skill_content_with_metadata()`.
3. Constructs the target path based on `location`:
   - **Project**: `<workspace>/.opencode/skill/<name>/`
   - **Global**: `<config_dir>/opencode/skills/<name>/`
4. **If the target directory already exists, it is deleted** with `fs::remove_dir_all()` (line 4980). This is the overwrite behavior.
5. Copies the entire template directory recursively via `copy_dir_recursive()` (line 4982), which uses `fs::read_dir` + `fs::copy` recursion. This copies `SKILL.md` plus any auxiliary files.
6. Returns `SkillInfo` with all parsed metadata.

#### copy_dir_recursive

`commands.rs:4539-4557` — A manual recursive copy that:
- Creates the destination directory
- For each entry: if it's a directory, recurses; if it's a file, calls `fs::copy()`

#### Location selection

`SkillsPanel.tsx:280-319` — Two radio buttons ("Save to:"):
- **Active Folder** (project scope): disabled if no `projectPath` is available. Shows the project name in primary color with path hint `.opencode/skill/`.
- **Global**: always available. Shows `~/.config/opencode/skills/`.

Default is `"project"` if `projectPath` exists, otherwise `"global"` (`SkillsPanel.tsx:79`).

---

### 4. Additional Skill Operations

#### Paste SKILL.md (Advanced)

`SkillsPanel.tsx:446-476` — A collapsible "Advanced: paste SKILL.md" section with:
- A textarea for raw SKILL.md content
- "Create Blank" button that pre-fills a template
- "Save" button that calls `importSkill(content, location)` → Tauri `import_skill` command

The `import_skill` backend command (`commands.rs:4899-4905`, delegating to `commands.rs:4491-4537`):
1. Parses the content
2. Creates `<location>/<name>/SKILL.md`
3. Writes the raw content string (not reconstructed)

#### Import from file/zip

`SkillsPanel.tsx:478-536` — A "Preview before apply" import section with:
- File picker (Browse button) using `@tauri-apps/plugin-dialog`
- Optional namespace prefix
- Conflict policy selector (skip/overwrite/rename)
- "Preview import" → calls `skillsImportPreview()` for a dry run
- "Apply import" → calls `skillsImport()` for the actual write

The Rust backend (`commands.rs:4725-4880`) handles ZIP files, single files, and inline strings. For ZIPs, it iterates entries and finds all `SKILL.md` files. Conflict resolution uses `resolve_conflict_name()` which appends `-2`, `-3`, ... up to `-10000`, then UUID.

#### Delete skill

`SkillCard.tsx:15-26` — Two-step confirm flow:
1. User clicks trash icon → shows "Confirm" / "Cancel"
2. User clicks "Confirm" → calls `deleteSkill(skill.name, skill.location)` → `fs::remove_dir_all(<skill_dir>)`
3. Calls `onDelete` (which is `onRefresh`) to re-fetch the list

---

### 5. Installed Skills Display

`SkillsPanel.tsx:539-582` — The installed section renders:
- A header with count (e.g., "Installed skills (12)")
- Skills split into two subsections: "Folder Skills" (project) and "Global Skills"
- Each rendered as `<SkillCard key={skill.path} skill={skill} onDelete={onRefresh} />`

`SkillCard.tsx` shows for each skill:
- Name (bold), description (muted)
- Parse error banner if `parse_error` exists
- Badges: version, author, up to 3 requires, up to 2 tags
- Location and file path in monospace
- Trash icon with two-step confirm delete

---

### 6. Bundled Skills Auto-Sync (Distinct from Templates)

There are two distinct resource directories:

| Directory | Purpose | Delivery |
|-----------|---------|----------|
| `resources/skills/` | Auto-synced on every app launch | `sync_bundled_skills()` in `skills.rs:385-501` |
| `resources/skill-templates/` | User-installable catalog | Only installed on explicit user action |

`sync_bundled_skills()` runs at startup (`lib.rs:338-348`), compares content, and only overwrites if the source differs from the destination. Currently, only the `plan` skill is bundled this way.

---

## IPC Command Reference

| TypeScript function | Tauri command | Rust handler |
|---|---|---|
| `listSkills()` | `"list_skills"` | `commands.rs:4883` |
| `importSkill(content, location)` | `"import_skill"` | `commands.rs:4899` |
| `skillsImportPreview(...)` | `"skills_import_preview"` | `commands.rs:4725` |
| `skillsImport(...)` | `"skills_import"` | `commands.rs:4812` |
| `deleteSkill(name, location)` | `"delete_skill"` | `commands.rs:4909` |
| `listSkillTemplates()` | `"skills_list_templates"` | `commands.rs:4942` |
| `installSkillTemplate(templateId, location)` | `"skills_install_template"` | `commands.rs:4949` |

All commands are registered in `lib.rs:493-501` via `tauri::generate_handler![]`.

---

## Type Definitions

### SkillInfo
```typescript
// src/lib/tauri.ts:1078-1090
interface SkillInfo {
  name: string;
  description: string;
  location: "project" | "global";
  path: string;
  version?: string;
  author?: string;
  tags: string[];
  requires: string[];
  compatibility?: string;
  triggers: string[];
  parse_error?: string;
}
```

### SkillLocation
```typescript
// src/lib/tauri.ts:1092
type SkillLocation = "project" | "global";
```

### SkillsConflictPolicy
```typescript
// src/lib/tauri.ts:1102
type SkillsConflictPolicy = "skip" | "overwrite" | "rename";
```

---

## Filesystem Paths

| Scope | Path pattern |
|-------|-------------|
| Project skill | `<workspace>/.opencode/skill/<skill-name>/SKILL.md` |
| Global skill | `~/.config/opencode/skills/<skill-name>/SKILL.md` |
| Bundled templates | `src-tauri/resources/skill-templates/<template-id>/SKILL.md` |
| Bundled auto-sync skills | `src-tauri/resources/skills/<skill-name>/SKILL.md` |

---

## SKILL.md Format

Each skill file uses YAML frontmatter:
```yaml
---
name: my-skill           # required, kebab-case, 1-64 chars, [a-z0-9-]
description: What it does # required
version: "1.0.0"         # optional
author: tandem            # optional
tags: [tag1, tag2]        # optional
requires: [python]        # optional, runtime hints
license: MIT              # optional
compatibility: opencode   # optional
triggers: [...]           # optional
metadata: {}              # optional freeform map
---

Markdown body with instructions for the AI agent...
```

Name validation enforces: lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens, 1-64 chars (`skills.rs:72-101`).

---

## Code References

- `src/components/skills/SkillsPanel.tsx` — Main panel component (626 lines)
- `src/components/skills/SkillCard.tsx` — Individual skill card with delete (105 lines)
- `src/components/skills/index.ts` — Barrel re-export
- `src/components/extensions/SkillsTab.tsx` — Data fetching wrapper (124 lines)
- `src/components/extensions/Extensions.tsx` — Tab container
- `src/App.tsx:1307-1322` — Extensions view mounting
- `src/lib/tauri.ts:1074-1173` — All skill IPC wrappers and types
- `src-tauri/src/commands.rs:4491-5004` — All skill Tauri commands
- `src-tauri/src/skills.rs` — Skill parsing, validation, discovery, sync
- `src-tauri/src/skill_templates.rs` — Template directory resolution and listing
- `src-tauri/src/lib.rs:493-501` — Command registration
- `src-tauri/src/lib.rs:338-348` — Startup bundled skill sync
- `src-tauri/tauri.conf.json:51` — Resource bundling config
- `src-tauri/resources/skill-templates/` — 78+ bundled template directories

## Open Questions

- The `list_skills` command is registered twice in `lib.rs:493-495` (appears to be a duplicate registration, but compiles without error).
