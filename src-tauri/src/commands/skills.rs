//! Skills Catalog — list bundled skill templates and install to OpenCode global skills dir.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

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
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir {:?}: {}", dir, e))?;
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

pub fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
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
    list_skills_in_dirs(&templates_dir, &skills_dir)
}

/// Enumerate skills from bundled templates and the global install dir.
/// Bundled-template entries take precedence on ID collision so that
/// `needs_update` semantics are preserved for skills that exist in both.
pub fn list_skills_in_dirs(templates_dir: &Path, skills_dir: &Path) -> Vec<SkillWithStatus> {
    let mut result: Vec<SkillWithStatus> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Pass 1 — bundled templates with install-status detection
    if let Ok(entries) = fs::read_dir(templates_dir) {
        for (id, path) in scan_skill_dirs(entries) {
            let Some((name, description)) = parse_frontmatter(&path) else {
                eprintln!("[skills] Skipping '{}': failed to parse SKILL.md", id);
                continue;
            };
            let status = detect_install_status(&path, &skills_dir.join(&id));
            result.push(make_skill(id.clone(), name, description, status));
            seen.insert(id);
        }
    } else {
        eprintln!("[skills] Failed to read templates dir: {:?}", templates_dir);
    }

    // Pass 2 — custom skills not covered by bundled templates
    if let Ok(entries) = fs::read_dir(skills_dir) {
        for (id, path) in scan_skill_dirs(entries) {
            if seen.contains(&id) {
                continue;
            }
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

/// Determine install status by checking the skills dir for a copy or symlink.
fn detect_install_status(template_path: &Path, install_dir: &Path) -> SkillStatus {
    let checksum_file = install_dir.join(".coworkz-checksum");
    if checksum_file.exists() {
        // Copy-based install (Windows / legacy)
        let installed = fs::read_to_string(&checksum_file).unwrap_or_default();
        let bundled = compute_dir_checksum(template_path).unwrap_or_default();
        SkillStatus {
            installed: true,
            needs_update: installed.trim() != bundled.trim(),
        }
    } else if install_dir.join("SKILL.md").exists() {
        // Symlink install (macOS/Linux) — always up-to-date via git pull
        SkillStatus {
            installed: true,
            needs_update: false,
        }
    } else {
        SkillStatus {
            installed: false,
            needs_update: false,
        }
    }
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
    install_skill(&app, &skill_id)?;
    let _ = app.emit("skills:changed", ());
    Ok(())
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

/// Resolve the SKILL.md path for a skill, searching project-level, global,
/// and bundled template locations in priority order.
#[tauri::command]
pub fn skills_get_skill_file_path(
    app: AppHandle,
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

    // 3. Fallback to bundled template
    if let Ok(templates_dir) = resolve_templates_dir(&app) {
        let template = templates_dir.join(&skill_id).join("SKILL.md");
        if template.exists() {
            return Ok(template.to_string_lossy().to_string());
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

    fn write_skill_dir(parent: &Path, id: &str, name: &str, desc: &str) {
        let dir = parent.join(id);
        fs::create_dir_all(&dir).unwrap();
        write_skill_md(&dir, name, desc);
    }

    #[test]
    fn test_list_skills_in_dirs_includes_custom_skills_in_global_dir() {
        let templates = TempDir::new().unwrap();
        let skills = TempDir::new().unwrap();

        // A bundled template that is NOT installed
        write_skill_dir(templates.path(), "marketing-brand-voice", "Brand Voice", "bundled");

        // A user-copied custom skill — only present in the global skills dir
        write_skill_dir(skills.path(), "my-custom-skill", "Custom", "hand-rolled");

        let result = list_skills_in_dirs(templates.path(), skills.path());
        let ids: Vec<&str> = result.iter().map(|s| s.meta.id.as_str()).collect();

        assert!(ids.contains(&"my-custom-skill"), "custom skill should be enumerated");
        let custom = result.iter().find(|s| s.meta.id == "my-custom-skill").unwrap();
        assert!(custom.status.installed);
        assert!(!custom.status.needs_update);
        assert_eq!(custom.meta.category, "General");

        let bundled = result.iter().find(|s| s.meta.id == "marketing-brand-voice").unwrap();
        assert!(!bundled.status.installed, "uninstalled template stays uninstalled");
    }

    #[test]
    fn test_list_skills_in_dirs_template_takes_precedence_over_custom() {
        let templates = TempDir::new().unwrap();
        let skills = TempDir::new().unwrap();

        // Bundled template "shared-id" with checksum-based install present
        write_skill_dir(templates.path(), "shared-id", "Template Name", "from template");
        let installed = skills.path().join("shared-id");
        fs::create_dir_all(&installed).unwrap();
        write_skill_md(&installed, "Template Name", "from template");
        // Pre-compute matching checksum so the install reports up-to-date
        let checksum = compute_dir_checksum(&templates.path().join("shared-id")).unwrap();
        fs::write(installed.join(".coworkz-checksum"), &checksum).unwrap();

        let result = list_skills_in_dirs(templates.path(), skills.path());
        let entry = result.iter().find(|s| s.meta.id == "shared-id").unwrap();
        assert_eq!(entry.meta.name, "Template Name");
        assert!(entry.status.installed);
        assert!(!entry.status.needs_update, "matching checksum means up-to-date");
    }

    #[test]
    fn test_list_skills_in_dirs_skips_custom_entries_without_skill_md() {
        let templates = TempDir::new().unwrap();
        let skills = TempDir::new().unwrap();
        fs::create_dir_all(skills.path().join("not-a-skill")).unwrap(); // no SKILL.md
        fs::create_dir_all(skills.path().join(".hidden")).unwrap();

        let result = list_skills_in_dirs(templates.path(), skills.path());
        assert!(result.is_empty());
    }
}
