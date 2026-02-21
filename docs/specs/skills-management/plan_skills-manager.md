# Skills Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated Skills Manager window that lets users register Git repos as skill sources, browse/install/update/delete skills, and manage installed skills across three global skill directories.

**Architecture:** Separate Tauri window (`/#/skills`) with its own three-panel layout (file tree, skills grid, file preview). Backend uses `std::process::Command` to shell out to `git` for clone/pull operations. Two new DB tables (`skill_repos`, `repo_skills`) store repo metadata and discovered skills. Cross-window sync via `skills:changed` Tauri events.

**Tech Stack:** Tauri 2.x (Rust backend), React 19, TypeScript, Zustand, Radix UI / shadcn/ui, Tailwind CSS, `std::process::Command` for Git, SQLite (rusqlite), OS Keychain (keyring crate)

**Design:** [design_skills-manager.md](design_skills-manager.md)
**Requirements:** [requirements.md section 8.3](../cowork-z/requirements.md)

---

## Phase 1: Backend Foundation

### Task 1: Database Migration v3 — `skill_repos` and `repo_skills` Tables

**Files:**
- Modify: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/db/skill_repos.rs`
- Modify: `src-tauri/src/db/mod.rs`

**Step 1: Add the `skill_repos` module**

Create `src-tauri/src/db/skill_repos.rs` with the `StoredSkillRepo` struct and CRUD functions following the `workspaces.rs` pattern:

```rust
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSkillRepo {
    pub id: String,
    pub url: String,
    pub name: String,
    pub branch: String,
    pub auth_token_key: Option<String>,
    pub last_synced_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRepoSkill {
    pub repo_id: String,
    pub skill_path: String,
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
}

pub fn save_skill_repo(conn: &Connection, repo: &StoredSkillRepo) -> Result<(), String> {
    conn.execute(
        "INSERT INTO skill_repos (id, url, name, branch, auth_token_key, last_synced_at, last_sync_error, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           name = excluded.name,
           branch = excluded.branch,
           auth_token_key = excluded.auth_token_key,
           last_synced_at = excluded.last_synced_at,
           last_sync_error = excluded.last_sync_error",
        params![repo.id, repo.url, repo.name, repo.branch, repo.auth_token_key, repo.last_synced_at, repo.last_sync_error, repo.created_at],
    )
    .map_err(|e| format!("Failed to save skill repo: {}", e))?;
    Ok(())
}

pub fn list_skill_repos(conn: &Connection) -> Vec<StoredSkillRepo> {
    let mut stmt = conn
        .prepare("SELECT id, url, name, branch, auth_token_key, last_synced_at, last_sync_error, created_at FROM skill_repos ORDER BY name ASC")
        .unwrap();
    stmt.query_map([], |row| {
        Ok(StoredSkillRepo {
            id: row.get(0)?,
            url: row.get(1)?,
            name: row.get(2)?,
            branch: row.get(3)?,
            auth_token_key: row.get(4)?,
            last_synced_at: row.get(5)?,
            last_sync_error: row.get(6)?,
            created_at: row.get(7)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

pub fn get_skill_repo(conn: &Connection, id: &str) -> Option<StoredSkillRepo> {
    conn.query_row(
        "SELECT id, url, name, branch, auth_token_key, last_synced_at, last_sync_error, created_at FROM skill_repos WHERE id = ?1",
        params![id],
        |row| Ok(StoredSkillRepo {
            id: row.get(0)?,
            url: row.get(1)?,
            name: row.get(2)?,
            branch: row.get(3)?,
            auth_token_key: row.get(4)?,
            last_synced_at: row.get(5)?,
            last_sync_error: row.get(6)?,
            created_at: row.get(7)?,
        }),
    )
    .ok()
}

pub fn remove_skill_repo(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM skill_repos WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to remove skill repo: {}", e))?;
    Ok(())
}

pub fn update_sync_status(
    conn: &Connection,
    id: &str,
    last_synced_at: Option<&str>,
    last_sync_error: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE skill_repos SET last_synced_at = ?1, last_sync_error = ?2 WHERE id = ?3",
        params![last_synced_at, last_sync_error, id],
    )
    .map_err(|e| format!("Failed to update sync status: {}", e))?;
    Ok(())
}

// --- repo_skills ---

pub fn save_repo_skills(conn: &Connection, repo_id: &str, skills: &[StoredRepoSkill]) -> Result<(), String> {
    // Clear existing skills for this repo, then insert fresh
    conn.execute("DELETE FROM repo_skills WHERE repo_id = ?1", params![repo_id])
        .map_err(|e| format!("Failed to clear repo skills: {}", e))?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO repo_skills (repo_id, skill_path, skill_id, name, description, category)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|e| format!("Failed to prepare insert: {}", e))?;

    for skill in skills {
        stmt.execute(params![
            skill.repo_id,
            skill.skill_path,
            skill.skill_id,
            skill.name,
            skill.description,
            skill.category,
        ])
        .map_err(|e| format!("Failed to insert repo skill: {}", e))?;
    }
    Ok(())
}

pub fn list_repo_skills(conn: &Connection, repo_id: Option<&str>) -> Vec<StoredRepoSkill> {
    let query = match repo_id {
        Some(_) => "SELECT repo_id, skill_path, skill_id, name, description, category FROM repo_skills WHERE repo_id = ?1 ORDER BY category, name",
        None => "SELECT repo_id, skill_path, skill_id, name, description, category FROM repo_skills ORDER BY category, name",
    };
    let mut stmt = conn.prepare(query).unwrap();
    let rows = match repo_id {
        Some(id) => stmt.query_map(params![id], |row| {
            Ok(StoredRepoSkill {
                repo_id: row.get(0)?,
                skill_path: row.get(1)?,
                skill_id: row.get(2)?,
                name: row.get(3)?,
                description: row.get(4)?,
                category: row.get(5)?,
            })
        }),
        None => stmt.query_map([], |row| {
            Ok(StoredRepoSkill {
                repo_id: row.get(0)?,
                skill_path: row.get(1)?,
                skill_id: row.get(2)?,
                name: row.get(3)?,
                description: row.get(4)?,
                category: row.get(5)?,
            })
        }),
    };
    rows.unwrap().filter_map(|r| r.ok()).collect()
}
```

**Step 2: Register the module**

In `src-tauri/src/db/mod.rs`, add:

```rust
pub mod skill_repos;
```

**Step 3: Write migration v3**

In `src-tauri/src/db/migrations.rs`:

1. Change `CURRENT_VERSION` from `2` to `3`
2. Add the `migrate_v3` function:

```rust
fn migrate_v3(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_repos (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            auth_token_key TEXT,
            last_synced_at TEXT,
            last_sync_error TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS repo_skills (
            repo_id TEXT NOT NULL REFERENCES skill_repos(id) ON DELETE CASCADE,
            skill_path TEXT NOT NULL,
            skill_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'General',
            PRIMARY KEY (repo_id, skill_path)
        );

        CREATE INDEX IF NOT EXISTS idx_repo_skills_repo_id ON repo_skills(repo_id);",
    )
    .map_err(|e| format!("Migration v3 failed: {}", e))?;

    set_stored_version(conn, 3)?;
    Ok(())
}
```

3. Add to `run_migrations()`:

```rust
if stored_version < 3 {
    migrate_v3(conn)?;
}
```

**Step 4: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

**Step 5: Commit**

```bash
git add src-tauri/src/db/skill_repos.rs src-tauri/src/db/mod.rs src-tauri/src/db/migrations.rs
git commit -m "feat(db): add skill_repos and repo_skills tables (migration v3)"
```

---

### Task 2: Git Operations Module

**Files:**
- Create: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` (module registration)

**Step 1: Create `git_ops.rs`**

This module wraps `std::process::Command` calls to `git`. It does NOT depend on Tauri — pure Rust, easily testable.

```rust
use std::path::Path;
use std::process::Command;

/// Check if `git` is available on PATH.
pub fn is_git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Shallow clone a repo into `dest_dir`.
/// For token-based HTTPS auth, the token is injected into the URL.
pub fn clone_repo(
    url: &str,
    branch: &str,
    dest_dir: &Path,
    auth_token: Option<&str>,
) -> Result<(), String> {
    let effective_url = inject_token(url, auth_token);

    let output = Command::new("git")
        .args([
            "clone",
            "--depth", "1",
            "--branch", branch,
            &effective_url,
            &dest_dir.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", stderr.trim()));
    }
    Ok(())
}

/// Pull latest changes in an existing shallow clone.
pub fn pull_repo(repo_dir: &Path, auth_token: Option<&str>) -> Result<(), String> {
    // If there's a token, update the remote URL first
    if let Some(token) = auth_token {
        let current_url = get_remote_url(repo_dir)?;
        let new_url = inject_token(&current_url, Some(token));
        set_remote_url(repo_dir, &new_url)?;
    }

    let output = Command::new("git")
        .args(["-C", &repo_dir.to_string_lossy(), "pull", "--ff-only"])
        .output()
        .map_err(|e| format!("Failed to run git pull: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git pull failed: {}", stderr.trim()));
    }
    Ok(())
}

fn get_remote_url(repo_dir: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", &repo_dir.to_string_lossy(), "remote", "get-url", "origin"])
        .output()
        .map_err(|e| format!("Failed to get remote URL: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn set_remote_url(repo_dir: &Path, url: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["-C", &repo_dir.to_string_lossy(), "remote", "set-url", "origin", url])
        .output()
        .map_err(|e| format!("Failed to set remote URL: {}", e))?;
    if !output.status.success() {
        return Err("Failed to update remote URL".to_string());
    }
    Ok(())
}

/// Inject a personal access token into an HTTPS Git URL.
/// `https://github.com/owner/repo` → `https://{token}@github.com/owner/repo`
/// SSH URLs and None tokens are returned unchanged.
fn inject_token(url: &str, token: Option<&str>) -> String {
    match token {
        Some(t) if url.starts_with("https://") => {
            url.replacen("https://", &format!("https://{}@", t), 1)
        }
        _ => url.to_string(),
    }
}

/// Derive a display name from a Git URL.
/// `https://github.com/anthropics/knowledge-work-plugins.git` → `anthropics/knowledge-work-plugins`
pub fn derive_repo_name(url: &str) -> String {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    // Try to extract owner/repo from common patterns
    if let Some(rest) = trimmed.strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("https://gitlab.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .or_else(|| trimmed.strip_prefix("git@gitlab.com:"))
    {
        return rest.to_string();
    }
    // Fallback: last path segment
    trimmed.rsplit('/').next().unwrap_or(trimmed).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_token_https() {
        let url = "https://github.com/owner/repo.git";
        let result = inject_token(url, Some("my_token"));
        assert_eq!(result, "https://my_token@github.com/owner/repo.git");
    }

    #[test]
    fn test_inject_token_none() {
        let url = "https://github.com/owner/repo.git";
        assert_eq!(inject_token(url, None), url);
    }

    #[test]
    fn test_inject_token_ssh_unchanged() {
        let url = "git@github.com:owner/repo.git";
        assert_eq!(inject_token(url, Some("token")), url);
    }

    #[test]
    fn test_derive_repo_name_github() {
        assert_eq!(
            derive_repo_name("https://github.com/anthropics/knowledge-work-plugins.git"),
            "anthropics/knowledge-work-plugins"
        );
    }

    #[test]
    fn test_derive_repo_name_ssh() {
        assert_eq!(
            derive_repo_name("git@github.com:owner/repo.git"),
            "owner/repo"
        );
    }

    #[test]
    fn test_derive_repo_name_fallback() {
        assert_eq!(derive_repo_name("https://custom.host/myrepo"), "myrepo");
    }
}
```

**Step 2: Register the module**

In `src-tauri/src/lib.rs`, add near the other `mod` declarations:

```rust
mod git_ops;
```

**Step 3: Verify**

Run: `cd src-tauri && cargo test git_ops`
Expected: All 6 tests pass.

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src-tauri/src/git_ops.rs src-tauri/src/lib.rs
git commit -m "feat: add git_ops module for clone/pull/token-injection"
```

---

### Task 3: Skill Discovery Module

**Files:**
- Create: `src-tauri/src/skill_discovery.rs`
- Modify: `src-tauri/src/lib.rs` (module registration)

This module scans a cloned repo directory for `SKILL.md` files and produces `StoredRepoSkill` records. It implements convention-based scanning, optional manifest override, and the `anthropics/knowledge-work-plugins` adapter.

**Step 1: Create `skill_discovery.rs`**

```rust
use crate::commands::skills::parse_frontmatter;
use crate::db::skill_repos::StoredRepoSkill;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Manifest format for `skills.json` at repo root.
#[derive(Debug, serde::Deserialize)]
struct SkillManifest {
    skills: Vec<ManifestEntry>,
}

#[derive(Debug, serde::Deserialize)]
struct ManifestEntry {
    path: String,
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
}

/// Discover all skills in a cloned repo directory.
/// Returns a list of `StoredRepoSkill` ready for DB insertion.
pub fn discover_skills(repo_id: &str, repo_dir: &Path, repo_url: &str) -> Vec<StoredRepoSkill> {
    // Check for anthropics adapter first
    if is_anthropics_repo(repo_url) {
        return discover_anthropics_skills(repo_id, repo_dir);
    }

    // Check for manifest
    let manifest_path = repo_dir.join("skills.json");
    if manifest_path.exists() {
        if let Ok(skills) = discover_from_manifest(repo_id, repo_dir, &manifest_path) {
            return skills;
        }
        // Fall through to convention scan on manifest parse failure
    }

    // Convention-based scan
    discover_by_convention(repo_id, repo_dir)
}

/// Convention-based: recursively find directories containing SKILL.md.
fn discover_by_convention(repo_id: &str, repo_dir: &Path) -> Vec<StoredRepoSkill> {
    let mut results = Vec::new();
    find_skill_dirs(repo_dir, repo_dir, &mut results, repo_id);
    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    results
}

fn find_skill_dirs(
    root: &Path,
    dir: &Path,
    results: &mut Vec<StoredRepoSkill>,
    repo_id: &str,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories and .git
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                // This directory contains a SKILL.md — it's a skill
                let rel_path = path.strip_prefix(root).unwrap_or(&path);
                let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                // Derive skill_id from the directory name
                let skill_id = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Parse frontmatter for name/description
                let (parsed_name, parsed_desc) = parse_frontmatter(&path)
                    .map(|(n, d)| (n, d))
                    .unwrap_or_else(|| (skill_id.clone(), String::new()));

                let category = crate::commands::skills::derive_category(&skill_id);

                results.push(StoredRepoSkill {
                    repo_id: repo_id.to_string(),
                    skill_path: rel_str,
                    skill_id,
                    name: parsed_name,
                    description: parsed_desc,
                    category,
                });
            } else {
                // Recurse into subdirectories
                find_skill_dirs(root, &path, results, repo_id);
            }
        }
    }
}

/// Manifest-based discovery.
fn discover_from_manifest(
    repo_id: &str,
    repo_dir: &Path,
    manifest_path: &Path,
) -> Result<Vec<StoredRepoSkill>, String> {
    let content = fs::read_to_string(manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: SkillManifest = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let mut results = Vec::new();
    for entry in manifest.skills {
        let skill_dir = repo_dir.join(&entry.path);
        if !skill_dir.join("SKILL.md").exists() {
            continue; // Skip declared skills whose path doesn't exist
        }

        let skill_id = skill_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Manifest metadata overrides frontmatter
        let (fm_name, fm_desc) = parse_frontmatter(&skill_dir)
            .unwrap_or_else(|| (skill_id.clone(), String::new()));

        results.push(StoredRepoSkill {
            repo_id: repo_id.to_string(),
            skill_path: entry.path,
            skill_id,
            name: entry.name.unwrap_or(fm_name),
            description: entry.description.unwrap_or(fm_desc),
            category: entry
                .category
                .unwrap_or_else(|| "General".to_string()),
        });
    }

    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    Ok(results)
}

// --- anthropics/knowledge-work-plugins adapter ---

fn is_anthropics_repo(url: &str) -> bool {
    let normalized = url.to_lowercase();
    normalized.contains("github.com/anthropics/knowledge-work-plugins")
        || normalized.contains("github.com:anthropics/knowledge-work-plugins")
}

/// Category mapping consistent with scripts/sync-skills.mjs
const ANTHROPICS_CATEGORY_MAP: &[(&str, &str)] = &[
    ("customer-support", "support"),
    ("data", "data"),
    ("enterprise-search", "enterprise"),
    ("finance", "finance"),
    ("legal", "legal"),
    ("marketing", "marketing"),
    ("product-management", "product"),
    ("productivity", "productivity"),
    ("sales", "sales"),
];

fn discover_anthropics_skills(repo_id: &str, repo_dir: &Path) -> Vec<StoredRepoSkill> {
    let mut results = Vec::new();
    // Track which skill names we've seen to handle skills > commands priority
    let mut seen_names: HashMap<String, usize> = HashMap::new();

    for (upstream_dir, local_prefix) in ANTHROPICS_CATEGORY_MAP {
        let category_dir = repo_dir.join(upstream_dir);
        if !category_dir.is_dir() {
            continue;
        }

        // 1. Prefer skills directories (richer content)
        let skills_dir = category_dir.join("skills");
        if skills_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if dir_name.starts_with('.') {
                        continue;
                    }
                    let skill_md = path.join("SKILL.md");
                    if !skill_md.exists() {
                        continue;
                    }

                    let skill_id = format!("{}-{}", local_prefix, dir_name);
                    let rel_path = path.strip_prefix(repo_dir).unwrap_or(&path);
                    let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                    let (name, desc) = parse_frontmatter(&path)
                        .unwrap_or_else(|| (skill_id.clone(), String::new()));

                    let category = crate::commands::skills::derive_category(&skill_id);

                    let idx = results.len();
                    results.push(StoredRepoSkill {
                        repo_id: repo_id.to_string(),
                        skill_path: rel_str,
                        skill_id: skill_id.clone(),
                        name,
                        description: desc,
                        category,
                    });
                    seen_names.insert(dir_name.clone(), idx);
                }
            }
        }

        // 2. Commands (single .md files) — only if no skill with same name
        let commands_dir = category_dir.join("commands");
        if commands_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&commands_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if !file_name.ends_with(".md") || file_name.starts_with('.') {
                        continue;
                    }

                    let cmd_name = file_name.trim_end_matches(".md");
                    if seen_names.contains_key(cmd_name) {
                        continue; // Skill takes priority over command
                    }

                    let skill_id = format!("{}-{}", local_prefix, cmd_name);
                    let rel_path = path.strip_prefix(repo_dir).unwrap_or(&path);
                    let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                    // Commands are single .md files, parse as SKILL.md equivalent
                    let content = fs::read_to_string(&path).unwrap_or_default();
                    let (name, desc) = parse_command_frontmatter(&content)
                        .unwrap_or_else(|| (skill_id.clone(), String::new()));

                    let category = crate::commands::skills::derive_category(&skill_id);

                    results.push(StoredRepoSkill {
                        repo_id: repo_id.to_string(),
                        skill_path: rel_str,
                        skill_id,
                        name,
                        description: desc,
                        category,
                    });
                }
            }
        }
    }

    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    results
}

/// Parse frontmatter from a command .md file (same format as SKILL.md).
fn parse_command_frontmatter(content: &str) -> Option<(String, String)> {
    let mut name = String::new();
    let mut description = String::new();
    let mut in_front = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_front {
                break;
            }
            in_front = true;
            continue;
        }
        if in_front {
            if let Some(val) = trimmed.strip_prefix("name:") {
                name = val.trim().trim_matches('"').trim_matches('\'').to_string();
            } else if let Some(val) = trimmed.strip_prefix("description:") {
                description = val.trim().trim_matches('"').trim_matches('\'').to_string();
            }
        }
    }

    if name.is_empty() {
        None
    } else {
        Some((name, description))
    }
}
```

**Step 2: Make `parse_frontmatter` and `derive_category` public**

In `src-tauri/src/commands/skills.rs`, ensure these functions are `pub` (not `pub(crate)` or private):

```rust
pub fn derive_category(id: &str) -> String { ... }
pub fn parse_frontmatter(skill_dir: &std::path::Path) -> Option<(String, String)> { ... }
```

**Step 3: Register the module**

In `src-tauri/src/lib.rs`:

```rust
mod skill_discovery;
```

**Step 4: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 5: Commit**

```bash
git add src-tauri/src/skill_discovery.rs src-tauri/src/commands/skills.rs src-tauri/src/lib.rs
git commit -m "feat: add skill_discovery module with convention scan, manifest, and anthropics adapter"
```

---

### Task 4: Repo Management Tauri Commands

**Files:**
- Create: `src-tauri/src/commands/skill_repos.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (command registration)

**Step 1: Create `commands/skill_repos.rs`**

This module contains all Tauri commands for repo CRUD and sync. It orchestrates `git_ops`, `skill_discovery`, and `db::skill_repos`.

```rust
use crate::db::skill_repos::{
    self, StoredRepoSkill, StoredSkillRepo,
};
use crate::db::DbState;
use crate::git_ops;
use crate::skill_discovery;
use crate::commands::skills::{compute_dir_checksum, copy_dir_recursive};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRepo {
    pub id: String,
    pub url: String,
    pub name: String,
    pub branch: String,
    pub has_auth_token: bool,
    pub last_synced_at: Option<String>,
    pub last_sync_error: Option<String>,
    pub created_at: String,
    pub skill_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSkill {
    pub repo_id: String,
    pub repo_name: String,
    pub skill_path: String,
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub installed: bool,
    pub needs_update: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub source_repo_url: Option<String>,
    pub source_repo_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub repo_id: String,
    pub status: String, // "syncing" | "synced" | "error"
    pub error: Option<String>,
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("skill-repo-cache")
}

fn repo_cache_dir(app: &AppHandle, repo_id: &str) -> PathBuf {
    cache_dir(app).join(repo_id)
}

/// Resolve the target skills folder from a label.
fn resolve_target_folder(target: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    match target {
        "opencode" => Ok(home.join(".config/opencode/skills")),
        "claude" => Ok(home.join(".claude/skills")),
        "agents" => Ok(home.join(".agents/skills")),
        _ => Err(format!("Unknown target folder: {}", target)),
    }
}

// --- Commands ---

#[tauri::command]
pub fn skill_repos_list(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<Vec<SkillRepo>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let repos = skill_repos::list_skill_repos(&conn);
    let result = repos
        .into_iter()
        .map(|r| {
            let skill_count = skill_repos::list_repo_skills(&conn, Some(&r.id)).len();
            SkillRepo {
                id: r.id,
                url: r.url,
                name: r.name,
                branch: r.branch,
                has_auth_token: r.auth_token_key.is_some(),
                last_synced_at: r.last_synced_at,
                last_sync_error: r.last_sync_error,
                created_at: r.created_at,
                skill_count,
            }
        })
        .collect();
    Ok(result)
}

#[tauri::command]
pub async fn skill_repos_add(
    app: AppHandle,
    db: State<'_, DbState>,
    url: String,
    branch: Option<String>,
    auth_token: Option<String>,
) -> Result<SkillRepo, String> {
    // Check git is available
    if !git_ops::is_git_available() {
        return Err("Git is not installed or not found on PATH. Please install Git and try again.".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let branch = branch.unwrap_or_else(|| "main".to_string());
    let name = git_ops::derive_repo_name(&url);
    let now = chrono::Utc::now().to_rfc3339();

    // Store auth token in keychain if provided
    let auth_token_key = if let Some(ref token) = auth_token {
        let key = format!("skill-repo-{}", id);
        crate::secure_storage::store_api_key(&key, token)?;
        Some(key)
    } else {
        None
    };

    // Clone the repo
    let dest = repo_cache_dir(&app, &id);
    fs::create_dir_all(dest.parent().unwrap())
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    git_ops::clone_repo(&url, &branch, &dest, auth_token.as_deref())?;

    // Discover skills
    let discovered = skill_discovery::discover_skills(&id, &dest, &url);

    // Save to DB
    let repo = StoredSkillRepo {
        id: id.clone(),
        url: url.clone(),
        name: name.clone(),
        branch: branch.clone(),
        auth_token_key: auth_token_key.clone(),
        last_synced_at: Some(now.clone()),
        last_sync_error: None,
        created_at: now.clone(),
    };

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::save_skill_repo(&conn, &repo)?;
        skill_repos::save_repo_skills(&conn, &id, &discovered)?;
    }

    let _ = app.emit("skills:changed", ());

    Ok(SkillRepo {
        id,
        url,
        name,
        branch,
        has_auth_token: auth_token_key.is_some(),
        last_synced_at: Some(now),
        last_sync_error: None,
        created_at: repo.created_at,
        skill_count: discovered.len(),
    })
}

#[tauri::command]
pub async fn skill_repos_remove(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    // Get repo to check for auth token key
    let repo = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::get_skill_repo(&conn, &id)
    };

    // Delete auth token from keychain if present
    if let Some(ref r) = repo {
        if let Some(ref key) = r.auth_token_key {
            let _ = crate::secure_storage::delete_api_key(key);
        }
    }

    // Remove from DB (CASCADE deletes repo_skills)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::remove_skill_repo(&conn, &id)?;
    }

    // Delete cache directory
    let cache = repo_cache_dir(&app, &id);
    if cache.exists() {
        let _ = fs::remove_dir_all(&cache);
    }

    let _ = app.emit("skills:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn skill_repos_sync(
    app: AppHandle,
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let repo = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::get_skill_repo(&conn, &id)
            .ok_or_else(|| format!("Repo not found: {}", id))?
    };

    let _ = app.emit("skills:sync_progress", SyncProgress {
        repo_id: id.clone(),
        status: "syncing".to_string(),
        error: None,
    });

    // Get auth token from keychain
    let token = if let Some(ref key) = repo.auth_token_key {
        crate::secure_storage::get_api_key(key).ok().flatten()
    } else {
        None
    };

    let cache = repo_cache_dir(&app, &id);
    let now = chrono::Utc::now().to_rfc3339();

    // Pull or re-clone
    let sync_result = if cache.exists() {
        git_ops::pull_repo(&cache, token.as_deref())
    } else {
        fs::create_dir_all(cache.parent().unwrap())
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
        git_ops::clone_repo(&repo.url, &repo.branch, &cache, token.as_deref())
    };

    match sync_result {
        Ok(()) => {
            // Re-discover skills
            let discovered = skill_discovery::discover_skills(&id, &cache, &repo.url);
            {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                skill_repos::update_sync_status(&conn, &id, Some(&now), None)?;
                skill_repos::save_repo_skills(&conn, &id, &discovered)?;
            }

            let _ = app.emit("skills:sync_progress", SyncProgress {
                repo_id: id,
                status: "synced".to_string(),
                error: None,
            });
        }
        Err(e) => {
            {
                let conn = db.conn.lock().map_err(|e2| e2.to_string())?;
                let _ = skill_repos::update_sync_status(&conn, &id, None, Some(&e));
            }

            let _ = app.emit("skills:sync_progress", SyncProgress {
                repo_id: id,
                status: "error".to_string(),
                error: Some(e.clone()),
            });

            return Err(e);
        }
    }

    let _ = app.emit("skills:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn skill_repos_sync_all(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let repos = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::list_skill_repos(&conn)
    };

    for repo in repos {
        // Sync each repo, continuing on error
        let _ = skill_repos_sync(app.clone(), db.clone(), repo.id).await;
    }

    Ok(())
}

#[tauri::command]
pub fn skill_repos_skills(
    db: State<'_, DbState>,
    repo_id: Option<String>,
    target_folder: Option<String>,
) -> Result<Vec<RepoSkill>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Build a map of repo names for display
    let repos = skill_repos::list_skill_repos(&conn);
    let repo_names: std::collections::HashMap<String, String> = repos
        .into_iter()
        .map(|r| (r.id, r.name))
        .collect();

    let skills = skill_repos::list_repo_skills(&conn, repo_id.as_deref());

    // Check install status
    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;

    let result = skills
        .into_iter()
        .map(|s| {
            let skill_dir = install_dir.join(&s.skill_id);
            let checksum_file = skill_dir.join(".coworkz-checksum");
            let installed = checksum_file.exists();
            let needs_update = if installed {
                // Compare installed checksum with current source
                // For now, just check if the checksum file exists
                // Full comparison requires the repo cache to be available
                false // Will be enhanced in a later task
            } else {
                false
            };

            RepoSkill {
                repo_id: s.repo_id.clone(),
                repo_name: repo_names
                    .get(&s.repo_id)
                    .cloned()
                    .unwrap_or_default(),
                skill_path: s.skill_path,
                skill_id: s.skill_id,
                name: s.name,
                description: s.description,
                category: s.category,
                installed,
                needs_update,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn skills_install_from_repo(
    app: AppHandle,
    db: State<'_, DbState>,
    repo_id: String,
    skill_path: String,
    target_folder: Option<String>,
) -> Result<(), String> {
    let repo = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::get_skill_repo(&conn, &repo_id)
            .ok_or_else(|| format!("Repo not found: {}", repo_id))?
    };

    // Find the skill in repo_skills
    let skill = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::list_repo_skills(&conn, Some(&repo_id))
            .into_iter()
            .find(|s| s.skill_path == skill_path)
            .ok_or_else(|| format!("Skill not found: {}", skill_path))?
    };

    let cache = repo_cache_dir(&app, &repo_id);
    let source = cache.join(&skill.skill_path);
    if !source.exists() {
        return Err(format!("Skill source directory not found: {}", source.display()));
    }

    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;
    let dest = install_dir.join(&skill.skill_id);

    fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;

    // Copy skill directory
    copy_dir_recursive(&source, &dest)?;

    // Write checksum
    let checksum = compute_dir_checksum(&source)?;
    fs::write(dest.join(".coworkz-checksum"), &checksum)
        .map_err(|e| format!("Failed to write checksum: {}", e))?;

    // Write source tracking
    let source_meta = serde_json::json!({
        "repo_id": repo_id,
        "repo_url": repo.url,
        "skill_path": skill.skill_path,
        "installed_at": chrono::Utc::now().to_rfc3339(),
    });
    fs::write(dest.join(".coworkz-source"), source_meta.to_string())
        .map_err(|e| format!("Failed to write source file: {}", e))?;

    let _ = app.emit("skills:changed", ());
    Ok(())
}

#[tauri::command]
pub fn skills_list_installed(
    target_folder: Option<String>,
) -> Result<Vec<InstalledSkill>, String> {
    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;

    if !install_dir.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let entries = fs::read_dir(&install_dir)
        .map_err(|e| format!("Failed to read skills dir: {}", e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.exists() {
            continue;
        }

        let (name, description) = crate::commands::skills::parse_frontmatter(&path)
            .unwrap_or_else(|| (dir_name.clone(), String::new()));

        let category = crate::commands::skills::derive_category(&dir_name);

        // Check for source tracking
        let source_file = path.join(".coworkz-source");
        let (source_repo_url, source_repo_name) = if source_file.exists() {
            let content = fs::read_to_string(&source_file).unwrap_or_default();
            let meta: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
            (
                meta.get("repo_url").and_then(|v| v.as_str()).map(String::from),
                meta.get("repo_url")
                    .and_then(|v| v.as_str())
                    .map(|u| git_ops::derive_repo_name(u)),
            )
        } else {
            (None, None)
        };

        results.push(InstalledSkill {
            skill_id: dir_name,
            name,
            description,
            category,
            source_repo_url,
            source_repo_name,
        });
    }

    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    Ok(results)
}

#[tauri::command]
pub fn skills_delete_installed(
    app: AppHandle,
    skill_id: String,
    target_folder: Option<String>,
) -> Result<(), String> {
    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;
    let skill_dir = install_dir.join(&skill_id);

    if !skill_dir.exists() {
        return Err(format!("Skill directory not found: {}", skill_dir.display()));
    }

    fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to delete skill: {}", e))?;

    let _ = app.emit("skills:changed", ());
    Ok(())
}
```

**Step 2: Register commands module**

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub mod skill_repos;
```

**Step 3: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the `invoke_handler` macro (after the existing skills section):

```rust
// Skill Repos (Skills Manager)
commands::skill_repos::skill_repos_list,
commands::skill_repos::skill_repos_add,
commands::skill_repos::skill_repos_remove,
commands::skill_repos::skill_repos_sync,
commands::skill_repos::skill_repos_sync_all,
commands::skill_repos::skill_repos_skills,
commands::skill_repos::skills_install_from_repo,
commands::skill_repos::skills_list_installed,
commands::skill_repos::skills_delete_installed,
```

**Step 4: Add dependencies to `Cargo.toml`**

Ensure these are present in `src-tauri/Cargo.toml`:

```toml
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

(`serde_json` and `dirs` should already be present.)

**Step 5: Make `copy_dir_recursive` and `compute_dir_checksum` public**

In `src-tauri/src/commands/skills.rs`, change visibility:

```rust
pub fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> { ... }
pub fn compute_dir_checksum(dir: &Path) -> Result<String, String> { ... }
```

**Step 6: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 7: Commit**

```bash
git add src-tauri/src/commands/skill_repos.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/commands/skills.rs src-tauri/Cargo.toml
git commit -m "feat: add skill_repos Tauri commands for repo CRUD, sync, and skill install"
```

---

### Task 5: Tauri Capabilities for Skills Manager Window

**Files:**
- Create: `src-tauri/capabilities/skills.json`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Create skills window capability**

Create `src-tauri/capabilities/skills.json`:

```json
{
  "identifier": "skills-manager",
  "windows": ["skills"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "shell:allow-open",
    "opener:default",
    { "identifier": "opener:allow-open-path", "allow": [{ "path": "**" }] },
    "dialog:default",
    "dialog:allow-open"
  ]
}
```

**Step 2: Add `webview:allow-create-webview-window` to main window capabilities**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
"webview:allow-create-webview-window"
```

**Step 3: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src-tauri/capabilities/skills.json src-tauri/capabilities/default.json
git commit -m "feat: add Tauri capabilities for skills manager window"
```

---

### Task 6: Emit `skills:changed` from Existing Skills Install

**Files:**
- Modify: `src-tauri/src/commands/skills.rs`

The existing `skills_install` command (bundled catalog) should also emit `skills:changed` so the Skills Manager window refreshes.

**Step 1: Add emit to `skills_install`**

In `src-tauri/src/commands/skills.rs`, modify the `skills_install` command to take `app: AppHandle` and emit after install:

```rust
#[tauri::command]
pub fn skills_install(app: AppHandle, skill_id: String) -> Result<(), String> {
    install_skill(&app, &skill_id)?;
    let _ = app.emit("skills:changed", ());
    Ok(())
}
```

Add `use tauri::Emitter;` at the top of the file if not already present.

**Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 3: Commit**

```bash
git add src-tauri/src/commands/skills.rs
git commit -m "feat: emit skills:changed event from bundled skill install"
```

---

## Phase 2: Frontend API + Store

### Task 7: Frontend Types and API Wrappers

**Files:**
- Modify: `src/lib/tauri-api.ts`
- Modify: `src/lib/tauri-api-interface.ts`

**Step 1: Add types to `tauri-api.ts`**

Add after the existing skill types (around line 1225):

```typescript
// Skills Manager types
export interface SkillRepo {
  id: string;
  url: string;
  name: string;
  branch: string;
  hasAuthToken: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  skillCount: number;
}

export interface RepoSkill {
  repoId: string;
  repoName: string;
  skillPath: string;
  skillId: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
  needsUpdate: boolean;
}

export interface InstalledSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  sourceRepoUrl: string | null;
  sourceRepoName: string | null;
}

export interface SyncProgress {
  repoId: string;
  status: 'syncing' | 'synced' | 'error';
  error?: string;
}
```

**Step 2: Add invoke wrappers**

Add after the existing skill functions:

```typescript
// Skills Manager API
export async function skillReposList(): Promise<SkillRepo[]> {
  return invoke<SkillRepo[]>('skill_repos_list');
}

export async function skillReposAdd(
  url: string,
  branch?: string,
  authToken?: string,
): Promise<SkillRepo> {
  return invoke<SkillRepo>('skill_repos_add', { url, branch, authToken });
}

export async function skillReposRemove(id: string): Promise<void> {
  return invoke<void>('skill_repos_remove', { id });
}

export async function skillReposSync(id: string): Promise<void> {
  return invoke<void>('skill_repos_sync', { id });
}

export async function skillReposSyncAll(): Promise<void> {
  return invoke<void>('skill_repos_sync_all');
}

export async function skillReposSkills(
  repoId?: string,
  targetFolder?: string,
): Promise<RepoSkill[]> {
  return invoke<RepoSkill[]>('skill_repos_skills', { repoId, targetFolder });
}

export async function skillsInstallFromRepo(
  repoId: string,
  skillPath: string,
  targetFolder?: string,
): Promise<void> {
  return invoke<void>('skills_install_from_repo', { repoId, skillPath, targetFolder });
}

export async function skillsListInstalled(
  targetFolder?: string,
): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>('skills_list_installed', { targetFolder });
}

export async function skillsDeleteInstalled(
  skillId: string,
  targetFolder?: string,
): Promise<void> {
  return invoke<void>('skills_delete_installed', { skillId, targetFolder });
}

// Skills Manager events
export async function onSkillsChanged(callback: () => void): Promise<UnlistenFn> {
  return listen<void>('skills:changed', () => callback());
}

export async function onSkillsSyncProgress(
  callback: (progress: SyncProgress) => void,
): Promise<UnlistenFn> {
  return listen<SyncProgress>('skills:sync_progress', (event) =>
    callback(event.payload),
  );
}
```

**Step 3: Add to `getTauriApi()` return object**

In the `getTauriApi()` function, add to the return object:

```typescript
// Skills Manager
skillReposList,
skillReposAdd,
skillReposRemove,
skillReposSync,
skillReposSyncAll,
skillReposSkills,
skillsInstallFromRepo,
skillsListInstalled,
skillsDeleteInstalled,
onSkillsChanged,
onSkillsSyncProgress,
```

**Step 4: Update `TauriAPI` interface**

In `src/lib/tauri-api-interface.ts`, add to the interface and import the new types:

```typescript
// In the import from './tauri-api':
import type {
  // ... existing imports ...
  SkillRepo,
  RepoSkill,
  InstalledSkill,
  SyncProgress,
} from './tauri-api';

// In the TauriAPI interface:
// Skills Manager
skillReposList(): Promise<SkillRepo[]>;
skillReposAdd(url: string, branch?: string, authToken?: string): Promise<SkillRepo>;
skillReposRemove(id: string): Promise<void>;
skillReposSync(id: string): Promise<void>;
skillReposSyncAll(): Promise<void>;
skillReposSkills(repoId?: string, targetFolder?: string): Promise<RepoSkill[]>;
skillsInstallFromRepo(repoId: string, skillPath: string, targetFolder?: string): Promise<void>;
skillsListInstalled(targetFolder?: string): Promise<InstalledSkill[]>;
skillsDeleteInstalled(skillId: string, targetFolder?: string): Promise<void>;
onSkillsChanged(callback: () => void): () => void;
onSkillsSyncProgress(callback: (progress: SyncProgress) => void): () => void;
```

In the `cachedTauriAPI` object spread section, wrap the event listeners:

```typescript
onSkillsChanged: (callback) => toSyncUnlisten(tauriApi.onSkillsChanged(callback)),
onSkillsSyncProgress: (callback) => toSyncUnlisten(tauriApi.onSkillsSyncProgress(callback)),
```

**Step 5: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 6: Commit**

```bash
git add src/lib/tauri-api.ts src/lib/tauri-api-interface.ts
git commit -m "feat: add Skills Manager API types, invoke wrappers, and event listeners"
```

---

### Task 8: Skills Manager Zustand Store

**Files:**
- Create: `src/stores/skillsManagerStore.ts`

**Step 1: Create the store**

```typescript
import { create } from 'zustand';
import type { InstalledSkill, RepoSkill, SkillRepo } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';

type TargetFolder = 'opencode' | 'claude' | 'agents';

interface SkillsManagerState {
  // Repos
  repos: SkillRepo[];
  reposLoading: boolean;

  // Remote skills
  repoSkills: RepoSkill[];
  repoSkillsLoading: boolean;

  // Installed skills
  installedSkills: InstalledSkill[];
  installedLoading: boolean;

  // Filters
  targetFolder: TargetFolder;
  selectedRepoId: string | null; // null = "All Repos"
  searchQuery: string;
  activeCategory: string;

  // Actions
  fetchRepos: () => Promise<void>;
  fetchRepoSkills: () => Promise<void>;
  fetchInstalledSkills: () => Promise<void>;
  setTargetFolder: (folder: TargetFolder) => void;
  setSelectedRepoId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string) => void;
  refreshAll: () => Promise<void>;
}

export const useSkillsManagerStore = create<SkillsManagerState>((set, get) => ({
  repos: [],
  reposLoading: false,
  repoSkills: [],
  repoSkillsLoading: false,
  installedSkills: [],
  installedLoading: false,
  targetFolder: 'opencode',
  selectedRepoId: null,
  searchQuery: '',
  activeCategory: 'All',

  fetchRepos: async () => {
    set({ reposLoading: true });
    try {
      const api = getTauriAPI();
      const repos = await api.skillReposList();
      set({ repos, reposLoading: false });
    } catch {
      set({ reposLoading: false });
    }
  },

  fetchRepoSkills: async () => {
    set({ repoSkillsLoading: true });
    try {
      const api = getTauriAPI();
      const { selectedRepoId, targetFolder } = get();
      const skills = await api.skillReposSkills(
        selectedRepoId ?? undefined,
        targetFolder,
      );
      set({ repoSkills: skills, repoSkillsLoading: false });
    } catch {
      set({ repoSkillsLoading: false });
    }
  },

  fetchInstalledSkills: async () => {
    set({ installedLoading: true });
    try {
      const api = getTauriAPI();
      const { targetFolder } = get();
      const skills = await api.skillsListInstalled(targetFolder);
      set({ installedSkills: skills, installedLoading: false });
    } catch {
      set({ installedLoading: false });
    }
  },

  setTargetFolder: (folder) => {
    set({ targetFolder: folder });
    // Re-fetch everything for the new folder
    const { fetchRepoSkills, fetchInstalledSkills } = get();
    fetchRepoSkills();
    fetchInstalledSkills();
  },

  setSelectedRepoId: (id) => {
    set({ selectedRepoId: id, activeCategory: 'All' });
    get().fetchRepoSkills();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setActiveCategory: (category) => set({ activeCategory: category }),

  refreshAll: async () => {
    const { fetchRepos, fetchRepoSkills, fetchInstalledSkills } = get();
    await Promise.all([fetchRepos(), fetchRepoSkills(), fetchInstalledSkills()]);
  },
}));
```

**Step 2: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 3: Commit**

```bash
git add src/stores/skillsManagerStore.ts
git commit -m "feat: add Zustand store for Skills Manager"
```

---

## Phase 3: Window & Routing Infrastructure

### Task 9: Router + SkillsManagerPage Shell

**Files:**
- Create: `src/pages/SkillsManager.tsx`
- Modify: `src/App.tsx`
- Create: `src/lib/skills-window.ts`

**Step 1: Create the window open utility**

Create `src/lib/skills-window.ts`:

```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export function openSkillsManagerWindow() {
  const label = 'skills';
  const existing = WebviewWindow.getByLabel(label);
  if (existing) {
    existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: '/#/skills',
    title: 'Skills Manager',
    width: 1100,
    height: 750,
  });
}
```

**Step 2: Create the `SkillsManagerPage` shell**

Create `src/pages/SkillsManager.tsx` with a minimal three-panel layout shell:

```tsx
import { useEffect } from 'react';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { getTauriAPI } from '@/lib/tauri-api-interface';

export default function SkillsManagerPage() {
  const { refreshAll } = useSkillsManagerStore();

  useEffect(() => {
    refreshAll();

    // Subscribe to skills:changed events
    const api = getTauriAPI();
    const unlisten = api.onSkillsChanged(() => {
      refreshAll();
    });

    return () => {
      unlisten();
    };
  }, [refreshAll]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex h-10 items-center border-b px-4 text-sm font-medium">
        Skills Manager
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — file tree */}
        <div className="w-[250px] shrink-0 border-r">
          <div className="p-2 text-xs text-muted-foreground">
            Installed Skills (file tree placeholder)
          </div>
        </div>

        {/* Center panel — skills grid */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 text-sm text-muted-foreground">
            Skills grid placeholder
          </div>
        </div>

        {/* Right panel — file preview (conditional) */}
      </div>

      {/* Status bar */}
      <div className="flex h-6 items-center border-t px-4 text-xs text-muted-foreground">
        Status bar placeholder
      </div>
    </div>
  );
}
```

**Step 3: Add route to `App.tsx`**

In `src/App.tsx`, import the page and add the route. The `/skills` route should render the page directly (no sidebar, no layout wrapper):

```tsx
// Add import at top
import SkillsManagerPage from '@/pages/SkillsManager';

// In the Routes block, add before the catch-all:
<Route path="/skills" element={<SkillsManagerPage />} />
```

The `/skills` route renders without the main app layout (no `Sidebar`, no `SettingsDialog`, no `FilePreviewPanel`). This means the route check needs to happen BEFORE the layout wrapper. Check the existing `App.tsx` structure — if routes are rendered inside a layout, the `/skills` route may need to be at the top level, outside the layout.

Looking at the current `App.tsx` structure, the routes are rendered inside a layout div that includes the sidebar. The `/skills` route needs to be OUTSIDE this layout. Use a conditional check on `location.pathname`:

```tsx
const location = useLocation();
const isSkillsManager = location.pathname === '/skills';

if (isSkillsManager) {
  return <SkillsManagerPage />;
}

// ... rest of the existing layout
```

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 5: Commit**

```bash
git add src/pages/SkillsManager.tsx src/lib/skills-window.ts src/App.tsx
git commit -m "feat: add Skills Manager page shell, router, and window open utility"
```

---

### Task 10: Entry Point in Main Window Sidebar

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

**Step 1: Add Skills Manager button to the sidebar bottom bar**

In `src/components/layout/Sidebar.tsx`, add a button between the `FeedbackButton` and the Settings button in the bottom bar (around line 258):

```tsx
import { Package } from 'lucide-react';
import { openSkillsManagerWindow } from '@/lib/skills-window';

// In the bottom bar div (flex items-center gap-1):
<Button
  onClick={openSkillsManagerWindow}
  size="icon"
  title="Skills Manager"
  variant="ghost"
>
  <Package className="h-4 w-4" />
</Button>
```

**Step 2: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 3: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: add Skills Manager button to sidebar bottom bar"
```

---

## Phase 4: UI Components

### Task 11: Left Sidebar — Folder Switcher + File Tree

**Files:**
- Create: `src/components/skills-manager/SkillsSidebar.tsx`
- Create: `src/components/skills-manager/FolderSwitcher.tsx`

**Step 1: Create `FolderSwitcher.tsx`**

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

const FOLDER_OPTIONS = [
  { value: 'opencode', label: 'OpenCode Skills', path: '~/.config/opencode/skills/' },
  { value: 'claude', label: 'Claude Skills', path: '~/.claude/skills/' },
  { value: 'agents', label: 'Agent Skills', path: '~/.agents/skills/' },
] as const;

export function FolderSwitcher() {
  const { targetFolder, setTargetFolder } = useSkillsManagerStore();

  return (
    <div className="border-b p-2">
      <Select value={targetFolder} onValueChange={(v) => setTargetFolder(v as 'opencode' | 'claude' | 'agents')}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FOLDER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.path}</div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

**Step 2: Create `SkillsSidebar.tsx`**

This component uses `useFileTree` to display the installed skills folder tree. Clicking a file opens it in the preview store.

```tsx
import { useEffect, useMemo, useCallback } from 'react';
import { useFileTree } from '@/hooks/useFileTree';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { FolderSwitcher } from './FolderSwitcher';
import type { DirectoryEntry } from '@/shared/types/workspace';

const TARGET_PATHS: Record<string, string> = {
  opencode: '~/.config/opencode/skills',
  claude: '~/.claude/skills',
  agents: '~/.agents/skills',
};

function resolveHomePath(path: string): string {
  const home = ''; // Will be resolved by the Tauri readDirectory command
  return path.replace('~', home);
}

// Filter out hidden entries
function isHiddenEntry(entry: DirectoryEntry): boolean {
  return entry.name.startsWith('.');
}

export function SkillsSidebar() {
  const { targetFolder } = useSkillsManagerStore();
  const { openPreview } = useFilePreviewStore();

  const filterPredicate = useCallback(
    (entry: DirectoryEntry) => !isHiddenEntry(entry),
    [],
  );

  const {
    nodes,
    isLoadingRoot,
    searchQuery,
    loadRoot,
    toggleExpand,
    setSearchQuery,
  } = useFileTree(filterPredicate);

  // Load the skills folder when target changes
  useEffect(() => {
    // The actual path resolution happens server-side through the readDirectory command
    // For now we need the resolved path. We'll get it from the API.
    const loadFolder = async () => {
      const home = await import('@tauri-apps/api/path').then(m => m.homeDir());
      const paths: Record<string, string> = {
        opencode: `${home}.config/opencode/skills`,
        claude: `${home}.claude/skills`,
        agents: `${home}.agents/skills`,
      };
      const path = paths[targetFolder];
      if (path) {
        loadRoot(path);
      }
    };
    loadFolder();
  }, [targetFolder, loadRoot]);

  const handleFileClick = useCallback(
    (entry: DirectoryEntry) => {
      if (entry.isDirectory) {
        toggleExpand(entry.path);
      } else {
        openPreview(entry);
      }
    },
    [toggleExpand, openPreview],
  );

  return (
    <div className="flex h-full flex-col">
      <FolderSwitcher />

      {/* Search */}
      <div className="border-b p-2">
        <input
          className="w-full rounded border bg-background px-2 py-1 text-xs"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search installed skills..."
          type="text"
          value={searchQuery}
        />
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-auto p-1">
        {isLoadingRoot ? (
          <div className="p-2 text-xs text-muted-foreground">Loading...</div>
        ) : nodes.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground">No skills installed</div>
        ) : (
          <FileTreeNodes nodes={nodes} onFileClick={handleFileClick} onToggle={toggleExpand} />
        )}
      </div>
    </div>
  );
}

// Recursive tree node renderer — follows the FileTreePanel pattern
function FileTreeNodes({
  nodes,
  onFileClick,
  onToggle,
  depth = 0,
}: {
  nodes: ReturnType<typeof useFileTree>['nodes'];
  onFileClick: (entry: DirectoryEntry) => void;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.entry.path}>
          <button
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              if (node.entry.isDirectory) {
                onToggle(node.entry.path);
              } else {
                onFileClick(node.entry);
              }
            }}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            type="button"
          >
            <span className="shrink-0">
              {node.entry.isDirectory ? (node.isExpanded ? '📂' : '📁') : '📄'}
            </span>
            <span className="truncate">{node.entry.name}</span>
          </button>
          {node.isExpanded && node.children && (
            <FileTreeNodes
              depth={depth + 1}
              nodes={node.children}
              onFileClick={onFileClick}
              onToggle={onToggle}
            />
          )}
        </div>
      ))}
    </>
  );
}
```

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src/components/skills-manager/SkillsSidebar.tsx src/components/skills-manager/FolderSwitcher.tsx
git commit -m "feat: add Skills Manager sidebar with folder switcher and file tree"
```

---

### Task 12: Center Panel — Repo Toolbar + Skills Grid

**Files:**
- Create: `src/components/skills-manager/RepoToolbar.tsx`
- Create: `src/components/skills-manager/RepoSkillsGrid.tsx`
- Create: `src/components/skills-manager/AddRepoDialog.tsx`

**Step 1: Create `RepoToolbar.tsx`**

The toolbar with: repo filter dropdown, "Add Repo" button, "Sync" button, last-synced time.

```tsx
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { AddRepoDialog } from './AddRepoDialog';

export function RepoToolbar() {
  const { repos, selectedRepoId, setSelectedRepoId, refreshAll } =
    useSkillsManagerStore();
  const [syncing, setSyncing] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const api = getTauriAPI();
      await api.skillReposSyncAll();
      await refreshAll();
    } finally {
      setSyncing(false);
    }
  };

  // Find last synced time across all repos
  const lastSynced = repos.reduce<string | null>((latest, r) => {
    if (!r.lastSyncedAt) return latest;
    if (!latest) return r.lastSyncedAt;
    return r.lastSyncedAt > latest ? r.lastSyncedAt : latest;
  }, null);

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {/* Repo filter */}
        <Select
          value={selectedRepoId ?? 'all'}
          onValueChange={(v) => setSelectedRepoId(v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="All Repos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Repos</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Add Repo */}
        <Button
          className="h-8 text-xs"
          onClick={() => setShowAddRepo(true)}
          size="sm"
          variant="outline"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Repo
        </Button>

        {/* Sync */}
        <Button
          className="h-8 text-xs"
          disabled={syncing || repos.length === 0}
          onClick={handleSync}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
          Sync
        </Button>

        {/* Last synced */}
        <div className="ml-auto text-xs text-muted-foreground">
          {lastSynced
            ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}`
            : repos.length > 0
              ? 'Not synced yet'
              : 'No repos added'}
        </div>
      </div>

      <AddRepoDialog open={showAddRepo} onOpenChange={setShowAddRepo} />
    </>
  );
}
```

**Step 2: Create `AddRepoDialog.tsx`**

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [authToken, setAuthToken] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const { refreshAll } = useSkillsManagerStore();

  const handleAdd = async () => {
    if (!url.trim()) {
      setError('Repository URL is required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const api = getTauriAPI();
      await api.skillReposAdd(
        url.trim(),
        branch.trim() || undefined,
        authToken.trim() || undefined,
      );
      await refreshAll();
      // Reset and close
      setUrl('');
      setBranch('main');
      setAuthToken('');
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Skill Repository</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              value={url}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-branch">Branch</Label>
            <Input
              id="repo-branch"
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              value={branch}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-token">
              Personal Access Token <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="repo-token"
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="ghp_..."
              type="password"
              value={authToken}
            />
            <p className="text-xs text-muted-foreground">
              Required for private repositories. Stored in your OS keychain.
            </p>
          </div>
          {error && (
            <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button disabled={adding} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={adding || !url.trim()} onClick={handleAdd}>
            {adding ? 'Cloning...' : 'Add Repository'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Create `RepoSkillsGrid.tsx`**

This is the center panel grid, modeled after `SkillsCatalog.tsx`.

```tsx
import { useMemo, useState } from 'react';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RepoSkill } from '@/lib/tauri-api';

const CATEGORY_COLORS: Record<string, string> = {
  Data: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  Design: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  Document: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  Enterprise: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
  Finance: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  General: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  Legal: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  Marketing: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  Product: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  Productivity: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  Sales: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  Support: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
};

export function RepoSkillsGrid() {
  const {
    repoSkills,
    repoSkillsLoading,
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    targetFolder,
    refreshAll,
  } = useSkillsManagerStore();
  const { openPreviewByPath } = useFilePreviewStore();
  const [installingPath, setInstallingPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Categories
  const categories = useMemo(() => {
    const cats = new Set(repoSkills.map((s) => s.category));
    return ['All', ...Array.from(cats).sort()];
  }, [repoSkills]);

  // Filtered skills
  const filtered = useMemo(() => {
    const queryLower = searchQuery.toLowerCase();
    return repoSkills
      .filter((s) => activeCategory === 'All' || s.category === activeCategory)
      .filter((s) => {
        if (!queryLower) return true;
        return (
          s.name.toLowerCase().includes(queryLower) ||
          s.description.toLowerCase().includes(queryLower) ||
          s.category.toLowerCase().includes(queryLower)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [repoSkills, activeCategory, searchQuery]);

  const handleInstall = async (skill: RepoSkill) => {
    setInstallingPath(skill.skillPath);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[skill.skillPath];
      return next;
    });
    try {
      const api = getTauriAPI();
      await api.skillsInstallFromRepo(skill.repoId, skill.skillPath, targetFolder);
      await refreshAll();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [skill.skillPath]: String(e) }));
    } finally {
      setInstallingPath(null);
    }
  };

  const handleView = async (skill: RepoSkill) => {
    // Construct the path to SKILL.md in the repo cache
    // This would need a Tauri command to resolve the cache path
    // For now, open by constructing the path
    try {
      const api = getTauriAPI();
      // We'll need to get the cache path from the backend
      // For MVP, we can read the installed copy if available
      const home = await import('@tauri-apps/api/path').then(m => m.homeDir());
      const paths: Record<string, string> = {
        opencode: `${home}.config/opencode/skills`,
        claude: `${home}.claude/skills`,
        agents: `${home}.agents/skills`,
      };
      const skillMdPath = `${paths[targetFolder]}/${skill.skillId}/SKILL.md`;
      openPreviewByPath(skillMdPath);
    } catch {
      // Fallback: show error
    }
  };

  if (repoSkillsLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading skills...
      </div>
    );
  }

  if (repoSkills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>No skills available.</p>
        <p>Add a repository to browse skills from it.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search */}
      <div className="px-4 pt-3">
        <Input
          className="h-8 text-xs"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search skills..."
          value={searchQuery}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto px-4 py-2">
        {categories.map((cat) => (
          <button
            className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
            key={cat}
            onClick={() => setActiveCategory(cat)}
            type="button"
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No skills match your search
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <SkillCard
                error={errors[skill.skillPath]}
                installing={installingPath === skill.skillPath}
                key={`${skill.repoId}-${skill.skillPath}`}
                onInstall={() => handleInstall(skill)}
                onView={() => handleView(skill)}
                skill={skill}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  installing,
  error,
  onInstall,
  onView,
}: {
  skill: RepoSkill;
  installing: boolean;
  error?: string;
  onInstall: () => void;
  onView: () => void;
}) {
  const colorClass =
    CATEGORY_COLORS[skill.category] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{skill.name}</h3>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {skill.description}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}>
          {skill.category}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {skill.repoName}
        </span>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-1 text-[10px] text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="text-xs text-primary underline hover:no-underline"
          onClick={onView}
          type="button"
        >
          View
        </button>

        {installing ? (
          <Button className="ml-auto h-6 text-xs" disabled size="sm">
            Installing...
          </Button>
        ) : skill.installed && !skill.needsUpdate ? (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-green-600">Installed</span>
            <button
              className="text-xs text-muted-foreground underline hover:no-underline"
              onClick={onInstall}
              type="button"
            >
              Re-install
            </button>
          </div>
        ) : skill.installed && skill.needsUpdate ? (
          <Button
            className="ml-auto h-6 bg-amber-500 text-xs hover:bg-amber-600"
            onClick={onInstall}
            size="sm"
          >
            Update
          </Button>
        ) : (
          <Button className="ml-auto h-6 text-xs" onClick={onInstall} size="sm">
            Install
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 5: Commit**

```bash
git add src/components/skills-manager/RepoToolbar.tsx src/components/skills-manager/AddRepoDialog.tsx src/components/skills-manager/RepoSkillsGrid.tsx
git commit -m "feat: add Skills Manager center panel components (toolbar, grid, add-repo dialog)"
```

---

### Task 13: Assemble the Full SkillsManagerPage

**Files:**
- Modify: `src/pages/SkillsManager.tsx`
- Create: `src/components/skills-manager/SkillsStatusBar.tsx`

**Step 1: Create `SkillsStatusBar.tsx`**

```tsx
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

export function SkillsStatusBar() {
  const { repos, repoSkills, installedSkills } = useSkillsManagerStore();

  return (
    <div className="flex h-6 items-center gap-3 border-t px-4 text-xs text-muted-foreground">
      <span>{repos.length} {repos.length === 1 ? 'repo' : 'repos'}</span>
      <span>{repoSkills.length} remote {repoSkills.length === 1 ? 'skill' : 'skills'}</span>
      <span>{installedSkills.length} installed</span>
    </div>
  );
}
```

**Step 2: Assemble the full page**

Update `src/pages/SkillsManager.tsx` to wire all components together with the three-panel layout, including the right file preview pane:

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { SkillsSidebar } from '@/components/skills-manager/SkillsSidebar';
import { RepoToolbar } from '@/components/skills-manager/RepoToolbar';
import { RepoSkillsGrid } from '@/components/skills-manager/RepoSkillsGrid';
import { SkillsStatusBar } from '@/components/skills-manager/SkillsStatusBar';
import { FilePreviewPanel } from '@/components/file-preview/FilePreviewPanel';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 400;
const DEFAULT_SIDEBAR = 250;

export default function SkillsManagerPage() {
  const { refreshAll } = useSkillsManagerStore();
  const { selectedFile, isPreviewOpen, closePreview } = useFilePreviewStore();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const resizingRef = useRef(false);

  useEffect(() => {
    refreshAll();

    const api = getTauriAPI();
    const unlisten = api.onSkillsChanged(() => {
      refreshAll();
    });

    return () => {
      unlisten();
    };
  }, [refreshAll]);

  // Escape to close preview
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPreviewOpen) {
        closePreview();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPreviewOpen, closePreview]);

  // Sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — file tree */}
        <div className="shrink-0 border-r" style={{ width: sidebarWidth }}>
          <SkillsSidebar />
        </div>

        {/* Resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={handleResizeStart}
          role="separator"
        />

        {/* Center panel — toolbar + grid */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <RepoToolbar />
          <RepoSkillsGrid />
        </div>

        {/* Right panel — file preview */}
        {isPreviewOpen && selectedFile && (
          <>
            <div className="w-px bg-border" />
            <div className="w-[400px] shrink-0">
              <FilePreviewPanel
                file={selectedFile}
                onClose={closePreview}
              />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <SkillsStatusBar />
    </div>
  );
}
```

Note: `FilePreviewPanel` is called WITHOUT `onAddToChat` — this hides the "Add to Chat" button since the prop is optional.

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src/pages/SkillsManager.tsx src/components/skills-manager/SkillsStatusBar.tsx
git commit -m "feat: assemble full Skills Manager page with three-panel layout"
```

---

## Phase 5: Integration & Polish

### Task 14: Background Sync on App Launch

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add background sync in the `setup` closure**

In `src-tauri/src/lib.rs`, after the existing setup code (opencode-server-api skill deploy), add:

```rust
// Background sync skill repos on launch
let app_handle_for_sync = app.handle().clone();
std::thread::spawn(move || {
    // Small delay to let the app finish loading
    std::thread::sleep(std::time::Duration::from_secs(3));

    let db_state = app_handle_for_sync.state::<crate::db::DbState>();
    let repos = {
        let conn = db_state.conn.lock().unwrap();
        crate::db::skill_repos::list_skill_repos(&conn)
    };

    if repos.is_empty() {
        return;
    }

    if !crate::git_ops::is_git_available() {
        return;
    }

    for repo in repos {
        let cache = app_handle_for_sync
            .path()
            .app_data_dir()
            .expect("app data dir")
            .join("skill-repo-cache")
            .join(&repo.id);

        let _ = app_handle_for_sync.emit(
            "skills:sync_progress",
            crate::commands::skill_repos::SyncProgress {
                repo_id: repo.id.clone(),
                status: "syncing".to_string(),
                error: None,
            },
        );

        let token = repo.auth_token_key.as_ref().and_then(|key| {
            crate::secure_storage::get_api_key(key).ok().flatten()
        });

        let result = if cache.exists() {
            crate::git_ops::pull_repo(&cache, token.as_deref())
        } else {
            let _ = std::fs::create_dir_all(cache.parent().unwrap());
            crate::git_ops::clone_repo(&repo.url, &repo.branch, &cache, token.as_deref())
        };

        let now = chrono::Utc::now().to_rfc3339();
        match result {
            Ok(()) => {
                let discovered = crate::skill_discovery::discover_skills(
                    &repo.id, &cache, &repo.url,
                );
                let conn = db_state.conn.lock().unwrap();
                let _ = crate::db::skill_repos::update_sync_status(
                    &conn, &repo.id, Some(&now), None,
                );
                let _ = crate::db::skill_repos::save_repo_skills(
                    &conn, &repo.id, &discovered,
                );
                let _ = app_handle_for_sync.emit(
                    "skills:sync_progress",
                    crate::commands::skill_repos::SyncProgress {
                        repo_id: repo.id,
                        status: "synced".to_string(),
                        error: None,
                    },
                );
            }
            Err(e) => {
                let conn = db_state.conn.lock().unwrap();
                let _ = crate::db::skill_repos::update_sync_status(
                    &conn, &repo.id, None, Some(&e),
                );
                let _ = app_handle_for_sync.emit(
                    "skills:sync_progress",
                    crate::commands::skill_repos::SyncProgress {
                        repo_id: repo.id,
                        status: "error".to_string(),
                        error: Some(e),
                    },
                );
            }
        }
    }

    let _ = app_handle_for_sync.emit("skills:changed", ());
});
```

**Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: Compiles.

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add background skill repo sync on app launch"
```

---

### Task 15: Cross-Window Sync in Main Window

**Files:**
- Modify: `src/components/landing/SkillsCatalog.tsx`
- Modify: `src/stores/skillsStore.ts`

The main window's `SkillsCatalog` and `useSkillsStore` (autocomplete) need to listen for `skills:changed` events from the Skills Manager.

**Step 1: Add event listener to `SkillsCatalog`**

In `src/components/landing/SkillsCatalog.tsx`, add a `useEffect` that subscribes to `skills:changed`:

```tsx
useEffect(() => {
  const unlisten = api.onSkillsChanged(() => {
    api.listSkillsWithStatus().then(setSkills).catch(() => {});
  });
  return () => { unlisten(); };
}, [api]);
```

**Step 2: Add event listener to `skillsStore`**

This is trickier since the store doesn't own a lifecycle. The best approach is to have the `App.tsx` (main window) subscribe and call `fetchInstalledSkills` on the store. Add to the main `App.tsx` effect that handles other event subscriptions:

```tsx
// In App.tsx, inside the existing useEffect for event subscriptions:
const unlistenSkills = api.onSkillsChanged(() => {
  useSkillsStore.getState().fetchInstalledSkills();
});
// ... in cleanup:
return () => {
  // ... existing cleanup
  unlistenSkills();
};
```

**Step 3: Verify**

Run: `pnpm typecheck`
Expected: Compiles.

**Step 4: Commit**

```bash
git add src/components/landing/SkillsCatalog.tsx src/App.tsx
git commit -m "feat: add cross-window skills:changed sync in main window"
```

---

### Task 16: Final Verification and Cleanup

**Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors.

**Step 2: Rust check**

Run: `cd src-tauri && cargo check`
Expected: No errors.

**Step 3: Lint**

Run: `pnpm ultracite:fix src/ src-tauri/sidecar-opencode/`
Expected: Auto-fixes applied.

**Step 4: Run existing tests**

Run: `pnpm test --run`
Expected: All existing tests pass.

Run: `cd src-tauri && cargo test`
Expected: All existing tests pass (including new `git_ops` tests).

**Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for Skills Manager feature"
```

---

## Implementation Log

_(To be filled during implementation)_
