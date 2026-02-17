# Skills Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a browsable Skills Catalog section to the Home screen that lets users install bundled OpenCode skill templates into `~/.config/opencode/skills/`, with checksum-based re-install detection.

**Architecture:** New Rust module `skills.rs` reads 77 skill directories from `resources/skill-templates/`, parses `SKILL.md` frontmatter, derives categories from folder-name prefixes, and tracks install state via `.coworkz-checksum` files. The frontend renders a new `SkillsCatalog` component below Starter Packs, with category tabs, search, and install/re-install buttons.

**Tech Stack:** Rust (sha2 crate for SHA256), Tauri 2 commands, React 19, TypeScript, Zustand (no new state — local component state only), Vitest + Testing Library.

**Design doc:** `docs/specs/app-ux/design_skills-catalog.md`

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

```rust
// src-tauri/src/commands/skills.rs
//! Skills Catalog — list bundled skill templates and install to OpenCode global skills dir.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillStatus {
    pub installed: bool,
    pub needs_update: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillWithStatus {
    pub meta: SkillMeta,
    pub status: SkillStatus,
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/// Derive display category from folder-name prefix.
pub fn derive_category(id: &str) -> &'static str {
    if id.starts_with("marketing-") { return "Marketing"; }
    if id.starts_with("sales-") { return "Sales"; }
    if id.starts_with("finance-") { return "Finance"; }
    if id.starts_with("enterprise-") { return "Enterprise"; }
    if id.starts_with("legal-") { return "Legal"; }
    if id.starts_with("product-") { return "Product"; }
    if id.starts_with("support-") { return "Support"; }
    if id.starts_with("data-") { return "Data"; }
    if id.starts_with("productivity-") { return "Productivity"; }
    "General"
}

/// Parse `name` and `description` from SKILL.md YAML frontmatter.
/// Returns `None` if the file can't be read or has no valid frontmatter.
pub fn parse_frontmatter(skill_dir: &Path) -> Option<(String, String)> {
    let content = fs::read_to_string(skill_dir.join("SKILL.md")).ok()?;
    let mut in_front = false;
    let mut name = String::new();
    let mut description = String::new();

    for line in content.lines() {
        if line == "---" {
            if !in_front {
                in_front = true;
                continue;
            } else {
                break; // end of frontmatter
            }
        }
        if !in_front { continue; }
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().to_string();
        }
    }

    if name.is_empty() { return None; }
    Some((name, description))
}

/// Compute SHA256 over all files in `dir` (sorted by relative path).
/// Returns hex digest string.
pub fn compute_dir_checksum(dir: &Path) -> Result<String, String> {
    let mut paths: Vec<PathBuf> = vec![];
    collect_files(dir, dir, &mut paths)?;
    paths.sort();

    let mut hasher = Sha256::new();
    for path in &paths {
        let data = fs::read(path)
            .map_err(|e| format!("Failed to read {:?}: {}", path, e))?;
        hasher.update(&data);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Recursively collect all non-hidden files under `root`, appending relative paths to `out`.
fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {:?}: {}", dir, e))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Skip checksum file and hidden files
        if name_str == ".coworkz-checksum" || name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out)?;
        } else {
            // Store relative path so sort order is stable
            let rel = path.strip_prefix(root)
                .map_err(|_| format!("strip_prefix failed: {:?}", path))?;
            out.push(rel.to_path_buf());
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_derive_category() {
        assert_eq!(derive_category("marketing-brand-voice"), "Marketing");
        assert_eq!(derive_category("sales-call-prep"), "Sales");
        assert_eq!(derive_category("finance-variance-analysis"), "Finance");
        assert_eq!(derive_category("enterprise-search-strategy"), "Enterprise");
        assert_eq!(derive_category("legal-contract-review"), "Legal");
        assert_eq!(derive_category("product-roadmap"), "Product");
        assert_eq!(derive_category("support-ticket-triage"), "Support");
        assert_eq!(derive_category("data-write-query"), "Data");
        assert_eq!(derive_category("productivity-tasks"), "Productivity");
        assert_eq!(derive_category("brainstorming"), "General");
        assert_eq!(derive_category("copywriting"), "General");
    }

    fn write_skill_md(dir: &Path, name: &str, desc: &str) {
        let content = format!("---\nname: {}\ndescription: {}\n---\n\n# Body\n", name, desc);
        fs::write(dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn test_parse_frontmatter_success() {
        let tmp = TempDir::new().unwrap();
        write_skill_md(tmp.path(), "my-skill", "Does something useful");
        let result = parse_frontmatter(tmp.path()).unwrap();
        assert_eq!(result.0, "my-skill");
        assert_eq!(result.1, "Does something useful");
    }

    #[test]
    fn test_parse_frontmatter_missing_file() {
        let tmp = TempDir::new().unwrap();
        assert!(parse_frontmatter(tmp.path()).is_none());
    }

    #[test]
    fn test_parse_frontmatter_no_name() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "---\ndescription: only desc\n---\n").unwrap();
        assert!(parse_frontmatter(tmp.path()).is_none());
    }

    #[test]
    fn test_compute_dir_checksum_stable() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content a").unwrap();
        let h1 = compute_dir_checksum(tmp.path()).unwrap();
        let h2 = compute_dir_checksum(tmp.path()).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_dir_checksum_changes_on_edit() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content a").unwrap();
        let h1 = compute_dir_checksum(tmp.path()).unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content b").unwrap();
        let h2 = compute_dir_checksum(tmp.path()).unwrap();
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_checksum_ignores_coworkz_checksum_file() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content").unwrap();
        let h1 = compute_dir_checksum(tmp.path()).unwrap();
        // Writing the checksum file itself must not change the hash
        fs::write(tmp.path().join(".coworkz-checksum"), &h1).unwrap();
        let h2 = compute_dir_checksum(tmp.path()).unwrap();
        assert_eq!(h1, h2);
    }
}
```

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

