# Windows Production Readiness (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all runtime bugs preventing Cowork-Z from working correctly on Windows x64.

**Architecture:** Four targeted fixes to existing Rust and config files — platform-aware log directory, PATH resolution with Windows separators and well-known dirs, a cross-platform sidecar build script, and graceful sidecar shutdown on Windows.

**Tech Stack:** Rust (Tauri 2.x, dirs crate v5), Node.js (cross-platform build script), GitHub Actions CI

---

### Task 1: Platform-Aware Log Directory ✅

**Files:**
- Modify: `src-tauri/src/sidecar.rs:197-202`

**Step 1: Fix the hardcoded Unix log path**

In `src-tauri/src/sidecar.rs`, replace lines 197-202:

```rust
    let log_dir = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".local")
        .join("share")
        .join("opencode")
        .join("log");
```

With platform-aware resolution:

```rust
    let log_dir = if cfg!(target_os = "windows") {
        // Windows: %LOCALAPPDATA%\opencode\log
        dirs::data_local_dir()
            .ok_or("Could not determine local app data directory")?
            .join("opencode")
            .join("log")
    } else {
        // macOS/Linux: ~/.local/share/opencode/log
        dirs::home_dir()
            .ok_or("Could not determine home directory")?
            .join(".local")
            .join("share")
            .join("opencode")
            .join("log")
    };
```

**Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "fix: use platform-aware log directory path for Windows support"
```

---

### Task 2: PATH Resolution — Separator and Dedup ✅

**Files:**
- Modify: `src-tauri/src/lib.rs:1200-1280` (function `get_augmented_path`)

This task has 3 sub-changes to the `get_augmented_path()` function. Apply all three before compiling.

**Step 1: Add PATH separator constant and fix split/join**

At the top of `get_augmented_path()` (line 1200), add a separator constant:

```rust
fn get_augmented_path() -> String {
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let current_path = std::env::var("PATH").unwrap_or_default();
```

Replace all occurrences of `.split(':')` with `.split(separator)`:
- Line 1206: `current_path.split(':')` → `current_path.split(separator)`
- Line 1224: `shell_path.trim().split(':')` → `shell_path.trim().split(separator)`

Replace the final join at line 1279:
- `dirs.join(":")` → `dirs.join(separator)`

**Step 2: Make dedup case-insensitive on Windows**

Change the `seen` HashSet logic. Replace lines 1202-1210:

```rust
    let mut seen = std::collections::HashSet::new();
    let mut dirs: Vec<String> = Vec::new();

    // Start with existing PATH entries
    for dir in current_path.split(separator).filter(|s| !s.is_empty()) {
        let key = if cfg!(target_os = "windows") {
            dir.to_lowercase()
        } else {
            dir.to_string()
        };
        if seen.insert(key) {
            dirs.push(dir.to_string());
        }
    }
```

Also update the login-shell PATH merge (lines 1224-1228) to use the same case-insensitive key:

```rust
                        for dir in shell_path.trim().split(separator).filter(|s| !s.is_empty()) {
                            let key = if cfg!(target_os = "windows") {
                                dir.to_lowercase()
                            } else {
                                dir.to_string()
                            };
                            if seen.insert(key) {
                                dirs.push(dir.to_string());
                            }
                        }
```

And update the well-known dirs loop (lines 1271-1277) and nvm loop (lines 1262-1265) similarly:

For nvm (around line 1262):
```rust
                let key = if cfg!(target_os = "windows") {
                    nvm_bin.to_lowercase()
                } else {
                    nvm_bin.clone()
                };
                if seen.insert(key) {
                    if std::path::Path::new(&nvm_bin).exists() {
                        dirs.push(nvm_bin);
                    }
                }
```

For well-known dirs (around line 1271):
```rust
    for dir in well_known {
        let key = if cfg!(target_os = "windows") {
            dir.to_lowercase()
        } else {
            dir.clone()
        };
        if seen.insert(key) {
            if std::path::Path::new(&dir).exists() {
                dirs.push(dir);
            }
        }
    }
```

**Step 3: Add Windows-specific well-known directories**

Replace the well-known dirs block (lines 1236-1248) with platform-conditional lists:

```rust
    // Well-known directories as fallback
    let home = dirs::home_dir().unwrap_or_default();

    let well_known: Vec<String> = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let programfiles = std::env::var("ProgramFiles").unwrap_or_default();

        vec![
            format!("{}\\npm", appdata),                          // npm global
            format!("{}\\nodejs", programfiles),                   // Node.js install
            format!("{}\\Volta\\bin", localappdata),               // Volta
            home.join("scoop\\shims").to_string_lossy().to_string(), // Scoop
            "C:\\ProgramData\\chocolatey\\bin".to_string(),        // Chocolatey
            format!("{}\\Yarn\\bin", localappdata),                // Yarn
            format!("{}\\pnpm", localappdata),                     // pnpm
        ]
    } else {
        vec![
            "/opt/homebrew/bin".to_string(),
            "/opt/homebrew/sbin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/local/sbin".to_string(),
            home.join(".local/bin").to_string_lossy().to_string(),
            home.join(".volta/bin").to_string_lossy().to_string(),
            home.join(".npm-global/bin").to_string_lossy().to_string(),
            home.join(".yarn/bin").to_string_lossy().to_string(),
            home.join(".local/share/pnpm").to_string_lossy().to_string(),
            home.join(".local/share/fnm").to_string_lossy().to_string(),
        ]
    };
