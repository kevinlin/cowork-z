# Windows Support (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all runtime bugs preventing Cowork-Z from working correctly on Windows x64.

**Architecture:** Four targeted fixes to existing Rust and config files — platform-aware log directory, PATH resolution with Windows separators and well-known dirs, a cross-platform sidecar build script, and graceful sidecar shutdown on Windows.

**Tech Stack:** Rust (Tauri 2.x, dirs crate v5), Node.js (cross-platform build script), GitHub Actions CI

---

### Task 1: Platform-Aware Log Directory ✅

**Files:**
- Modify: `src-tauri/src/sidecar.rs:197-202`

**Step 1: Fix the hardcoded Unix log path**

In `src-tauri/src/sidecar.rs`, replace lines 197-202 With platform-aware resolution:

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

Also update the login-shell PATH merge (lines 1224-1228) to use the same case-insensitive key:

And update the well-known dirs loop (lines 1271-1277) and nvm loop (lines 1262-1265) similarly:
- For nvm (around line 1262)
- For well-known dirs (around line 1271)

**Step 3: Add Windows-specific well-known directories**

Replace the well-known dirs block (lines 1236-1248) with platform-conditional lists:

Also make the nvm version directory scanning platform-aware. Replace lines 1250-1269:

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

**Step 2: Add shutdown handler in the sidecar Node.js code**

Read `src-tauri/sidecar-opencode/src/index.ts` to find where stdin commands are parsed, then add a `shutdown` command handler that stops the OpenCode server and exits.

The sidecar already parses stdin JSON-line commands. Add a case for `"shutdown"` that:
1. Calls `sessionManager.cleanup()` (or equivalent) to stop the OpenCode server
2. Calls `process.exit(0)`

Find the stdin command dispatch (likely a switch/if-chain on the command type) and add shutdown handler

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
- Modify: `docs/specs/requirements.md`
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
