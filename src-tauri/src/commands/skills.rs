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

/// Compute SHA256 over all files in `dir` (sorted by relative path).
/// Returns hex digest string.
pub fn compute_dir_checksum(dir: &Path) -> Result<String, String> {
    let mut paths: Vec<PathBuf> = vec![];
    collect_files(dir, dir, &mut paths)?;
    paths.sort();

    let mut hasher = Sha256::new();
    for path in &paths {
        let full = dir.join(path);
        let data = fs::read(&full).map_err(|e| format!("Failed to read {:?}: {}", full, e))?;
        hasher.update(&data);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Recursively collect all non-hidden files under `root`, appending relative paths to `out`.
fn collect_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read dir {:?}: {}", dir, e))?;
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
            let rel = path
                .strip_prefix(root)
                .map_err(|_| format!("strip_prefix failed: {:?}", path))?;
            out.push(rel.to_path_buf());
        }
    }
    Ok(())
}

// ── Path resolution ──────────────────────────────────────────────────────────

/// `~/.config/opencode/skills` — the OpenCode global skills directory.
fn opencode_skills_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".config").join("opencode").join("skills"))
}

/// Resolve the `resources/skill-templates/` directory from the Tauri app handle.
fn resolve_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let candidates = vec![
        resource_dir.join("resources").join("skill-templates"),
        resource_dir.join("skill-templates"),
    ];

    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "skill-templates directory not found in resources".to_string())
}

// ── Recursive copy ────────────────────────────────────────────────────────────

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err(format!("Source does not exist: {:?}", from));
    }
    fs::create_dir_all(to).map_err(|e| format!("create_dir_all {:?}: {}", to, e))?;
    for entry in fs::read_dir(from)
        .map_err(|e| format!("read_dir {:?}: {}", from, e))?
        .flatten()
    {
        let file_type = entry
            .file_type()
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
        if !path.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') {
            continue;
        }

        let (name, description) = match parse_frontmatter(&path) {
            Some(pair) => pair,
            None => {
                eprintln!("[skills] Skipping '{}': failed to parse SKILL.md", id);
                continue;
            }
        };

        let category = derive_category(&id).to_string();
        let meta = SkillMeta {
            id: id.clone(),
            name,
            description,
            category,
        };

        let install_dir = skills_dir.join(&id);
        let checksum_file = install_dir.join(".coworkz-checksum");

        let status = if !checksum_file.exists() {
            SkillStatus {
                installed: false,
                needs_update: false,
            }
        } else {
            let installed_checksum = fs::read_to_string(&checksum_file).unwrap_or_default();
            let bundled_checksum = compute_dir_checksum(&path).unwrap_or_default();
            let up_to_date = installed_checksum.trim() == bundled_checksum.trim();
            SkillStatus {
                installed: true,
                needs_update: !up_to_date,
            }
        };

        result.push(SkillWithStatus { meta, status });
    }

    // Sort by category then name for stable UI ordering
    result.sort_by(|a, b| {
        a.meta
            .category
            .cmp(&b.meta.category)
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

#[tauri::command]
pub fn skills_get_template_path(app: AppHandle, skill_id: String) -> Result<String, String> {
    let templates_dir = resolve_templates_dir(&app)?;
    let skill_md = templates_dir.join(&skill_id).join("SKILL.md");
    if !skill_md.exists() {
        return Err(format!("SKILL.md not found for '{}'", skill_id));
    }
    Ok(skill_md.to_string_lossy().to_string())
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
        assert_eq!(
            derive_category("enterprise-search-strategy"),
            "Enterprise"
        );
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