```rust
// ── Path resolution ──────────────────────────────────────────────────────────

/// `~/.config/opencode/skills` — the OpenCode global skills directory.
fn opencode_skills_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".config").join("opencode").join("skills"))
}

/// Resolve the `resources/skill-templates/` directory from the Tauri app handle.
fn resolve_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let candidates = vec![
        resource_dir.join("resources").join("skill-templates"),
        resource_dir.join("skill-templates"),
    ];

    candidates.into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "skill-templates directory not found in resources".to_string())
}

// ── Recursive copy ────────────────────────────────────────────────────────────

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err(format!("Source does not exist: {:?}", from));
    }
    fs::create_dir_all(to).map_err(|e| format!("create_dir_all {:?}: {}", to, e))?;
    for entry in fs::read_dir(from).map_err(|e| format!("read_dir {:?}: {}", from, e))?.flatten() {
        let file_type = entry.file_type()
            .map_err(|e| format!("file_type {:?}: {}", entry.path(), e))?;
        let dest = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest)
                .map_err(|e| format!("copy {:?} -> {:?}: {}", entry.path(), dest, e))?;
        }
    }
    Ok(())
}

// ── Core logic ────────────────────────────────────────────────────────────────

/// List all bundled skills with their install status.
pub fn list_skills_with_status(app: &AppHandle) -> Vec<SkillWithStatus> {
    let templates_dir = match resolve_templates_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[skills] Failed to resolve templates dir: {}", e);
            return vec![];
        }
    };
    let skills_dir = opencode_skills_dir().unwrap_or_default();

    let mut result = vec![];
    let entries = match fs::read_dir(&templates_dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[skills] Failed to read templates dir: {}", e);
            return vec![];
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') { continue; } // skip .DS_Store etc.

        let (name, description) = match parse_frontmatter(&path) {
            Some(pair) => pair,
            None => {
                eprintln!("[skills] Skipping '{}': failed to parse SKILL.md", id);
                continue;
            }
        };

        let category = derive_category(&id).to_string();
        let meta = SkillMeta { id: id.clone(), name, description, category };

        let install_dir = skills_dir.join(&id);
        let checksum_file = install_dir.join(".coworkz-checksum");

        let status = if !checksum_file.exists() {
            SkillStatus { installed: false, needs_update: false }
        } else {
            let installed_checksum = fs::read_to_string(&checksum_file).unwrap_or_default();
            let bundled_checksum = compute_dir_checksum(&path).unwrap_or_default();
            let up_to_date = installed_checksum.trim() == bundled_checksum.trim();
            SkillStatus { installed: true, needs_update: !up_to_date }
        };

        result.push(SkillWithStatus { meta, status });
    }

    // Sort by category then name for stable UI ordering
    result.sort_by(|a, b| {
        a.meta.category.cmp(&b.meta.category)
            .then(a.meta.name.cmp(&b.meta.name))
    });
    result
}

/// Install (or re-install) a skill by copying its template to the OpenCode skills dir.
pub fn install_skill(app: &AppHandle, skill_id: &str) -> Result<(), String> {
    let templates_dir = resolve_templates_dir(app)?;
    let source = templates_dir.join(skill_id);
    if !source.exists() {
        return Err(format!("Skill template not found: {}", skill_id));
    }

    let dest_root = opencode_skills_dir()?;
    let dest = dest_root.join(skill_id);

    println!("[skills] Installing '{}' -> {:?}", skill_id, dest);
    copy_dir_recursive(&source, &dest)?;

    // Write checksum of bundled source (not dest) so future checks compare correctly
    let checksum = compute_dir_checksum(&source)?;
    fs::write(dest.join(".coworkz-checksum"), &checksum)
        .map_err(|e| format!("Failed to write checksum: {}", e))?;

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn skills_list_with_status(app: AppHandle) -> Vec<SkillWithStatus> {
    list_skills_with_status(&app)
}

#[tauri::command]
pub fn skills_install(app: AppHandle, skill_id: String) -> Result<(), String> {
    install_skill(&app, &skill_id)
}
```

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

