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
            "--depth",
            "1",
            "--branch",
            branch,
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
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "remote",
            "get-url",
            "origin",
        ])
        .output()
        .map_err(|e| format!("Failed to get remote URL: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn set_remote_url(repo_dir: &Path, url: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "remote",
            "set-url",
            "origin",
            url,
        ])
        .output()
        .map_err(|e| format!("Failed to set remote URL: {}", e))?;
    if !output.status.success() {
        return Err("Failed to update remote URL".to_string());
    }
    Ok(())
}

/// Inject a personal access token into an HTTPS Git URL.
/// `https://github.com/owner/repo` -> `https://{token}@github.com/owner/repo`
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
/// `https://github.com/anthropics/knowledge-work-plugins.git` -> `anthropics/knowledge-work-plugins`
pub fn derive_repo_name(url: &str) -> String {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    if let Some(rest) = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("https://gitlab.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .or_else(|| trimmed.strip_prefix("git@gitlab.com:"))
    {
        return rest.to_string();
    }
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