```

Also make the nvm version directory scanning platform-aware. Replace lines 1250-1269:

```rust
    // Add nvm/nvm-windows latest node version
    let nvm_base = if cfg!(target_os = "windows") {
        // nvm-windows: %APPDATA%\nvm or %NVM_HOME%
        let nvm_home = std::env::var("NVM_HOME")
            .unwrap_or_else(|_| {
                let appdata = std::env::var("APPDATA").unwrap_or_default();
                format!("{}\\nvm", appdata)
            });
        std::path::PathBuf::from(nvm_home)
    } else {
        home.join(".nvm/versions/node")
    };
    if nvm_base.exists() {
        if let Ok(versions) = std::fs::read_dir(&nvm_base) {
            let mut version_dirs: Vec<String> = versions
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|name| name.starts_with('v'))
                .collect();
            version_dirs.sort();
            version_dirs.reverse();
            if let Some(latest) = version_dirs.first() {
                let nvm_bin = if cfg!(target_os = "windows") {
                    // nvm-windows puts node.exe directly in the version dir
                    nvm_base.join(latest).to_string_lossy().to_string()
                } else {
                    nvm_base.join(latest).join("bin").to_string_lossy().to_string()
                };
                let key = if cfg!(target_os = "windows") {
                    nvm_bin.to_lowercase()
                } else {
                    nvm_bin.clone()
                };
                if seen.insert(key) {
                    if std::path::Path::new(&nvm_bin).exists() {
                        dirs.push(nvm_bin);
                    }
                }
            }
        }
    }
```

**Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: Windows PATH resolution — separators, well-known dirs, case-insensitive dedup"
```

---

### Task 3: Cross-Platform Sidecar Build Script ✅

**Files:**
- Create: `scripts/build-sidecar.mjs`
- Modify: `src-tauri/tauri.conf.json:7`

**Step 1: Create the cross-platform build script**

Create `scripts/build-sidecar.mjs`:

```javascript
#!/usr/bin/env node

/**
 * Cross-platform sidecar binary builder.
 * Detects the current OS and architecture, then runs the correct
 * pnpm build:binary:<target> command from the sidecar directory.
 */

import { execSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { resolve } from 'node:path';

const sidecarDir = resolve(import.meta.dirname, '..', 'src-tauri', 'sidecar-opencode');

const targetMap = {
  'darwin-arm64': 'build:binary',
  'darwin-x64': 'build:binary:x64',
  'win32-x64': 'build:binary:win',
  'linux-x64': 'build:binary:linux',
  'linux-arm64': 'build:binary:linux-arm64',
};

const key = `${platform()}-${arch()}`;
const script = targetMap[key];

if (!script) {
  console.error(`Unsupported platform/arch: ${key}`);
  console.error(`Supported targets: ${Object.keys(targetMap).join(', ')}`);
  process.exit(1);
}

console.log(`Building sidecar for ${key} (pnpm ${script})...`);

try {
  execSync(`pnpm ${script}`, {
    cwd: sidecarDir,
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
```

**Step 2: Update `beforeDevCommand` in tauri.conf.json**

Replace line 7:

```json
    "beforeDevCommand": "cd src-tauri/sidecar-opencode && pnpm install && pnpm build:binary && cd ../.. && pnpm dev",
```

With:

```json
    "beforeDevCommand": "cd src-tauri/sidecar-opencode && pnpm install && cd ../.. && node scripts/build-sidecar.mjs && pnpm dev",
```

**Step 3: Verify the script works locally**

Run: `node scripts/build-sidecar.mjs`
Expected: Builds the sidecar binary for your current platform (e.g., `darwin-arm64`).

