# 04 - Electron to Tauri Migration: Sidecar Implementation Plan

## Overview

Complete the migration by porting the Electron main process OpenCode integration (`apps/desktop/src/main/opencode/`) to a Node.js sidecar, configuring Tauri bundling, and updating documentation.

## Source Reference

**Electron Source:** `apps/desktop/src/main/`
- `opencode/adapter.ts` (50KB) - Main OpenCode orchestration
- `opencode/task-manager.ts` (26KB) - Task concurrency & lifecycle
- `opencode/stream-parser.ts` (6KB) - NDJSON parsing
- `opencode/config-generator.ts` (31KB) - OpenCode config generation
- `opencode/cli-path.ts` (8KB) - CLI binary resolution
- `ipc/handlers.ts` (71KB) - 53 IPC command implementations

## Implementation Steps

### Phase 1: Port Electron OpenCode Module to Sidecar (7 files)

#### 1.1 Copy and adapt `apps/desktop/src/main/opencode/stream-parser.ts`
**Target:** `sidecar/src/stream-parser.ts`

Port the 212-line NDJSON parser:
- Buffer management for fragmented JSON (Windows PTY issue)
- Terminal decoration filtering (box-drawing, ANSI escapes)
- Max buffer protection (10MB)
- Update imports from `@shared` to local types

#### 1.2 Copy and adapt `apps/desktop/src/main/opencode/adapter.ts`
**Target:** `sidecar/src/adapter.ts`

Port the main orchestration (~1200 lines, extract relevant parts):
- node-pty process spawning with platform-specific shell
- StreamParser integration
- Task lifecycle (start, cancel, interrupt, resume)
- Permission request handling
- Event emission mapping to sidecar protocol

**Key adaptations:**
- Remove Electron-specific imports (`electron.app`, `dialog`)
- Replace `mainWindow.webContents.send()` with JSON-line output
- Replace config paths with sidecar-compatible resolution
- Keep: PTY options, shell selection, env building, command escaping

#### 1.3 Copy and adapt `apps/desktop/src/main/opencode/task-manager.ts`
**Target:** `sidecar/src/task-manager.ts`

Port multi-task management (~700 lines):
- Active task tracking with Map
- Adapter lifecycle management
- Task state (running, completed, cancelled)
- Cleanup on task completion

**Simplifications:**
- Remove Playwright/dev-browser installation (defer to later)
- Remove Electron IPC event sending
- Keep: Task concurrency, adapter instantiation, cleanup

#### 1.4 Copy and adapt `apps/desktop/src/main/opencode/config-generator.ts`
**Target:** `sidecar/src/config-generator.ts`

Port OpenCode config generation (~900 lines):
- `.opencode.json` generation
- System prompt template with task instructions
- Skills path resolution
- Model configuration

**Key adaptations:**
- Replace `electron.app.getPath()` with environment variables
- Accept API keys as parameter (passed from Rust via IPC)
- Keep: System prompt, skills integration, model config

#### 1.5 Copy and adapt `apps/desktop/src/main/opencode/cli-path.ts`
**Target:** `sidecar/src/cli-path.ts`

Port CLI binary resolution (~200 lines):
- Search order: nvm → global npm → homebrew → PATH
- Platform-specific: `opencode` vs `opencode.exe`
- Keep all resolution logic

#### 1.6 Create `sidecar/src/types.ts`
**Source:** `apps/desktop/src/shared/types/`

Copy and consolidate types:
- `OpenCodeMessage`, `TaskConfig`, `TaskResult`
- `PermissionRequest`, `PermissionResponse`
- Provider types, API key types
- Sidecar-specific IPC message types

#### 1.7 Update `sidecar/src/index.ts`

Integrate ported modules:
```typescript
// Import ported modules
import { TaskManager } from './task-manager';
import { ApiKeys, SidecarConfig } from './types';

// Initialize task manager
const taskManager = new TaskManager();

// Handle messages
async function handleMessage(msg: Message): Promise<void> {
  switch (msg.type) {
    case 'start_task':
      const task = await taskManager.startTask({
        ...msg.payload,
        apiKeys: msg.payload.apiKeys, // Passed from Rust
        onMessage: (m) => send('task_message', m, msg.taskId),
        onProgress: (p) => send('task_progress', p, msg.taskId),
        onPermissionRequest: (r) => send('permission_request', r, msg.taskId),
        onComplete: (r) => send('task_complete', r, msg.taskId),
      });
      break;
    // ... other cases
  }
}
```

### Phase 2: Tauri Configuration (3 files)

#### 2.1 Update `src-tauri/tauri.conf.json`

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["...existing..."],
    "externalBin": ["binaries/cowork-sidecar"],
    "resources": [
      { "from": "../apps/desktop/skills", "to": "skills" }
    ]
  }
}
```

#### 2.2 Update `src-tauri/capabilities/default.json`

```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-kill"
  ]
}
```

#### 2.3 Update `src-tauri/Cargo.toml`

```toml
[dependencies]
tauri-plugin-shell = "2"
```

### Phase 3: Rust Backend Integration (2 files)

#### 3.1 Create `src-tauri/src/sidecar.rs`

Sidecar manager module:
- Spawn sidecar using `tauri-plugin-shell`
- JSON-line IPC over stdin/stdout
- Forward sidecar events to Tauri events
- Handle sidecar lifecycle (spawn, restart, cleanup)

```rust
pub struct SidecarManager {
    stdin_tx: Option<mpsc::Sender<String>>,
}

