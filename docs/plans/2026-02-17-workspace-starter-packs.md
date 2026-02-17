# Workspace Starter Packs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Workspace Starter Packs feature where Home.tsx becomes a packs browser that lets users install guided, copyable workspace folders and auto-start an AI task.

**Architecture:** Port Tandem's `packs.rs` to `src-tauri/src/commands/packs.rs`, wire up three Tauri commands (`packs_list`, `packs_install`, `packs_install_default`), add TypeScript IPC wrappers, then rewrite `Home.tsx` to replace the "Example prompts" section with a 2-column packs grid.

**Tech Stack:** Rust (serde, tauri, dirs, std::fs), TypeScript, React, Tauri `invoke()`, `@tauri-apps/plugin-dialog` (via existing `pickFolder()`), Zustand (`useWorkspaceStore`, `useTaskStore`).

---

## Task 1: Create the Rust packs module

**Files:**
- Create: `src-tauri/src/commands/packs.rs`

### Step 1: Create the file

```rust
// src-tauri/src/commands/packs.rs
//! Workspace Starter Packs — catalog, installation, and Tauri command wrappers.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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

#[derive(Debug, Serialize)]
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

/// Find the packs/ and pack-docs/ root directories.
/// Searches production bundle paths first, then falls back to the repo's
/// workspace-packs/ directory in debug builds.
fn resolve_pack_sources(resource_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let packs_root = [
        resource_dir.join("packs"),
        resource_dir.join("resources").join("packs"),
    ]
    .into_iter()
    .find(|p| p.exists())
    .or_else(|| {
        #[cfg(debug_assertions)]
        {
            let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("workspace-packs")
                .join("packs");
            if p.exists() {
                return Some(p);
            }
        }
        None
    })
    .ok_or_else(|| "Pack source directory not found".to_string())?;

    let pack_docs_root = [
        resource_dir.join("pack-docs"),
        resource_dir.join("resources").join("pack-docs"),
    ]
    .into_iter()
    .find(|p| p.exists())
    .or_else(|| {
        #[cfg(debug_assertions)]
        {
            let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("workspace-packs")
                .join("pack-docs");
            if p.exists() {
                return Some(p);
            }
        }
        None
    })
    .ok_or_else(|| "Pack docs directory not found".to_string())?;

    Ok((packs_root, pack_docs_root))
}

/// Return `destination/pack_id`, incrementing to `-2`, `-3`, … if already exists.
fn choose_destination_dir(destination: &Path, pack_id: &str) -> Result<PathBuf, String> {
    let base = destination.join(pack_id);
    if !base.exists() {
        return Ok(base);
    }
    for n in 2..=100 {
        let candidate = destination.join(format!("{}-{}", pack_id, n));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "No available install directory for pack '{}' (tried -2 through -100)",
        pack_id
    ))
}

/// Default install root: `~/Cowork-Z Packs`, falling back to current dir.
fn default_pack_root() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join("Cowork-Z Packs"))
        .ok_or_else(|| "Could not determine home directory".to_string())
}

/// Recursively copy `src` directory into `dest` (dest is created if needed).
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create {:?}: {}", dest, e))?;
    for entry in
        fs::read_dir(src).map_err(|e| format!("Failed to read {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let dest_path = dest.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(&entry.path(), &dest_path)
                .map_err(|e| format!("Failed to copy {:?}: {}", entry.path(), e))?;
        }
    }
    Ok(())
}

// ── Core install logic ────────────────────────────────────────────────────────

pub fn install_pack(
    app: &AppHandle,
    pack_id: &str,
    destination_dir: &str,
) -> Result<PackInstallResult, String> {
    // Validate pack_id against the catalog (prevents path traversal).
    if !list_packs().iter().any(|p| p.id == pack_id) {
        return Err(format!("Unknown pack id: '{}'", pack_id));
    }

    let destination = Path::new(destination_dir);
    fs::create_dir_all(destination)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let (packs_root, pack_docs_root) = resolve_pack_sources(&resource_dir)?;

    let pack_src = packs_root.join(pack_id);
    let installed_dir = choose_destination_dir(destination, pack_id)?;

    // Copy the pack template directory.
    copy_dir_recursive(&pack_src, &installed_dir)?;

    // Copy documentation files individually (missing files are warnings, not errors).
    let doc_src = pack_docs_root.join(pack_id);
    for doc_file in &[
        "START_HERE.md",
        "PACK_INFO.md",
        "PROMPTS.md",
        "EXPECTED_OUTPUTS.md",
    ] {
        let src_file = doc_src.join(doc_file);
        if src_file.exists() {
            if let Err(e) = fs::copy(&src_file, installed_dir.join(doc_file)) {
                eprintln!("Warning: failed to copy {}: {}", doc_file, e);
            }
        }
    }

    Ok(PackInstallResult {
        installed_path: installed_dir.to_string_lossy().to_string(),
    })
}

pub fn install_pack_default(
    app: &AppHandle,
    pack_id: &str,
) -> Result<PackInstallResult, String> {
    let root = default_pack_root()?;
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

Expected: compiles with 0 errors. If `dirs` crate is missing, add `dirs = "5"` to `Cargo.toml` under `[dependencies]` — but `dirs` is likely already present via `lib.rs` usage.

### Step 3: Commit

```bash
git add src-tauri/src/commands/packs.rs
git commit -m "feat: add Rust packs module (catalog + install logic)"
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

### Step 3: Add pack resources to `tauri.conf.json`

In `src-tauri/tauri.conf.json` line 45, change:
```json
"resources": ["resources/skills/**/*"],
```
to:
```json
"resources": [
  "resources/skills/**/*",
  "workspace-packs/packs/**/*",
  "workspace-packs/pack-docs/**/*"
],
```

> **Note:** These resource globs are for production builds. In development (`pnpm tauri dev`), the `#[cfg(debug_assertions)]` path in `resolve_pack_sources()` resolves directly to `workspace-packs/` via `CARGO_MANIFEST_DIR` — no file copying needed for dev.

### Step 4: Verify compilation

```bash
cd src-tauri && cargo check
```

Expected: 0 errors.

### Step 5: Commit

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
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
  const { addWorkspace } = useWorkspaceStore();
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
      await addWorkspace(result.installed_path);
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