```ts
// ============================================================================
// Skills
// ============================================================================

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

export async function listSkillsWithStatus(): Promise<SkillWithStatus[]> {
  return invoke<SkillWithStatus[]>('skills_list_with_status');
}

export async function installSkill(skillId: string): Promise<void> {
  return invoke<void>('skills_install', { skillId });
}
```

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

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillWithStatus } from '@/lib/tauri-api';

// Mock tauri-api-interface at module level
const mockListSkillsWithStatus = vi.fn();
const mockInstallSkill = vi.fn();

vi.mock('@/lib/tauri-api-interface', () => ({
  getTauriAPI: vi.fn(() => ({
    listSkillsWithStatus: mockListSkillsWithStatus,
    installSkill: mockInstallSkill,
  })),
}));

import SkillsCatalog from '../SkillsCatalog';

const makeSkill = (
  id: string,
  category: string,
  installed = false,
  needs_update = false,
): SkillWithStatus => ({
  meta: { id, name: id, description: `desc for ${id}`, category },
  status: { installed, needs_update },
});

describe('SkillsCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallSkill.mockResolvedValue(undefined);
  });

  it('shows loading state initially', () => {
    mockListSkillsWithStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SkillsCatalog />);
    expect(screen.getByText(/loading skills/i)).toBeInTheDocument();
  });

  it('renders skill cards after loading', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('competitor-alternatives', 'General'),
      makeSkill('marketing-brand-voice', 'Marketing'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText('competitor-alternatives')).toBeInTheDocument();
      expect(screen.getByText('marketing-brand-voice')).toBeInTheDocument();
    });
  });

  it('shows "Failed to load skills" on error', async () => {
    mockListSkillsWithStatus.mockRejectedValue(new Error('network error'));
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load skills/i)).toBeInTheDocument();
    });
  });

  it('filters by category tab', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('competitor-alternatives', 'General'),
      makeSkill('marketing-brand-voice', 'Marketing'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByText('Marketing'));

    await userEvent.click(screen.getByRole('button', { name: 'Marketing' }));
    expect(screen.getByText('marketing-brand-voice')).toBeInTheDocument();
    expect(screen.queryByText('competitor-alternatives')).not.toBeInTheDocument();
  });

  it('filters by search query', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('competitor-alternatives', 'General'),
      makeSkill('copywriting', 'General'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByText('competitor-alternatives'));

    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'copy');
    expect(screen.getByText('copywriting')).toBeInTheDocument();
    expect(screen.queryByText('competitor-alternatives')).not.toBeInTheDocument();
  });

  it('calls installSkill when Install button clicked', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('brainstorming', 'General'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByText('brainstorming'));

    await userEvent.click(screen.getByRole('button', { name: /^install$/i }));
    expect(mockInstallSkill).toHaveBeenCalledWith('brainstorming');
  });

  it('shows Installed badge for installed up-to-date skill', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('brainstorming', 'General', true, false),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/installed/i)).toBeInTheDocument();
    });
  });

  it('shows Re-install button for outdated skill', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('brainstorming', 'General', true, true),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /re-install/i })).toBeInTheDocument();
    });
  });
});
```

### Step 2: Run tests to verify they fail

```bash
pnpm test src/components/landing/__tests__/SkillsCatalog.test.tsx --run 2>&1 | tail -15
```

Expected: FAIL — `SkillsCatalog` module not found.

### Step 3: Implement `SkillsCatalog.tsx`

Create `src/components/landing/SkillsCatalog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { SkillWithStatus } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';

