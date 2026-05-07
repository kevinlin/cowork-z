//! Filesystem helpers shared across command modules.

use std::fs;
use std::path::Path;

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
}
