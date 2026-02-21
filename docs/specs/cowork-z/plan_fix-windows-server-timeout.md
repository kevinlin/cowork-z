---
name: Fix Windows Server Timeout
overview: Fix the "OpenCode server failed to start after 15000ms" error on Windows, caused by multiple Windows-specific issues in the sidecar's process spawning and server startup flow.
todos:
  - id: fix-spawn-shell
    content: "Add `shell: true` on Windows to the `spawn()` call in process-manager.ts so `.cmd` shims work"
    status: completed
  - id: fix-wait-logging
    content: Add diagnostic logging and early exit to `waitForServer()` — log errors, check if process died, include last error in timeout message
    status: completed
  - id: fix-timeout-windows
    content: Increase health check timeout on Windows from 15s to 30s
    status: pending
  - id: fix-spawn-error
    content: Capture spawn errors and fail fast in the wait loop instead of polling for 15s after a failed spawn
    status: completed
  - id: investigate-workspace-dir
    content: Investigate why `C:\WINDOWS\system32` is used as the OpenCode project directory — check workspace path resolution on Windows
    status: pending
isProject: false
---

# Fix: "OpenCode server failed to start after 15000ms" on Windows

## Root Cause Analysis

The screenshot and log from Kristoffer's Windows machine reveal a cascade of issues:

### What the log tells us

From `2026-02-20T153454.log`:

1. **Line 3-4**: The OpenCode server starts with `directory=C:\WINDOWS\system32` — this is the Windows system directory, not a user workspace. This means either no workspace was selected or the workspace path defaulted to the system CWD.
2. **Lines 77-89**: An `npm install` of opencode v1.2.10 triggered an **EPERM error** — Windows cannot unlink `opencode.exe` because the file is locked (likely by the running sidecar or a previous opencode process):

```
   EPERM: operation not permitted, unlink 'C:\Users\krir\AppData\Roaming\npm\node_modules\.opencode-ai-FXJvAk0O\node_modules\opencode-windows-x64\bin\opencode.exe'
   

```

   This is a classic Windows file-locking issue — you can't delete/replace an `.exe` that's currently running.

1. **Lines 25-91**: The OpenCode server *does* eventually start successfully (SSE connects, providers load, endpoints respond). The log shows `status=completed` for all API endpoints. So the server **was working at some point**.

### What the screenshot tells us

The screenshot shows a **different session** (timestamp `10:00:27` vs the log's `15:34:54`). The error:

```
Failed to start task {"taskId":"task_1771664410695","error":"OpenCode server failed to start after 15000ms"}
```

This means the sidecar spawned `opencode serve` but the health check at `GET /global/health` never succeeded within 30 polls x 500ms = 15000ms.

### Identified Issues (3 root causes)

**Issue 1: `spawn()` without `shell: true` cannot execute `.cmd` shims on Windows**

This is the most likely primary cause. When npm installs a global package on Windows, it creates a `.cmd` wrapper (e.g., `%APPDATA%\npm\opencode.cmd`), not a direct `.exe`. Node.js `child_process.spawn()` **cannot execute `.cmd` files** unless `shell: true` is set. The current code at [process-manager.ts](src-tauri/sidecar-opencode/src/process-manager.ts) line 530:

```530:535:src-tauri/sidecar-opencode/src/process-manager.ts
    this.process = spawn(this.cliPath, args, {
      env,
      cwd: OPENCODE_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
```

This will silently fail on Windows if `opencode` resolves to `opencode.cmd` rather than `opencode.exe`. The `process.on('error')` handler logs it, but the error is swallowed in `waitForServer()` which just keeps polling until timeout.

**Issue 2: No diagnostic logging in `waitForServer()` loop**

The health check loop at line 560-575 catches **all** exceptions silently. If the spawn itself failed (ENOENT because `.cmd` can't be executed, or EPERM because the exe is locked), there's no visibility into *why* the server isn't responding. The loop just waits 15 seconds and throws a generic timeout error.

**Issue 3: The 15000ms timeout may be too short on Windows**

The log shows that OpenCode server startup takes ~5 seconds just for plugin loading (lines 24-25: the `opencode-anthropic-auth@0.0.13` plugin takes 4388ms). On a slower Windows machine, or when Windows Defender is scanning the newly spawned process, 15 seconds may not be enough. However, this is secondary to Issue 1.

### Bonus observation: `C:\WINDOWS\system32` as directory

Line 3 shows `directory=C:\WINDOWS\system32`. This is the OpenCode project directory (not the process CWD). It means the workspace/working directory was not properly passed to the SSE event stream subscription. The workspace dropdown shows "Downloads" in the screenshot, so the workspace path should have been `C:\Users\krir\Downloads` or similar. This is a separate issue from the timeout but worth investigating — it may mean the workspace path isn't being resolved correctly on Windows.

## Proposed Fixes

### Fix 1: Add `shell: true` on Windows for `opencode serve` spawn (Critical)

In [process-manager.ts](src-tauri/sidecar-opencode/src/process-manager.ts), add `shell: true` when running on Windows so that `.cmd` shims are resolved correctly:

```typescript
this.process = spawn(this.cliPath, args, {
  env,
  cwd: OPENCODE_DATA_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
  shell: process.platform === 'win32',
});
```

This is the standard Node.js pattern for cross-platform process spawning when the target might be a `.cmd` or `.bat` file.

### Fix 2: Add diagnostic logging to `waitForServer()` (Important)

Log the error on each failed health check attempt so we can see *why* the server isn't responding (connection refused = process didn't start, ECONNRESET = process crashed, etc.):

```typescript
private async waitForServer(): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 500;
  let lastError: unknown;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const health = await this.client.health();
      logger.info(`OpenCode server ready, version: ${health.version}`);
      return;
    } catch (err) {
      lastError = err;
      if (i % 5 === 0) {
        logger.debug(`Waiting for OpenCode server (attempt ${i + 1}/${maxAttempts})`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await this.sleep(delayMs);
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `OpenCode server failed to start after ${maxAttempts * delayMs}ms. Last error: ${errMsg}`
  );
}
```

Also check if the spawned process already exited before continuing to poll:

```typescript
// Inside the catch block, also check if process died
if (this.process === null) {
  throw new Error('OpenCode process exited before server became ready');
}
```

### Fix 3: Increase timeout on Windows (Minor)

Increase `maxAttempts` to 60 (30 seconds) on Windows to account for Windows Defender scanning and slower plugin loading:

```typescript
const maxAttempts = process.platform === 'win32' ? 60 : 30;
```

### Fix 4: Log spawn errors more prominently (Important)

The current `process.on('error')` handler only logs at error level but doesn't abort the wait loop. Capture the spawn error and use it to fail fast:

```typescript
let spawnError: Error | null = null;

this.process.on('error', (error) => {
  logger.error('OpenCode process error', error);
  spawnError = error;
});

// In waitForServer, check spawnError to fail fast
```

### Fix 5 (Optional): Investigate workspace directory on Windows

The `C:\WINDOWS\system32` directory in the log suggests the workspace path may not be getting passed correctly. This is a separate investigation — the `workingDirectory` parameter flows from `taskStore.ts` -> Rust `start_task` -> sidecar `start_task` -> `initialize()` -> `EventStream`. If the workspace store returns an empty or null path on Windows, OpenCode defaults to its own CWD which inherits from the sidecar's CWD.