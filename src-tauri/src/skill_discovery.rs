use crate::commands::skills::{derive_category, parse_frontmatter};
use crate::db::skill_repos::StoredRepoSkill;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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
pub fn discover_skills(repo_id: &str, repo_dir: &Path, repo_url: &str) -> Vec<StoredRepoSkill> {
    if is_anthropics_repo(repo_url) {
        return discover_anthropics_skills(repo_id, repo_dir);
    }

    if is_openai_skills_repo(repo_url) {
        return discover_openai_skills(repo_id, repo_dir);
    }

    let manifest_path = repo_dir.join("skills.json");
    if manifest_path.exists() {
        if let Ok(skills) = discover_from_manifest(repo_id, repo_dir, &manifest_path) {
            return skills;
        }
    }

    discover_by_convention(repo_id, repo_dir)
}

/// Convention-based: recursively find directories containing SKILL.md.
fn discover_by_convention(repo_id: &str, repo_dir: &Path) -> Vec<StoredRepoSkill> {
    let mut results = Vec::new();
    find_skill_dirs(repo_dir, repo_dir, &mut results, repo_id);
    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    results
}

fn find_skill_dirs(root: &Path, dir: &Path, results: &mut Vec<StoredRepoSkill>, repo_id: &str) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.exists() {
                let rel_path = path.strip_prefix(root).unwrap_or(&path);
                let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                let skill_id = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                let (parsed_name, parsed_desc) =
                    parse_frontmatter(&path).unwrap_or_else(|| (skill_id.clone(), String::new()));

                let category = derive_category(&skill_id).to_string();

                results.push(StoredRepoSkill {
                    repo_id: repo_id.to_string(),
                    skill_path: rel_str,
                    skill_id,
                    name: parsed_name,
                    description: parsed_desc,
                    category,
                });
            } else {
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
    let content =
        fs::read_to_string(manifest_path).map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: SkillManifest =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let mut results = Vec::new();
    for entry in manifest.skills {
        let skill_dir = repo_dir.join(&entry.path);
        if !skill_dir.join("SKILL.md").exists() {
            continue;
        }

        let skill_id = skill_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let (fm_name, fm_desc) =
            parse_frontmatter(&skill_dir).unwrap_or_else(|| (skill_id.clone(), String::new()));

        results.push(StoredRepoSkill {
            repo_id: repo_id.to_string(),
            skill_path: entry.path,
            skill_id,
            name: entry.name.unwrap_or(fm_name),
            description: entry.description.unwrap_or(fm_desc),
            category: entry.category.unwrap_or_else(|| "General".to_string()),
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
    let mut seen_names: HashMap<String, usize> = HashMap::new();

    for (upstream_dir, local_prefix) in ANTHROPICS_CATEGORY_MAP {
        let category_dir = repo_dir.join(upstream_dir);
        if !category_dir.is_dir() {
            continue;
        }

        // Prefer skills directories (richer content)
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

                    let category = derive_category(&skill_id).to_string();

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

        // Commands (single .md files) — only if no skill with same name
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
                        continue;
                    }

                    let skill_id = format!("{}-{}", local_prefix, cmd_name);
                    let rel_path = path.strip_prefix(repo_dir).unwrap_or(&path);
                    let rel_str = rel_path.to_string_lossy().replace('\\', "/");

                    let content = fs::read_to_string(&path).unwrap_or_default();
                    let (name, desc) = parse_command_frontmatter(&content)
                        .unwrap_or_else(|| (skill_id.clone(), String::new()));

                    let category = derive_category(&skill_id).to_string();

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

// --- openai/skills adapter ---

fn is_openai_skills_repo(url: &str) -> bool {
    let normalized = url.to_lowercase();
    normalized.contains("github.com/openai/skills")
        || normalized.contains("github.com:openai/skills")
}

/// Skills in openai/skills live under `skills/.curated/`, `skills/.system/`,
/// and potentially `skills/.experimental/`. Each subdirectory contains a
/// SKILL.md. The dotfile-prefixed parent directories (`.curated`, `.system`)
/// are used as category labels.
const OPENAI_SKILL_SUBDIRS: &[(&str, &str)] = &[
    (".curated", "Curated"),
    (".system", "System"),
    (".experimental", "Experimental"),
];

fn discover_openai_skills(repo_id: &str, repo_dir: &Path) -> Vec<StoredRepoSkill> {
    let mut results = Vec::new();
    let skills_root = repo_dir.join("skills");

    if !skills_root.is_dir() {
        return discover_by_convention(repo_id, repo_dir);
    }

    for (subdir_name, category_label) in OPENAI_SKILL_SUBDIRS {
        let subdir = skills_root.join(subdir_name);
        if !subdir.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&subdir) {
            Ok(e) => e,
            Err(_) => continue,
        };

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

            let rel_path = path.strip_prefix(repo_dir).unwrap_or(&path);
            let rel_str = rel_path.to_string_lossy().replace('\\', "/");

            let skill_id = dir_name.clone();

            let (name, desc) =
                parse_frontmatter(&path).unwrap_or_else(|| (skill_id.clone(), String::new()));

            results.push(StoredRepoSkill {
                repo_id: repo_id.to_string(),
                skill_path: rel_str,
                skill_id,
                name,
                description: desc,
                category: category_label.to_string(),
            });
        }
    }

    results.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    results
}

/// Parse frontmatter from a command .md file.
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
