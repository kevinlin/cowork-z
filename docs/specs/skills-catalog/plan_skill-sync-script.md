# Skill Sync Script Plan

## Context

The local skill templates at `src-tauri/resources/skill-templates/` were originally sourced from [`anthropics/knowledge-work-plugins`](https://github.com/anthropics/knowledge-work-plugins) but have drifted. A sync script is needed to pull latest upstream content for skills that exist locally, overwriting them in place. Skills that are cowork-z originals (design, doc, etc.) are left untouched.

---

## Task 1: Create `scripts/sync-skills.mjs`

**Files:** Create `scripts/sync-skills.mjs`

Node.js ESM script (matching `build-sidecar.mjs` conventions — Node builtins only, `#!/usr/bin/env node`).

### Algorithm

```
1. Fetch full repo tree via GitHub API (1 request):
   GET /repos/anthropics/knowledge-work-plugins/git/trees/main?recursive=1

2. Build upstream index from tree:
   { "data/skills/sql-queries/SKILL.md": true,
     "data/commands/analyze.md": true, ... }

3. List local skill folders from src-tauri/resources/skill-templates/

4. For each local folder:
   a. Extract category prefix (known list)
   b. Map prefix → upstream category directory
   c. Try to match (in order, first hit wins):
      i.   Skill: {upstream-cat}/skills/{remaining-name}/
      ii.  Command: {upstream-cat}/commands/{remaining-name}.md
      iii. Skill with full name: {upstream-cat}/skills/{full-local-name}/
      iv.  Full-name search across ALL categories (for standalone names)
   d. If matched:
      - Skill → download ALL files in upstream directory recursively
      - Command → download the .md file, save as SKILL.md
   e. If not matched → add to missing list

5. Print summary:
   ✅ Synced (count + list)
   ❌ Missing (count + list with expected upstream URL guesses)
```

### Category Mapping

| Local Prefix | Upstream Directory | Notes |
|---|---|---|
| `data` | `data` | |
| `sales` | `sales` | |
| `marketing` | `marketing` | |
| `product` | `product-management` | |
| `finance` | `finance` | |
| `legal` | `legal` | |
| `support` | `customer-support` | |
| `enterprise` | `enterprise-search` | |
| `productivity` | `productivity` | |
| `design` | _(skip)_ | Cowork-z originals |
| `doc` | _(skip)_ | Nutrient SDK skills |
| `development` | _(skip)_ | Cowork-z original |

### Matching Priority: Skills > Commands

Skills are directories with richer content. When a name matches both (e.g., `finance-reconciliation` has both a command and a skill upstream), prefer the skill.

### Download Approach

- Use `https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/{path}` for file downloads (no rate limit)
- For skill directories: collect all file paths from the tree, download each, write preserving directory structure
- For commands: download single `.md`, write as `SKILL.md` in local directory

### CLI Interface

```
Usage: node scripts/sync-skills.mjs [--dry-run]

Options:
  --dry-run   Preview what would sync without writing files

Environment:
  GITHUB_TOKEN   Optional — raises API rate limit from 60 to 5000 req/hr
```

### Key Implementation Details

- Use `node:fs/promises`, `node:path`, and global `fetch` (Node 18+)
- `import.meta.dirname` for resolving paths relative to script (matches `build-sidecar.mjs`)
- Skip `.DS_Store` and `.claude-plugin/` paths from upstream tree
- Use sequential downloads (not parallel) to avoid overwhelming GitHub
- Print progress per-skill with emoji indicators: `✅ synced`, `⏭️ skipped (no upstream)`, `❌ download error`

### Existing Files to Reuse

- Script conventions from [build-sidecar.mjs](scripts/build-sidecar.mjs) — shebang, `import.meta.dirname`, builtins-only pattern
- `resolve` from `node:path` for cross-platform paths

---

## Task 2: Add implementation note to skills-catalog/plan.md

**File:** Modify `docs/specs/skills-catalog/plan.md`

Append a new entry to the `## Implementation Log` section:

```markdown
### 2026-02-19 — Upstream skill sync script

Added `scripts/sync-skills.mjs` to synchronize local skill templates from the upstream
`anthropics/knowledge-work-plugins` repository. The script fetches the GitHub repo tree,
maps local skill folder names to upstream paths (commands or skills), downloads matched
content, and reports unmatched local skills.

**Files created:**
- `scripts/sync-skills.mjs` — Node.js ESM script with `--dry-run` support; uses GitHub
  tree API + raw.githubusercontent.com downloads; category prefix mapping for 9 upstream
  categories
```

---

## Task 3: Add entry to UPDATE_LOG.md

**File:** Modify `UPDATE_LOG.md`

Add to the `## v0.5.4` section:

```markdown
- **Skill sync script** — `scripts/sync-skills.mjs` synchronizes local skill templates from the upstream `anthropics/knowledge-work-plugins` repo; maps category prefixes to upstream paths, downloads matched skills/commands, and reports missing resources
```

---

## Verification

1. `node scripts/sync-skills.mjs --dry-run` — should list all local skills with match/skip status, no files written
2. `node scripts/sync-skills.mjs` — should sync matched skills, print summary
3. `git diff --stat src-tauri/resources/skill-templates/` — verify files were overwritten
4. `pnpm typecheck` — no regressions (script is standalone, but sanity check)
