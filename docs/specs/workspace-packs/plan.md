# Workspace Starter Packs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Workspace Starter Packs feature where Home.tsx becomes a packs browser that lets users install guided, copyable workspace folders and auto-start an AI task.

**Architecture:** Verbatim port of [`frumu-ai/tandem src-tauri/src/packs.rs`](https://github.com/frumu-ai/tandem/blob/main/src-tauri/src/packs.rs) into `src-tauri/src/commands/packs.rs` (3 adaptations: 6-pack catalog, "Cowork-Z Packs" default dir, `println!`/`eprintln!` instead of `tracing`). Wire up three Tauri commands (`packs_list`, `packs_install`, `packs_install_default`), add TypeScript IPC wrappers matching [`frumu-ai/tandem src/lib/tauri.ts`](https://github.com/frumu-ai/tandem/blob/main/src/lib/tauri.ts#L1346-L1376), then rewrite `Home.tsx` to replace the "Example prompts" section with a 2-column packs grid.

**Tech Stack:** Rust (serde, tauri, dirs, std::fs), TypeScript, React, Tauri `invoke()`, `@tauri-apps/plugin-dialog` (via existing `pickFolder()`), Zustand (`useWorkspaceStore`, `useTaskStore`).

---

## Task 1: Create the Rust packs module

**Source:** Verbatim port of [`src-tauri/src/packs.rs` from `frumu-ai/tandem`](https://github.com/frumu-ai/tandem/blob/main/src-tauri/src/packs.rs) with three cowork-z adaptations:
1. Catalog trimmed to the 6 packs that have on-disk content (3 stubs removed)
2. Default install dir changed from `"Tandem Packs"` → `"Cowork-Z Packs"`
3. `tracing::info!`/`tracing::warn!` replaced with `println!`/`eprintln!` (tracing crate not in cowork-z)

**Files:**
- Create: `src-tauri/src/commands/packs.rs`

### Step 1: Create the file

```rust
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
            id: "web-research-refresh-pack".to_string(),
            title: "Web Research Refresh".to_string(),
            description: "Verify stale facts and refresh docs with sources".to_string(),
            complexity: "Beginner-Intermediate".to_string(),
            time_estimate: "15-20 min".to_string(),
            tags: vec!["research".to_string(), "docs".to_string()],
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
            id: "legal-research-pack".to_string(),
            title: "Legal Research".to_string(),
            description: "Analyze contracts and synthesize case notes".to_string(),
            complexity: "Intermediate-Advanced".to_string(),
            time_estimate: "20-25 min".to_string(),
            tags: vec!["legal".to_string(), "analysis".to_string()],
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
/// Searches production bundle paths first, then falls back to the repo's
/// workspace-packs/ directory in debug builds (via CARGO_MANIFEST_DIR).
fn resolve_pack_sources(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;

    let packs_candidates = vec![
        resource_dir.join("resources").join("packs"),
        resource_dir.join("packs"),
        resource_dir
            .join("resources")
            .join("workspace-packs")
            .join("packs"),
        resource_dir.join("workspace-packs").join("packs"),
    ];

    let docs_candidates = vec![
        resource_dir.join("resources").join("pack-docs"),
        resource_dir.join("pack-docs"),
        resource_dir
            .join("resources")
            .join("workspace-packs")
            .join("pack-docs"),
        resource_dir.join("workspace-packs").join("pack-docs"),
    ];

    let packs_root = packs_candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .or_else(|| {
            #[cfg(debug_assertions)]
            {
                let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("workspace-packs")
                    .join("packs");
                if dev.exists() {
                    return Some(dev);
                }
            }
            None
        })
        .ok_or_else(|| {
            format!(
                "Pack templates not found. Looked in: {:?}",
                packs_candidates
            )
        })?;

    let pack_docs_root = docs_candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .or_else(|| {
            #[cfg(debug_assertions)]
            {
                let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("workspace-packs")
                    .join("pack-docs");
                if dev.exists() {
                    return Some(dev);
                }
            }
            None
        })
        .ok_or_else(|| format!("Pack docs not found. Looked in: {:?}", docs_candidates))?;

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
```

### Step 2: Verify it compiles

```bash
cd src-tauri && cargo check
```

Expected: 0 errors. (`dirs` crate is already in `Cargo.toml`.)

### Step 3: Commit

```bash
git add src-tauri/src/commands/packs.rs
git commit -m "feat: add Rust packs module (port of frumu-ai/tandem packs.rs)"
```

---

## Task 2: Wire the module into the Tauri app

**Files:**
- Modify: `src-tauri/src/commands/mod.rs:15`
- Modify: `src-tauri/src/lib.rs:231`
- Modify: `src-tauri/tauri.conf.json:45`

### Step 1: Register the module in `commands/mod.rs`

In `src-tauri/src/commands/mod.rs`, add `pub mod packs;` after line 15 (`pub mod workspaces;`):

```rust
pub mod workspaces;
pub mod packs;
```

### Step 2: Register the three Tauri commands in `lib.rs`

In `src-tauri/src/lib.rs`, after the `// Workspaces` block (lines 224–231), add:

```rust
            // Packs
            commands::packs::packs_list,
            commands::packs::packs_install,
            commands::packs::packs_install_default,
```

The block should now end:
```rust
            commands::workspaces::initialize_workspace,
            // Packs
            commands::packs::packs_list,
            commands::packs::packs_install,
            commands::packs::packs_install_default,
        ])
```

### Step 3: Create symlinks for production resource bundling

`workspace-packs/` at the repo root is the single source of truth. Rather than duplicating content into `src-tauri/resources/`, create symlinks so Tauri's bundler follows them at build time. In dev, `resolve_pack_sources()` already falls back to `CARGO_MANIFEST_DIR/../workspace-packs/` directly — the symlinks are only needed for production bundles.

```bash
cd src-tauri/resources
ln -s ../../workspace-packs/packs packs
ln -s ../../workspace-packs/pack-docs pack-docs
```

Verify the symlinks resolve correctly:

```bash
ls src-tauri/resources/packs/
```

Expected: lists the 6 pack directories (`micro-drama-script-studio-pack`, `research-synthesis-pack`, etc.).

### Step 4: Add pack resources to `tauri.conf.json`

In `src-tauri/tauri.conf.json` line 45, change:
```json
"resources": ["resources/skills/**/*"],
```
to:
```json
"resources": [
  "resources/skills/**/*",
  "resources/packs/**/*",
  "resources/pack-docs/**/*"
],
```

At runtime, `resolve_pack_sources()` searches these paths (among others):
- `{resource_dir}/resources/packs/` ← production bundle path
- `CARGO_MANIFEST_DIR/../workspace-packs/packs/` ← dev fallback (debug builds only)

### Step 5: Verify compilation

```bash
cd src-tauri && cargo check
```

Expected: 0 errors.

### Step 6: Commit

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/resources/packs src-tauri/resources/pack-docs
git commit -m "feat: register packs Tauri commands and bundle resources"
```

---

## Task 3: Add TypeScript IPC wrappers

**Files:**
- Modify: `src/lib/tauri-api.ts` (after line 1170, before the `// Compatibility Helpers` section)
- Modify: `src/lib/tauri-api-interface.ts` (after line 284, in the `TauriAPI` interface)

### Step 1: Add types and functions to `tauri-api.ts`

After the `// Workspaces` section (after line 1170), insert a new `// Packs` section:

```typescript
// ============================================================================
// Packs
// ============================================================================

export interface PackMeta {
  id: string;
  title: string;
  description: string;
  complexity: string;
  time_estimate: string;
  tags: string[];
}

export interface PackInstallResult {
  installed_path: string;
}

export async function listPacks(): Promise<PackMeta[]> {
  return invoke<PackMeta[]>('packs_list');
}

export async function installPack(packId: string, destinationDir: string): Promise<PackInstallResult> {
  return invoke<PackInstallResult>('packs_install', { packId, destinationDir });
}

export async function installPackDefault(packId: string): Promise<PackInstallResult> {
  return invoke<PackInstallResult>('packs_install_default', { packId });
}
```

### Step 2: Add to the `TauriAPI` interface in `tauri-api-interface.ts`

First, add the import at the top of `tauri-api-interface.ts` alongside the other type imports. Find the existing import line that brings in types from `tauri-api.ts` and add `PackMeta` and `PackInstallResult` to it. If types are imported individually, add:

```typescript
import type { PackMeta, PackInstallResult } from './tauri-api';
```

Then, in the `TauriAPI` interface (after the `onWorkspaceFsChanged` line 284), add:

```typescript
  // Packs
  listPacks(): Promise<PackMeta[]>;
  installPack(packId: string, destinationDir: string): Promise<PackInstallResult>;
  installPackDefault(packId: string): Promise<PackInstallResult>;
```

> **Note:** `getTauriAPI()` uses `{ ...tauriApi, ...overrides }` spread. Since `listPacks`, `installPack`, and `installPackDefault` are not event listeners (no async-to-sync conversion needed), they are automatically included in the spread and do not require explicit overrides in the `cachedTauriAPI` object.

Also add `listPacks`, `installPack`, `installPackDefault` to the return object in `getTauriApi()` in `tauri-api.ts` (in the final return block around line 1354–1363):

```typescript
    // Packs
    listPacks,
    installPack,
    installPackDefault,
```

### Step 3: Verify types

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add src/lib/tauri-api.ts src/lib/tauri-api-interface.ts
git commit -m "feat: add TypeScript IPC wrappers for packs"
```

---

## Task 4: Rewrite Home.tsx

**Files:**
- Modify: `src/pages/Home.tsx`

### Step 1: Read the current file

Read the full `src/pages/Home.tsx` to confirm current state before editing.

### Step 2: Write the new file

Replace the entire file with:

```tsx
'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { hasAnyReadyProvider } from '@/shared';
import TaskInputBar from '../components/landing/TaskInputBar';
import SettingsDialog from '../components/layout/SettingsDialog';
import { springs } from '../lib/animations';
import { pickFolder } from '../lib/tauri-api';
import type { PackMeta } from '../lib/tauri-api';
import { getTauriAPI } from '../lib/tauri-api-interface';
import { useTaskStore } from '../stores/taskStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

const COMPLEXITY_COLORS: Record<string, string> = {
  'Beginner-Intermediate': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Intermediate: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'Intermediate-Advanced': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  // Packs state
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [packErrors, setPackErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  const { startTask, isLoading, addTaskUpdate, enqueuePermissionRequest } = useTaskStore();
  const { addWorkspace, switchWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const api = getTauriAPI();

  // Subscribe to task events
  useEffect(() => {
    const unsubscribeTask = api.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });
    const unsubscribePermission = api.onPermissionRequest((request) => {
      enqueuePermissionRequest(request);
    });
    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, enqueuePermissionRequest, api]);

  // Load packs catalog on mount
  useEffect(() => {
    api
      .listPacks()
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false));
  }, [api]);

  const filteredPacks = packs.filter((p) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.complexity.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const executeTask = useCallback(
    async (taskPrompt: string) => {
      const taskId = `task_${Date.now()}`;
      const task = await startTask({ prompt: taskPrompt, taskId });
      if (task) {
        navigate(`/execution/${task.id}`);
      }
    },
    [startTask, navigate],
  );

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setShowSettingsDialog(true);
        return;
      }
    }
    await executeTask(prompt.trim());
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
  };

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask(prompt.trim());
    }
  };

  const handleInstall = async (packId: string) => {
    setInstallingId(packId);
    setPackErrors((prev) => {
      const next = { ...prev };
      delete next[packId];
      return next;
    });

    try {
      const destination = await pickFolder();
      if (!destination) {
        setInstallingId(null);
        return;
      }

      const result = await api.installPack(packId, destination);
      const workspace = await addWorkspace(result.installed_path);
      await switchWorkspace(workspace.id);
      await executeTask("Open `START_HERE.md` and follow it step-by-step.");
    } catch (e) {
      setPackErrors((prev) => ({ ...prev, [packId]: String(e) }));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <>
      <SettingsDialog onApiKeySaved={handleApiKeySaved} onOpenChange={handleSettingsDialogChange} open={showSettingsDialog} />
      <div className="flex h-full items-center justify-center overflow-y-auto bg-accent p-6">
        <div className="flex w-full max-w-4xl flex-col items-center gap-8">
          {/* Main Title */}
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="font-light text-4xl text-foreground tracking-tight"
            data-testid="home-title"
            initial={{ opacity: 0, y: -20 }}
            transition={springs.gentle}
          >
            What will you accomplish today?
          </motion.h1>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <Card className="flex max-h-[calc(100vh-3rem)] w-full flex-col gap-0 bg-card/95 py-0 shadow-xl backdrop-blur-md">
              <CardContent className="flex-shrink-0 p-6 pb-4">
                <TaskInputBar
                  autoFocus={true}
                  isLoading={isLoading}
                  large={true}
                  onChange={setPrompt}
                  onSubmit={handleSubmit}
                  placeholder="Describe a task and let AI handle the rest"
                  value={prompt}
                />
              </CardContent>

              {/* Starter Packs Section */}
              <div className="border-border border-t">
                {/* Header row */}
                <div className="flex items-center justify-between px-6 py-3">
                  <div>
                    <span className="font-medium text-foreground text-sm">Starter Packs</span>
                    <p className="text-muted-foreground text-xs">Guided, copyable folders for real-world tasks.</p>
                  </div>
                  <input
                    className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search packs…"
                    type="search"
                    value={query}
                  />
                </div>

                {/* Pack grid */}
                <div className="max-h-[400px] overflow-y-auto px-6 pb-4">
                  {packsLoading ? (
                    <p className="py-4 text-center text-muted-foreground text-sm">Loading packs…</p>
                  ) : filteredPacks.length === 0 ? (
                    <p className="py-4 text-center text-muted-foreground text-sm">
                      {query ? 'No packs match your search.' : 'No packs available.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {filteredPacks.map((pack) => (
                        <div
                          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                          key={pack.id}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-foreground text-sm leading-snug">{pack.title}</div>
                              <div className="mt-0.5 text-muted-foreground text-xs line-clamp-2">{pack.description}</div>
                            </div>
                            <button
                              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={installingId === pack.id}
                              onClick={() => handleInstall(pack.id)}
                              type="button"
                            >
                              {installingId === pack.id ? 'Installing…' : 'Install'}
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${COMPLEXITY_COLORS[pack.complexity] ?? 'bg-muted text-muted-foreground'}`}
                            >
                              {pack.complexity}
                            </span>
                            <span className="text-muted-foreground text-xs">{pack.time_estimate}</span>
                            {pack.tags.slice(0, 4).map((tag) => (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>

                          {packErrors[pack.id] && (
                            <p className="text-destructive text-xs">{packErrors[pack.id]}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
```

### Step 3: Check types

```bash
pnpm typecheck
```

Expected: 0 errors. Fix any type errors before continuing.

### Step 4: Commit

```bash
git add src/pages/Home.tsx
git commit -m "feat: rewrite Home.tsx with Starter Packs grid"
```

---

## Task 5: Update tests

**Files:**
- Modify: `src/pages/__tests__/Home.test.tsx` (if it exists — check first)

### Step 1: Check for existing tests

```bash
ls src/pages/__tests__/
```

If `Home.test.tsx` exists, read it and update any snapshot tests or assertions that reference the old `USE_CASE_EXAMPLES` content, `showExamples`, or the example prompts DOM structure.

If `Home.test.tsx` does not exist, skip this task.

### Step 2: Run the test suite

```bash
pnpm test --run
```

Expected: all tests pass. Fix any failures caused by the Home.tsx rewrite.

### Step 3: Commit (only if tests were changed)

```bash
git add src/pages/__tests__/Home.test.tsx
git commit -m "test: update Home tests for Starter Packs rewrite"
```

---

## Task 6: Smoke test in dev

### Step 1: Run the app

```bash
pnpm tauri dev
```

### Step 2: Verify

1. Home screen shows "Starter Packs" section below the prompt bar (not "Example prompts")
2. All 6 pack cards render with title, description, complexity pill, time, tags, Install button
3. Searching filters cards correctly
4. Clicking Install opens a native folder picker
5. Cancelling the picker dismisses without error
6. Successful install → workspace added → task started → navigate to `/execution/:id`

---

## Completion Checklist

- [ ] `cargo check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test --run` passes
- [ ] All 6 packs visible on Home screen
- [ ] Install flow works end-to-end in `pnpm tauri dev`
- [ ] Update `docs/specs/cowork-z/requirements.md` with feature completion
- [ ] Append entry to `UPDATE_LOG.md`
