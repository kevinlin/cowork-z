// src-tauri/src/commands/packs.rs
//! Workspace Starter Packs — catalog, installation, and Tauri command wrappers.
//! Ported from frumu-ai/tandem src-tauri/src/packs.rs

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PackMeta {
    pub id: String,
    pub title: String,
    pub description: String,
    pub complexity: String,
    pub time_estimate: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackInstallResult {
    pub installed_path: String,
}

// ── Catalog ──────────────────────────────────────────────────────────────────

pub fn list_packs() -> Vec<PackMeta> {
    vec![
        PackMeta {
            id: "data-visualization-pack".to_string(),
            title: "Data Visualization".to_string(),
            description: "Create professional charts with Matplotlib, Seaborn, and Plotly".to_string(),
            complexity: "Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["data".to_string(), "visualization".to_string()],
        },
        PackMeta {
            id: "finance-analysis-pack".to_string(),
            title: "Finance Analysis".to_string(),
            description: "Automate financial reporting with P&L and variance analysis".to_string(),
            complexity: "Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["finance".to_string(), "analysis".to_string()],
        },
        PackMeta {
            id: "legal-research-pack".to_string(),
            title: "Legal Research".to_string(),
            description: "Analyze contracts and synthesize case notes".to_string(),
            complexity: "Intermediate-Advanced".to_string(),
            time_estimate: "20-25 min".to_string(),
            tags: vec!["legal".to_string(), "analysis".to_string()],
        },
        PackMeta {
            id: "micro-drama-script-studio-pack".to_string(),
            title: "Micro-Drama Script Studio".to_string(),
            description: "Create short-form scripts with structured workflows".to_string(),
            complexity: "Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["writing".to_string(), "creative".to_string()],
        },
        PackMeta {
            id: "research-synthesis-pack".to_string(),
            title: "Research Synthesis".to_string(),
            description: "Synthesize research across multiple documents".to_string(),
            complexity: "Intermediate-Advanced".to_string(),
            time_estimate: "20-25 min".to_string(),
            tags: vec!["research".to_string(), "analysis".to_string()],
        },
        PackMeta {
            id: "security-playbook-pack".to_string(),
            title: "Security Playbook".to_string(),
            description: "Build a practical security runbook and checklist".to_string(),
            complexity: "Intermediate".to_string(),
            time_estimate: "20-25 min".to_string(),
            tags: vec!["security".to_string(), "compliance".to_string()],
        },
        PackMeta {
            id: "web-research-refresh-pack".to_string(),
            title: "Web Research Refresh".to_string(),
            description: "Verify stale facts and refresh docs with sources".to_string(),
            complexity: "Beginner-Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["research".to_string(), "docs".to_string()],
        },
        PackMeta {
            id: "web-starter-audit-pack".to_string(),
            title: "Web Starter Audit".to_string(),
            description: "Audit a web project for UX, a11y, and quality".to_string(),
            complexity: "Beginner-Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["audit".to_string(), "quality".to_string()],
        },
    ]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Recursively copy `from` directory to `to` (created if needed).
/// Uses `.flatten()` to skip unreadable entries rather than hard-failing.
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
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

/// Find the packs/ and pack-docs/ root directories.
///
/// Pack content is copied directly into `src-tauri/resources/` at development
/// time (from the repo-root `workspace-packs/` directory) and bundled into the
/// app resources at build time via `tauri.conf.json`.  The Tauri resource
/// directory layout places them at `<resource_dir>/resources/packs` (and
/// `pack-docs`).
fn resolve_pack_sources(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let packs_root = resource_dir.join("resources").join("packs");
    if !packs_root.exists() {
        return Err(format!(
            "Pack templates not found at {:?}. Ensure workspace-packs/ contents \
             have been copied to src-tauri/resources/.",
            packs_root
        ));
    }

    let pack_docs_root = resource_dir.join("resources").join("pack-docs");
    if !pack_docs_root.exists() {
        return Err(format!(
            "Pack docs not found at {:?}. Ensure workspace-packs/ contents \
             have been copied to src-tauri/resources/.",
            pack_docs_root
        ));
    }

    Ok((packs_root, pack_docs_root))
}

/// Return `destination/pack_id`, incrementing to `-2`, `-3`, … if already exists.
fn choose_destination_dir(destination_dir: &Path, pack_id: &str) -> Result<PathBuf, String> {
    let base_name = pack_id;
    let mut candidate = destination_dir.join(base_name);
    if !candidate.exists() {
        return Ok(candidate);
    }

    for i in 2..=100 {
        candidate = destination_dir.join(format!("{}-{}", base_name, i));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Failed to choose a destination directory (too many conflicts)".to_string())
}

/// Default install root: `~/Cowork-Z Packs`, falling back to `{app_data_dir}/packs`.
fn default_pack_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(home) = app.path().home_dir() {
        return Ok(home.join("Cowork-Z Packs"));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    Ok(app_data_dir.join("packs"))
}

// ── Core install logic ────────────────────────────────────────────────────────

pub fn install_pack(
    app: &AppHandle,
    pack_id: &str,
    destination_dir: &str,
) -> Result<PackInstallResult, String> {
    // Validate pack id exists (prevents path traversal and gives nicer errors).
    if !list_packs().iter().any(|p| p.id == pack_id) {
        return Err(format!("Unknown pack: {}", pack_id));
    }

    let dest_root = PathBuf::from(destination_dir);
    if !dest_root.exists() {
        fs::create_dir_all(&dest_root)
            .map_err(|e| format!("Failed to create destination {:?}: {}", dest_root, e))?;
    }
    if !dest_root.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    let (packs_root, pack_docs_root) = resolve_pack_sources(app)?;
    let source_pack_dir = packs_root.join(pack_id);
    if !source_pack_dir.exists() {
        return Err(format!(
            "Pack template not found on disk: {:?}",
            source_pack_dir
        ));
    }

    let install_dir = choose_destination_dir(&dest_root, pack_id)?;

    println!(
        "[packs] Installing '{}' from {:?} -> {:?}",
        pack_id, source_pack_dir, install_dir
    );

    copy_dir_recursive(&source_pack_dir, &install_dir)?;

    // Copy documentation files individually (missing files are warnings, not errors).
    let doc_src = pack_docs_root.join(pack_id);
    for doc_file in &[
        "START_HERE.md",
        "PACK_INFO.md",
        "PROMPTS.md",
        "CONTRIBUTING.md",
        "EXPECTED_OUTPUTS.md",
    ] {
        let src_file = doc_src.join(doc_file);
        if src_file.exists() {
            let dest_file = install_dir.join(doc_file);
            if let Err(e) = fs::copy(&src_file, &dest_file) {
                eprintln!(
                    "[packs] Warning: failed to copy {} {:?} -> {:?}: {}",
                    doc_file, src_file, dest_file, e
                );
            }
        }
    }

    Ok(PackInstallResult {
        installed_path: install_dir.to_string_lossy().to_string(),
    })
}

pub fn install_pack_default(app: &AppHandle, pack_id: &str) -> Result<PackInstallResult, String> {
    let root = default_pack_root(app)?;
    install_pack(app, pack_id, &root.to_string_lossy())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn packs_list() -> Vec<PackMeta> {
    list_packs()
}

#[tauri::command]
pub fn packs_install(
    app: AppHandle,
    pack_id: String,
    destination_dir: String,
) -> Result<PackInstallResult, String> {
    install_pack(&app, &pack_id, &destination_dir)
}

#[tauri::command]
pub fn packs_install_default(
    app: AppHandle,
    pack_id: String,
) -> Result<PackInstallResult, String> {
    install_pack_default(&app, &pack_id)
}
