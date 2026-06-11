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
///
/// Credentials are passed transiently on the `git pull <url>` invocation and
/// are never written to `.git/config` (technical review finding #8). Any
/// token persisted into the remote URL by older app versions is scrubbed.
pub fn pull_repo(repo_dir: &Path, auth_token: Option<&str>) -> Result<(), String> {
    // Scrub credentials that a previous version may have persisted via
    // `git remote set-url` so they no longer sit in cleartext on disk.
    let current_url = get_remote_url(repo_dir)?;
    let clean_url = strip_credentials(&current_url);
    if clean_url != current_url {
        set_remote_url(repo_dir, &clean_url)?;
    }

    let repo_dir_str = repo_dir.to_string_lossy();
    let mut args: Vec<String> = vec![
        "-C".to_string(),
        repo_dir_str.to_string(),
        "pull".to_string(),
        "--ff-only".to_string(),
    ];

    if auth_token.is_some() {
        // Pull from an explicit URL (token only in transient argv, like
        // clone_repo) instead of rewriting the configured remote.
        let effective_url = inject_token(&clean_url, auth_token);
        let branch = get_current_branch(repo_dir)?;
        args.push(effective_url);
        args.push(branch);
    }

    let output = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run git pull: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git pull failed: {}", stderr.trim()));
    }
    Ok(())
}

fn get_current_branch(repo_dir: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "rev-parse",
            "--abbrev-ref",
            "HEAD",
        ])
        .output()
        .map_err(|e| format!("Failed to get current branch: {}", e))?;
    if !output.status.success() {
        return Err("Failed to determine current branch".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Remove any `user[:password]@` credentials from an HTTPS URL.
/// `https://oauth2:glpat-x@host/repo` -> `https://host/repo`
fn strip_credentials(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        let authority_end = rest.find('/').unwrap_or(rest.len());
        if let Some(at) = rest[..authority_end].rfind('@') {
            return format!("https://{}", &rest[at + 1..]);
        }
    }
    url.to_string()
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
/// GitHub PATs: `https://github.com/owner/repo` -> `https://{token}@github.com/owner/repo`
/// GitLab PATs (`glpat-` prefix): uses `oauth2:{token}@` as required by GitLab HTTP auth.
/// SSH URLs and None tokens are returned unchanged.
fn inject_token(url: &str, token: Option<&str>) -> String {
    match token {
        Some(t) if url.starts_with("https://") => {
            let credentials = if t.starts_with("glpat-") {
                format!("oauth2:{}", t)
            } else {
                t.to_string()
            };
            url.replacen("https://", &format!("https://{}@", credentials), 1)
        }
        _ => url.to_string(),
    }
}

/// Derive a filesystem-safe cache directory name from a Git URL.
/// `https://github.com/anthropics/knowledge-work-plugins.git` -> `anthropics_knowledge-work-plugins`
pub fn derive_cache_dir_name(url: &str) -> String {
    derive_repo_name(url).replace('/', "_")
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
    fn test_inject_token_gitlab_pat() {
        let url = "https://codehub.zuehlke.com/ai-sdlc/zapac-agent-skills";
        let result = inject_token(url, Some("glpat-XXX"));
        assert_eq!(
            result,
            "https://oauth2:glpat-XXX@codehub.zuehlke.com/ai-sdlc/zapac-agent-skills"
        );
    }

    #[test]
    fn test_strip_credentials_plain_token() {
        assert_eq!(
            strip_credentials("https://my_token@github.com/owner/repo.git"),
            "https://github.com/owner/repo.git"
        );
    }

    #[test]
    fn test_strip_credentials_user_password() {
        assert_eq!(
            strip_credentials("https://oauth2:glpat-XXX@codehub.zuehlke.com/ai-sdlc/zapac-agent-skills"),
            "https://codehub.zuehlke.com/ai-sdlc/zapac-agent-skills"
        );
    }

    #[test]
    fn test_strip_credentials_clean_url_unchanged() {
        let url = "https://github.com/owner/repo.git";
        assert_eq!(strip_credentials(url), url);
    }

    #[test]
    fn test_strip_credentials_ssh_unchanged() {
        let url = "git@github.com:owner/repo.git";
        assert_eq!(strip_credentials(url), url);
    }

    #[test]
    fn test_strip_credentials_at_in_path_unchanged() {
        // '@' after the authority section must not be treated as credentials
        let url = "https://github.com/owner/repo@v2.git";
        assert_eq!(strip_credentials(url), url);
    }

    #[test]
    fn test_strip_credentials_roundtrip_with_inject() {
        let url = "https://github.com/owner/repo.git";
        let injected = inject_token(url, Some("tok"));
        assert_eq!(strip_credentials(&injected), url);
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

    #[test]
    fn test_derive_cache_dir_name_github() {
        assert_eq!(
            derive_cache_dir_name("https://github.com/anthropics/knowledge-work-plugins.git"),
            "anthropics_knowledge-work-plugins"
        );
    }

    #[test]
    fn test_derive_cache_dir_name_ssh() {
        assert_eq!(
            derive_cache_dir_name("git@github.com:owner/repo.git"),
            "owner_repo"
        );
    }

    #[test]
    fn test_derive_cache_dir_name_fallback() {
        assert_eq!(
            derive_cache_dir_name("https://custom.host/myrepo"),
            "myrepo"
        );
    }
}