**Step 4: Verify Tauri config is valid JSON**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add scripts/build-sidecar.mjs src-tauri/tauri.conf.json
git commit -m "feat: cross-platform sidecar build script for beforeDevCommand"
```

---

### Task 4: Graceful Sidecar Shutdown on Windows ✅

**Files:**
- Modify: `src-tauri/src/sidecar.rs:473-479` (function `stop`)

**Step 1: Add a shutdown command before kill on Windows**

The current `stop()` method calls `child.kill()` directly. On Windows this is `TerminateProcess` — a hard kill that can orphan the OpenCode server child process. Send a `shutdown` command via stdin first to let the sidecar clean up.

Replace lines 473-479:

```rust
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(child) = self.child.take() {
            child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        }
        self.is_ready = false;
        Ok(())
    }
```

With:

```rust
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.child.take() {
            // Send shutdown command via stdin so sidecar can clean up child processes
            let shutdown_cmd = serde_json::json!({"type": "shutdown"});
            let json = serde_json::to_string(&shutdown_cmd).unwrap_or_default();
            let _ = child.write((json + "\n").as_bytes());

            // Give sidecar a moment to shut down gracefully, then force kill
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = child.kill();
        }
        self.is_ready = false;
        Ok(())
    }
```

**Step 2: Add shutdown handler in the sidecar Node.js code**

Read `src-tauri/sidecar-opencode/src/index.ts` to find where stdin commands are parsed, then add a `shutdown` command handler that stops the OpenCode server and exits.

The sidecar already parses stdin JSON-line commands. Add a case for `"shutdown"` that:
1. Calls `sessionManager.cleanup()` (or equivalent) to stop the OpenCode server
2. Calls `process.exit(0)`

Find the stdin command dispatch (likely a switch/if-chain on the command type) and add:

```typescript
case 'shutdown':
  // Graceful shutdown: stop OpenCode server, then exit
  try {
    await sessionManager.stop();
  } catch {
    // Best-effort cleanup
  }
  process.exit(0);
  break;
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 4: Verify sidecar TypeScript compiles**

Run: `cd src-tauri/sidecar-opencode && pnpm build`
Expected: Compiles without errors.

**Step 5: Commit**

```bash
git add src-tauri/src/sidecar.rs src-tauri/sidecar-opencode/src/index.ts
git commit -m "fix: graceful sidecar shutdown to prevent orphaned processes on Windows"
```

---

### Task 5: Update Docstring and Function Comment ✅

**Files:**
- Modify: `src-tauri/src/lib.rs:1195-1199`

**Step 1: Update the docstring for `get_augmented_path`**

Replace lines 1195-1199:

```rust
/// Build an augmented PATH suitable for macOS GUI-launched apps.
///
/// When the app is launched from Finder / Dock / Spotlight, macOS gives
/// the process a minimal PATH (e.g. /usr/bin:/bin:/usr/sbin:/sbin).
/// Tools installed via Homebrew, nvm, volta, etc. won't be found.
```

With:

```rust
/// Build an augmented PATH suitable for GUI-launched apps on all platforms.
///
/// On macOS, Finder/Dock/Spotlight give a minimal PATH. On Windows,
/// Start Menu/Explorer may omit user-installed tool directories.
/// This function merges the current PATH with login-shell PATH (Unix only)
/// and well-known tool directories for each platform.
```

**Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "docs: update get_augmented_path docstring for cross-platform scope"
```

---

### Task 6: Verify Full Build and Run Tests ✅

**Files:** None (verification only)

**Step 1: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors or warnings.

**Step 2: Run frontend tests**

Run: `pnpm test --run`
Expected: All tests pass.

**Step 3: Run sidecar tests**

Run: `cd src-tauri/sidecar-opencode && pnpm test`
Expected: All tests pass.

**Step 4: Run linter**

Run: `pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/`
Expected: No lint errors.

---

### Task 7: Update Docs and Changelog ✅

**Files:**
- Modify: `docs/specs/cowork-z/requirements.md`
- Modify: `UPDATE_LOG.md`

**Step 1: Update requirements.md**

The design doc reference and TODO item were already added during the brainstorming phase. Verify they are present:
- Implementation Plans Index table has the "Windows Production Readiness" row
- Outstanding Feature TODO has "Windows Production Readiness" as the first item
- Section 5.1 heading does NOT have a checkmark (since Windows isn't fully done until Phase 3)

**Step 2: Add changelog entry**

Add to `UPDATE_LOG.md` under a new `## v0.4.2` section (or the current version section):

```markdown
## v0.4.2

- **5.1 Windows Runtime Fixes (Phase 1)** — Platform-aware log directory, Windows PATH resolution (semicolon separators, case-insensitive dedup, well-known Windows tool directories), cross-platform sidecar build script, graceful sidecar shutdown for Windows process management
```
