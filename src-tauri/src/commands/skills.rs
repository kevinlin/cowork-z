//! Skills — list installed skills in `~/.config/opencode/skills/` and resolve
//! their SKILL.md paths.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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
    if id.starts_with("data-") {
        return "Data";
    }
    if id.starts_with("design-") {
        return "Design";
    }
    if id.starts_with("doc-") {
        return "Document";
    }
    if id.starts_with("enterprise-") {
        return "Enterprise";
    }
    if id.starts_with("finance-") {
        return "Finance";
    }
    if id.starts_with("legal-") {
        return "Legal";
    }
    if id.starts_with("marketing-") {
        return "Marketing";
    }
    if id.starts_with("product-") {
        return "Product";
    }
    if id.starts_with("productivity-") {
        return "Productivity";
    }
    if id.starts_with("sales-") {
        return "Sales";
    }
    if id.starts_with("support-") {
        return "Support";
    }
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
        if !in_front {
            continue;
        }
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().to_string();
        }
    }

    if name.is_empty() {
        return None;
    }
    Some((name, description))
}

// ── Path resolution ──────────────────────────────────────────────────────────

/// `~/.config/opencode/skills` — the OpenCode global skills directory.
pub fn opencode_skills_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".config").join("opencode").join("skills"))
}

// ── Core logic ────────────────────────────────────────────────────────────────

/// List all skills installed under `~/.config/opencode/skills/`. Entries always
/// carry `installed: true, needs_update: false`.
pub fn list_skills_with_status(_app: &AppHandle) -> Vec<SkillWithStatus> {
    let skills_dir = opencode_skills_dir().unwrap_or_default();
    list_skills_in_dir(&skills_dir)
}

/// Enumerate skills from a single global install directory.
pub fn list_skills_in_dir(skills_dir: &Path) -> Vec<SkillWithStatus> {
    let mut result: Vec<SkillWithStatus> = Vec::new();

    if let Ok(entries) = fs::read_dir(skills_dir) {
        for (id, path) in scan_skill_dirs(entries) {
            if !path.join("SKILL.md").exists() {
                continue;
            }
            let Some((name, description)) = parse_frontmatter(&path) else {
                continue;
            };
            let status = SkillStatus {
                installed: true,
                needs_update: false,
            };
            result.push(make_skill(id, name, description, status));
        }
    }

    result.sort_by(|a, b| {
        a.meta
            .category
            .cmp(&b.meta.category)
            .then(a.meta.name.cmp(&b.meta.name))
    });
    result
}

/// Yield `(id, path)` for each non-hidden directory in a `read_dir` iterator.
fn scan_skill_dirs(entries: fs::ReadDir) -> impl Iterator<Item = (String, PathBuf)> {
    entries.flatten().filter_map(|entry| {
        let path = entry.path();
        if !path.is_dir() {
            return None;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') {
            return None;
        }
        Some((id, path))
    })
}

fn make_skill(
    id: String,
    name: String,
    description: String,
    status: SkillStatus,
) -> SkillWithStatus {
    let category = derive_category(&id).to_string();
    SkillWithStatus {
        meta: SkillMeta {
            id,
            name,
            description,
            category,
        },
        status,
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn skills_list_with_status(app: AppHandle) -> Vec<SkillWithStatus> {
    list_skills_with_status(&app)
}

/// Resolve the SKILL.md path for a skill, searching project-level then global
/// install locations in priority order.
#[tauri::command]
pub fn skills_get_skill_file_path(
    _app: AppHandle,
    skill_id: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    // 1. Project-level locations (if workspace_path provided)
    if let Some(ref ws) = workspace_path {
        let ws_path = Path::new(ws);
        let project_dirs = [
            ws_path.join(".opencode/skills"),
            ws_path.join(".claude/skills"),
            ws_path.join(".agents/skills"),
        ];
        for dir in &project_dirs {
            let candidate = dir.join(&skill_id).join("SKILL.md");
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    // 2. Global locations
    if let Some(home) = dirs::home_dir() {
        let global_dirs = [
            home.join(".config/opencode/skills"),
            home.join(".claude/skills"),
            home.join(".agents/skills"),
        ];
        for dir in &global_dirs {
            let candidate = dir.join(&skill_id).join("SKILL.md");
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    Err(format!("SKILL.md not found for '{}'", skill_id))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
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
        let content = format!(
            "---\nname: {}\ndescription: {}\n---\n\n# Body\n",
            name, desc
        );
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
        fs::write(
            tmp.path().join("SKILL.md"),
            "---\ndescription: only desc\n---\n",
        )
        .unwrap();
        assert!(parse_frontmatter(tmp.path()).is_none());
    }

    #[test]
    fn parse_frontmatter_invalid_returns_none() {
        let tmp = TempDir::new().unwrap();
        // No frontmatter delimiters at all
        fs::write(tmp.path().join("SKILL.md"), "no frontmatter here\n").unwrap();
        assert!(parse_frontmatter(tmp.path()).is_none());
    }

    fn write_skill_dir(parent: &Path, id: &str, name: &str, desc: &str) {
        let dir = parent.join(id);
        fs::create_dir_all(&dir).unwrap();
        write_skill_md(&dir, name, desc);
    }

    #[test]
    fn list_skills_with_status_returns_installed_only() {
        let skills = TempDir::new().unwrap();

        // Two skill folders — one with valid SKILL.md, one without
        write_skill_dir(skills.path(), "marketing-brand-voice", "Brand Voice", "from install");
        fs::create_dir_all(skills.path().join("incomplete-skill")).unwrap();

        let result = list_skills_in_dir(skills.path());

        assert_eq!(result.len(), 1, "only the skill with SKILL.md should be enumerated");
        let entry = &result[0];
        assert_eq!(entry.meta.id, "marketing-brand-voice");
        assert_eq!(entry.meta.name, "Brand Voice");
        assert_eq!(entry.meta.description, "from install");
        assert_eq!(entry.meta.category, "Marketing");
        assert!(entry.status.installed);
        assert!(!entry.status.needs_update);
    }

    #[test]
    fn list_skills_with_status_skips_dotfiles_and_files() {
        let skills = TempDir::new().unwrap();

        // Valid skill
        write_skill_dir(skills.path(), "valid-skill", "Valid", "ok");
        // Hidden directory — should be skipped
        fs::create_dir_all(skills.path().join(".hidden")).unwrap();
        write_skill_md(&skills.path().join(".hidden"), "Hidden", "skipped");
        // Loose files — should be skipped
        fs::write(skills.path().join(".DS_Store"), b"junk").unwrap();
        fs::write(skills.path().join("README.md"), b"loose readme").unwrap();

        let result = list_skills_in_dir(skills.path());

        let ids: Vec<&str> = result.iter().map(|s| s.meta.id.as_str()).collect();
        assert_eq!(ids, vec!["valid-skill"]);
    }

    #[test]
    fn list_skills_in_dir_returns_empty_for_missing_dir() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("does-not-exist");
        let result = list_skills_in_dir(&missing);
        assert!(result.is_empty());
    }
}