impl SidecarManager {
    pub async fn spawn(&mut self, app: &AppHandle) -> Result<(), String>;
    pub async fn send_command(&self, cmd: SidecarCommand) -> Result<(), String>;
    fn handle_event(app: &AppHandle, event: SidecarEvent);
}
```

#### 3.2 Update `src-tauri/src/lib.rs`

Integrate sidecar with existing commands:

```rust
mod sidecar;

// Add to AppState
pub struct AppState {
    db: Mutex<Connection>,
    sidecar: Arc<Mutex<SidecarManager>>,
}

// Update task commands
#[tauri::command]
async fn start_task(config: TaskConfig, state: State<'_, AppState>, app: AppHandle) -> Result<Task, String> {
    // 1. Get API keys from secure storage
    let api_keys = get_all_api_keys_internal()?;

    // 2. Create task record in DB
    let task = create_task_record(&config)?;

    // 3. Ensure sidecar running
    let mut sidecar = state.sidecar.lock().await;
    if !sidecar.is_running() {
        sidecar.spawn(&app).await?;
    }

    // 4. Send to sidecar with API keys
    sidecar.send_command(SidecarCommand::StartTask {
        task_id: task.id.clone(),
        prompt: config.prompt,
        session_id: config.session_id,
        api_keys, // Pass keys to sidecar
    }).await?;

    Ok(task)
}

// Register shell plugin
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // ...
}
```

### Phase 4: Sidecar Build Configuration (2 files)

#### 4.1 Update `sidecar/package.json`

```json
{
  "name": "cowork-z-sidecar",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "build:binary": "pkg dist/index.js -t node20-macos-arm64 -o ../src-tauri/binaries/cowork-sidecar-aarch64-apple-darwin",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "tsx": "^4.0.0",
    "pkg": "^5.8.1"
  }
}
```

#### 4.2 Update `sidecar/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

### Phase 5: Documentation Updates (3 files)

#### 5.1 Update `docs/specs/electron-to-tauri-migration/implementation-plan.md`

- Replace ASCII diagrams with mermaid
- Add sidecar architecture section
- Reference Electron source locations
- Update phase completion status

#### 5.2 Update `docs/specs/electron-to-tauri-migration/task-progress.md`

- Mark Phase 3 (Sidecar) tasks as complete
- Add mermaid architecture diagram
- Update verification checklist
- Document remaining work

#### 5.3 Update `CLAUDE.md`

Update to reflect:
- Sidecar architecture details
- Source references to `apps/desktop/`
- Updated development commands
- Current implementation status

## Files Summary

| File | Action | Source Reference |
|------|--------|------------------|
| `sidecar/src/stream-parser.ts` | Create | `apps/desktop/src/main/opencode/stream-parser.ts` |
| `sidecar/src/adapter.ts` | Create | `apps/desktop/src/main/opencode/adapter.ts` |
| `sidecar/src/task-manager.ts` | Create | `apps/desktop/src/main/opencode/task-manager.ts` |
| `sidecar/src/config-generator.ts` | Create | `apps/desktop/src/main/opencode/config-generator.ts` |
| `sidecar/src/cli-path.ts` | Create | `apps/desktop/src/main/opencode/cli-path.ts` |
| `sidecar/src/types.ts` | Create | `apps/desktop/src/shared/types/*` |
| `sidecar/src/index.ts` | Modify | Integrate ported modules |
| `sidecar/package.json` | Modify | Add build scripts |
| `sidecar/tsconfig.json` | Modify | Output config |
| `src-tauri/tauri.conf.json` | Modify | Add sidecar + resources |
| `src-tauri/capabilities/default.json` | Modify | Add shell permissions |
| `src-tauri/Cargo.toml` | Modify | Add tauri-plugin-shell |
| `src-tauri/src/sidecar.rs` | Create | New module |
| `src-tauri/src/lib.rs` | Modify | Integrate sidecar |
| `docs/.../implementation-plan.md` | Modify | Mermaid + updates |
| `docs/.../task-progress.md` | Modify | Status + mermaid |
| `CLAUDE.md` | Modify | Current state |

## Verification Plan

1. **Sidecar TypeScript compilation:**
   ```bash
   cd sidecar && pnpm install && pnpm build
   ```

2. **Sidecar standalone test:**
   ```bash
   cd sidecar && node dist/index.js
   # Send: {"type":"ping"}
   # Expect: {"type":"pong","payload":{"timestamp":...}}
   ```

3. **Rust compilation with shell plugin:**
   ```bash
   cd src-tauri && cargo check
   ```

4. **Full dev mode:**
   ```bash
   pnpm tauri dev
   # UI should render
   # Creating task should spawn sidecar
   ```

5. **Task execution (requires OpenCode CLI):**
   - Create task via UI
   - Verify streaming messages in UI
   - Test cancel/interrupt buttons

## Notes

- **Skills directory:** Already exists at `apps/desktop/skills/` with 8 skills
- **API keys:** Passed from Rust secure storage to sidecar via IPC (not env vars in binary)
- **Platform:** Initial implementation targets macOS ARM64
- **OpenCode CLI:** Assumes installed globally; bundling is future work
- **Permission API:** Deferred to future phase (complex HTTP server setup)
- **Dev browser:** Deferred to future phase (Playwright integration)
