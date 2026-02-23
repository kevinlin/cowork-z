use crate::commands::skills::{compute_dir_checksum, copy_dir_recursive};
use crate::db::skill_repos::{self, StoredSkillRepo};
use crate::db::DbState;
use crate::git_ops;
use crate::skill_discovery;
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
    pub status: String,
    pub error: Option<String>,
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("skill-repo-cache")
}

fn repo_cache_dir(app: &AppHandle, repo_url: &str) -> PathBuf {
    cache_dir(app).join(git_ops::derive_cache_dir_name(repo_url))
}

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
pub fn skill_repos_list(db: State<'_, DbState>) -> Result<Vec<SkillRepo>, String> {
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
    if !git_ops::is_git_available() {
        return Err(
            "Git is not installed or not found on PATH. Please install Git and try again."
                .to_string(),
        );
    }

    // Clean up any existing repo with the same URL (leftover from previous add/remove)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = skill_repos::get_skill_repo_by_url(&conn, &url) {
            if let Some(ref key) = existing.auth_token_key {
                let _ = crate::secure_storage::delete_api_key(key);
            }
            let _ = skill_repos::remove_skill_repo(&conn, &existing.id);
        }
    }

    let dest = repo_cache_dir(&app, &url);
    if dest.exists() {
        let _ = fs::remove_dir_all(&dest);
    }

    let id = Uuid::new_v4().to_string();
    let branch = branch.unwrap_or_else(|| "main".to_string());
    let name = git_ops::derive_repo_name(&url);
    let now = chrono::Utc::now().to_rfc3339();

    let auth_token_key = if let Some(ref token) = auth_token {
        let key = format!("skill-repo-{}", id);
        crate::secure_storage::store_api_key(&key, token)?;
        Some(key)
    } else {
        None
    };

    fs::create_dir_all(dest.parent().unwrap())
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    git_ops::clone_repo(&url, &branch, &dest, auth_token.as_deref())?;

    let discovered = skill_discovery::discover_skills(&id, &dest, &url);

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
    let repo = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::get_skill_repo(&conn, &id)
    };

    if let Some(ref r) = repo {
        if let Some(ref key) = r.auth_token_key {
            let _ = crate::secure_storage::delete_api_key(key);
        }
    }

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::remove_skill_repo(&conn, &id)?;
    }

    let cache_url = repo.as_ref().map(|r| r.url.as_str()).unwrap_or("");
    let cache = repo_cache_dir(&app, cache_url);
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

    let _ = app.emit(
        "skills:sync_progress",
        SyncProgress {
            repo_id: id.clone(),
            status: "syncing".to_string(),
            error: None,
        },
    );

    let token = if let Some(ref key) = repo.auth_token_key {
        crate::secure_storage::get_api_key(key).ok().flatten()
    } else {
        None
    };

    let cache = repo_cache_dir(&app, &repo.url);
    let now = chrono::Utc::now().to_rfc3339();

    let sync_result = if cache.exists() {
        git_ops::pull_repo(&cache, token.as_deref())
    } else {
        fs::create_dir_all(cache.parent().unwrap())
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
        git_ops::clone_repo(&repo.url, &repo.branch, &cache, token.as_deref())
    };

    match sync_result {
        Ok(()) => {
            let discovered = skill_discovery::discover_skills(&id, &cache, &repo.url);
            {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                skill_repos::update_sync_status(&conn, &id, Some(&now), None)?;
                skill_repos::save_repo_skills(&conn, &id, &discovered)?;
            }

            let _ = app.emit(
                "skills:sync_progress",
                SyncProgress {
                    repo_id: id,
                    status: "synced".to_string(),
                    error: None,
                },
            );
        }
        Err(e) => {
            {
                let conn = db.conn.lock().map_err(|e2| e2.to_string())?;
                let _ = skill_repos::update_sync_status(&conn, &id, None, Some(&e));
            }

            let _ = app.emit(
                "skills:sync_progress",
                SyncProgress {
                    repo_id: id,
                    status: "error".to_string(),
                    error: Some(e.clone()),
                },
            );

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

    let repos = skill_repos::list_skill_repos(&conn);
    let repo_names: std::collections::HashMap<String, String> =
        repos.into_iter().map(|r| (r.id, r.name)).collect();

    let skills = skill_repos::list_repo_skills(&conn, repo_id.as_deref());

    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;

    let result = skills
        .into_iter()
        .map(|s| {
            let skill_dir = install_dir.join(&s.skill_id);
            let checksum_file = skill_dir.join(".coworkz-checksum");
            let installed = checksum_file.exists();

            RepoSkill {
                repo_id: s.repo_id.clone(),
                repo_name: repo_names.get(&s.repo_id).cloned().unwrap_or_default(),
                skill_path: s.skill_path,
                skill_id: s.skill_id,
                name: s.name,
                description: s.description,
                category: s.category,
                installed,
                needs_update: false,
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

    let skill = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        skill_repos::list_repo_skills(&conn, Some(&repo_id))
            .into_iter()
            .find(|s| s.skill_path == skill_path)
            .ok_or_else(|| format!("Skill not found: {}", skill_path))?
    };

    let cache = repo_cache_dir(&app, &repo.url);
    let source = cache.join(&skill.skill_path);
    if !source.exists() {
        return Err(format!(
            "Skill source directory not found: {}",
            source.display()
        ));
    }

    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;
    let dest = install_dir.join(&skill.skill_id);

    fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Failed to create install dir: {}", e))?;

    // Handle single-file skills (commands) vs directory skills
    if source.is_file() {
        fs::create_dir_all(&dest).map_err(|e| format!("Failed to create skill dir: {}", e))?;
        let dest_file = dest.join("SKILL.md");
        fs::copy(&source, &dest_file)
            .map_err(|e| format!("Failed to copy skill file: {}", e))?;
    } else {
        copy_dir_recursive(&source, &dest)?;
    }

    let checksum = if source.is_file() {
        compute_dir_checksum(&dest)?
    } else {
        compute_dir_checksum(&source)?
    };
    fs::write(dest.join(".coworkz-checksum"), &checksum)
        .map_err(|e| format!("Failed to write checksum: {}", e))?;

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
pub fn skills_list_installed(target_folder: Option<String>) -> Result<Vec<InstalledSkill>, String> {
    let target = target_folder.as_deref().unwrap_or("opencode");
    let install_dir = resolve_target_folder(target)?;

    if !install_dir.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let entries =
        fs::read_dir(&install_dir).map_err(|e| format!("Failed to read skills dir: {}", e))?;

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

        let category = crate::commands::skills::derive_category(&dir_name).to_string();

        let source_file = path.join(".coworkz-source");
        let (source_repo_url, source_repo_name) = if source_file.exists() {
            let content = fs::read_to_string(&source_file).unwrap_or_default();
            let meta: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
            (
                meta.get("repo_url")
                    .and_then(|v| v.as_str())
                    .map(String::from),
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
        return Err(format!(
            "Skill directory not found: {}",
            skill_dir.display()
        ));
    }

    fs::remove_dir_all(&skill_dir).map_err(|e| format!("Failed to delete skill: {}", e))?;

    let _ = app.emit("skills:changed", ());
    Ok(())
}
