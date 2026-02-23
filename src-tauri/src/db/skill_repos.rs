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
        params![
            repo.id,
            repo.url,
            repo.name,
            repo.branch,
            repo.auth_token_key,
            repo.last_synced_at,
            repo.last_sync_error,
            repo.created_at
        ],
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
        |row| {
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
        },
    )
    .ok()
}

pub fn get_skill_repo_by_url(conn: &Connection, url: &str) -> Option<StoredSkillRepo> {
    conn.query_row(
        "SELECT id, url, name, branch, auth_token_key, last_synced_at, last_sync_error, created_at FROM skill_repos WHERE url = ?1",
        params![url],
        |row| {
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
        },
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

pub fn save_repo_skills(
    conn: &Connection,
    repo_id: &str,
    skills: &[StoredRepoSkill],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM repo_skills WHERE repo_id = ?1",
        params![repo_id],
    )
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
        Some(id) => stmt
            .query_map(params![id], |row| {
                Ok(StoredRepoSkill {
                    repo_id: row.get(0)?,
                    skill_path: row.get(1)?,
                    skill_id: row.get(2)?,
                    name: row.get(3)?,
                    description: row.get(4)?,
                    category: row.get(5)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect(),
        None => stmt
            .query_map([], |row| {
                Ok(StoredRepoSkill {
                    repo_id: row.get(0)?,
                    skill_path: row.get(1)?,
                    skill_id: row.get(2)?,
                    name: row.get(3)?,
                    description: row.get(4)?,
                    category: row.get(5)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect(),
    };
    rows
}
