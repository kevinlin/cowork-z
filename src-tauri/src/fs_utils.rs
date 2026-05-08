//! Filesystem helpers shared across command modules.

#[cfg(any(not(unix), test))]
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
#[cfg(any(not(unix), test))]
use std::path::PathBuf;

/// Recursively copy `from` directory to `to` (created if needed).
///
/// Skips entries that are neither regular files nor directories (symlinks,
/// sockets, fifos, etc.). Uses `.flatten()` on `read_dir` to skip unreadable
/// entries rather than hard-failing.
pub fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err(format!("Source does not exist: {:?}", from));
    }

    fs::create_dir_all(to).map_err(|e| format!("Failed to create directory {:?}: {}", to, e))?;

    let entries = fs::read_dir(from).map_err(|e| format!("Failed to read {:?}: {}", from, e))?;
    for entry in entries.flatten() {
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type {:?}: {}", entry.path(), e))?;

        let dest_path = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &dest_path).map_err(|e| {
                format!(
                    "Failed to copy file {:?} -> {:?}: {}",
                    entry.path(),
                    dest_path,
                    e
                )
            })?;
        }
    }

    Ok(())
}

/// Compute SHA256 over all files in `dir` (sorted by relative path).
/// Returns hex digest string. Hidden files (including `.coworkz-checksum`)
/// are skipped so the digest is stable across `.coworkz-checksum` writes.
#[cfg(any(not(unix), test))]
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
#[cfg(any(not(unix), test))]
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn copies_nested_files_and_directories() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();

        fs::write(src.path().join("a.txt"), b"a").unwrap();
        fs::create_dir_all(src.path().join("sub")).unwrap();
        fs::write(src.path().join("sub").join("b.txt"), b"b").unwrap();

        copy_dir_recursive(src.path(), dst.path()).unwrap();

        assert_eq!(fs::read(dst.path().join("a.txt")).unwrap(), b"a");
        assert_eq!(
            fs::read(dst.path().join("sub").join("b.txt")).unwrap(),
            b"b"
        );
    }

    #[test]
    fn errors_when_source_missing() {
        let dst = TempDir::new().unwrap();
        let missing = dst.path().join("does-not-exist");
        let result = copy_dir_recursive(&missing, dst.path());
        assert!(result.is_err());
    }

    #[test]
    fn creates_destination_directory() {
        let src = TempDir::new().unwrap();
        let dst_parent = TempDir::new().unwrap();
        let dst = dst_parent.path().join("new-target");

        fs::write(src.path().join("a.txt"), b"a").unwrap();
        copy_dir_recursive(src.path(), &dst).unwrap();

        assert!(dst.is_dir());
        assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"a");
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