export default function SkillsCatalog() {
  const [skills, setSkills] = useState<SkillWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const api = getTauriAPI();

  useEffect(() => {
    api
      .listSkillsWithStatus()
      .then(setSkills)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [api]);

  const categories = ['All', ...Array.from(new Set(skills.map((s) => s.meta.category))).sort()];

  const filtered = skills.filter((s) => {
    const matchCategory = activeCategory === 'All' || s.meta.category === activeCategory;
    const q = query.toLowerCase();
    const matchQuery =
      !q ||
      s.meta.name.toLowerCase().includes(q) ||
      s.meta.description.toLowerCase().includes(q) ||
      s.meta.category.toLowerCase().includes(q);
    return matchCategory && matchQuery;
  });

  const handleInstall = async (skillId: string) => {
    setInstallingId(skillId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[skillId];
      return next;
    });
    try {
      await api.installSkill(skillId);
      // Refresh status for this skill
      const updated = await api.listSkillsWithStatus();
      setSkills(updated);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [skillId]: String(e) }));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div className="border-border border-t">
      {/* Header row */}
      <div className="flex items-center justify-between px-6 py-3">
        <div>
          <span className="font-medium text-foreground text-sm">Skills Catalog</span>
          <p className="text-muted-foreground text-xs">Install reusable AI skill templates globally.</p>
        </div>
        <input
          className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          type="search"
          value={query}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto px-6 pb-2">
        {categories.map((cat) => (
          <button
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            key={cat}
            onClick={() => setActiveCategory(cat)}
            type="button"
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Skill grid */}
      <div className="max-h-[400px] overflow-y-auto px-6 pb-4">
        {loading ? (
          <p className="py-4 text-center text-muted-foreground text-sm">Loading skills…</p>
        ) : loadError ? (
          <p className="py-4 text-center text-muted-foreground text-sm">Failed to load skills.</p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            {query ? 'No skills match your search.' : 'No skills available.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((s) => (
              <div
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                key={s.meta.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm leading-snug">{s.meta.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{s.meta.description}</div>
                  </div>
                  <SkillButton
                    installing={installingId === s.meta.id}
                    onInstall={() => handleInstall(s.meta.id)}
                    status={s.status}
                  />
                </div>
                {errors[s.meta.id] && (
                  <p className="text-destructive text-xs">{errors[s.meta.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SkillButtonProps {
  status: SkillWithStatus['status'];
  installing: boolean;
  onInstall: () => void;
}

function SkillButton({ status, installing, onInstall }: SkillButtonProps) {
  if (installing) {
    return (
      <button
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs opacity-50 cursor-not-allowed"
        disabled
        type="button"
      >
        Installing…
      </button>
    );
  }

  if (!status.installed) {
    return (
      <button
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
        onClick={onInstall}
        type="button"
      >
        Install
      </button>
    );
  }

  if (status.needs_update) {
    return (
      <button
        className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-amber-600"
        onClick={onInstall}
        type="button"
      >
        Re-install
      </button>
    );
  }

  // Installed and up-to-date
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">Installed ✓</span>
      <button
        className="text-muted-foreground text-xs underline hover:text-foreground"
        onClick={onInstall}
        type="button"
      >
        Re-install
      </button>
    </div>
  );
}
```

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
