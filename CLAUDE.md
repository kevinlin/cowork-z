# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork Z is a macOS desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. The application integrates with the OpenCode SDK to enable users to interact with AI agents that can safely execute code, manipulate files, and perform multi-step workflows while maintaining strong isolation from the host system.

**Current Status:** Migration from Electron complete. Frontend, backend, and sidecar are all implemented. The app is functional for task execution with OpenCode CLI.

## Technology Stack

- **Desktop Framework:** Tauri 2.x (Rust backend + React/TypeScript frontend)
- **Frontend:** React 19 + TypeScript 5.8
- **UI Components:** Radix UI + shadcn/ui patterns
- **Styling:** Tailwind CSS 3.4
- **State Management:** Zustand 5
- **Build Tool:** Vite 7
- **Package Manager:** pnpm
- **Database:** SQLite (rusqlite)
- **Secure Storage:** OS Keychain (keyring crate)
- **Sidecar:** Node.js + node-pty for OpenCode CLI integration

## Development Commands

### Frontend Development
```bash
# Install dependencies
pnpm install

# Start development server (runs both Vite and Tauri)
pnpm tauri dev

# Build frontend only
pnpm build

# Type check
pnpm exec tsc --noEmit
```

### Sidecar Development
```bash
# Install sidecar dependencies
cd src-tauri/sidecar && pnpm install

# Build sidecar TypeScript
cd src-tauri/sidecar && pnpm build

# Run sidecar in dev mode (with watch)
cd src-tauri/sidecar && pnpm dev

# Build standalone binary for current platform
cd src-tauri/sidecar && pnpm build:binary
```

### Tauri/Rust Development
```bash
# Run the Tauri app in development mode
pnpm tauri dev

# Build production app bundle
pnpm tauri build

# Check Rust code
cd src-tauri && cargo check

# Run Rust tests
cd src-tauri && cargo test
```

### Full Build
```bash
# Production build (compiles Rust + bundles frontend + creates macOS app)
pnpm tauri build
```

## Project Architecture

### Multi-Process Architecture

The application follows a sidecar pattern where the Tauri app spawns and manages a Node.js subprocess:

```
┌─────────────────────────────────────────────────────────────┐
│   Tauri Desktop App                                          │
│   ┌──────────────┐  ┌─────────────────────────────────────┐ │
│   │   React UI   │  │  Rust Backend (lib.rs)               │ │
│   │  (WebView)   │←→│  - 50+ Tauri commands                │ │
│   │              │  │  - SQLite database (rusqlite)        │ │
│   │              │  │  - OS Keychain (keyring)             │ │
│   │              │  │  - Sidecar manager (tauri-plugin-shell)│
│   └──────────────┘  └─────────────────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────┘
                              │ stdin/stdout (JSON-line)
                              ↓
         ┌────────────────────────────────────────────────────┐
         │  Node.js Sidecar Process (src-tauri/sidecar/)       │
         │  ├── index.ts        # IPC entry point             │
         │  ├── task-manager.ts # Multi-task management       │
         │  ├── adapter.ts      # OpenCode CLI adapter        │
         │  ├── stream-parser.ts# NDJSON parsing              │
         │  ├── config-generator.ts # OpenCode config         │
         │  └── cli-path.ts     # CLI binary resolution       │
         └────────────────────────────────────────────────────┘
                              │ PTY (node-pty)
                              ↓
         ┌────────────────────────────────────────────────────┐
         │  OpenCode CLI                                      │
         │  opencode run --format json --agent accomplish     │
         └────────────────────────────────────────────────────┘
```

### Directory Structure

**Frontend (`src/`):**
- `main.tsx` - React app entry point with HashRouter
- `App.tsx` - Main application component with routing
- `pages/` - Page components (Home, Execution)
- `components/` - Reusable UI components
  - `ui/` - Base UI components (button, dialog, card, etc.)
  - `layout/` - Layout components (Sidebar, Header)
  - `settings/` - Provider configuration forms
  - `TaskLauncher/` - Command palette modal
- `stores/taskStore.ts` - Zustand state management
- `lib/tauri-api.ts` - Tauri command bridge
- `shared/` - Shared types and constants

**Backend (`src-tauri/src/`):**
- `main.rs` - Tauri application entry point
- `lib.rs` - Tauri commands (50+ implementations)
- `sidecar.rs` - Sidecar process management
- `db/` - Database layer
  - `mod.rs` - Database connection with app data directory
  - `migrations.rs` - Schema migrations
  - `tasks.rs` - Task CRUD operations
  - `settings.rs` - App settings
  - `providers.rs` - Provider management
- `secure_storage.rs` - OS Keychain integration

**Sidecar (`src-tauri/sidecar/src/`):**
- `index.ts` - IPC entry point, JSON-line protocol
- `types.ts` - OpenCode types, IPC protocol definitions
- `stream-parser.ts` - NDJSON parser with Windows PTY handling
- `adapter.ts` - OpenCode CLI adapter (node-pty)
- `task-manager.ts` - Multi-task lifecycle management
- `config-generator.ts` - OpenCode config generation
- `cli-path.ts` - CLI binary resolution

**Configuration:**
- `vite.config.ts` - Vite configuration with path aliases
- `tsconfig.json` - TypeScript compiler settings
- `tailwind.config.ts` - Tailwind CSS theme configuration
- `src-tauri/tauri.conf.json` - Tauri configuration
- `src-tauri/Cargo.toml` - Rust dependencies
- `src-tauri/capabilities/default.json` - Shell permissions

**Reference Source (`apps/desktop/`):**
- Original Electron app source (preserved for reference)
- `src/main/opencode/` - Original OpenCode integration code

## Key Implementation Details

### Tauri API Bridge Pattern

The frontend uses a centralized API bridge (`src/lib/tauri-api.ts`) for all Tauri commands:

```typescript
// Frontend API calls
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Command invocation
export async function startTask(config: TaskConfig): Promise<Task> {
  return invoke<Task>('start_task', { config });
}

// Event subscription (returns Promise<UnlistenFn>)
export async function onTaskUpdate(cb: (e: TaskUpdateEvent) => void) {
  return listen<TaskUpdateEvent>('task:update', (e) => cb(e.payload));
}
```

### Sidecar Communication

The Rust backend manages the sidecar via `tauri-plugin-shell`:

```rust
// src-tauri/src/sidecar.rs
let (rx, child) = shell.sidecar("cowork-sidecar").spawn()?;

// Send command
child.write(json_command.as_bytes())?;

// Receive events
while let Some(event) = rx.recv().await {
    match event {
        CommandEvent::Stdout(line) => {
            let event: SidecarEvent = serde_json::from_str(&line)?;
            app.emit(event_name, payload)?;
        }
        // ...
    }
}
```

### IPC Protocol

**Rust → Sidecar (stdin):**
```json
{"type":"start_task","taskId":"task_123","payload":{"taskId":"task_123","prompt":"...","apiKeys":{...}}}
```

**Sidecar → Rust (stdout):**
```json
{"type":"task_message","taskId":"task_123","payload":{"message":{...}}}
{"type":"task_progress","taskId":"task_123","payload":{"progress":{"stage":"executing"}}}
{"type":"task_complete","taskId":"task_123","payload":{"result":{"status":"success"}}}
```

### State Management

Uses Zustand for global state with the store at `src/stores/taskStore.ts`:
- Task state (current task, history, loading)
- Permission handling
- Setup progress tracking
- UI state (launcher modal)

## Provider Integrations

The app supports multiple AI providers with dedicated configuration forms:
- **Anthropic** - Claude models
- **OpenAI** - GPT models
- **Google** - Gemini models
- **AWS Bedrock** - Multiple foundation models
- **Azure Foundry** - Azure OpenAI (API key or Entra ID auth)
- **Ollama** - Local models (connection test implemented)
- **OpenRouter** - Aggregated providers
- **LiteLLM** - Proxy for multiple providers (connection test implemented)

Provider settings are managed via `src/components/settings/` with forms for each provider.

## Requirements and Design

See documentation in `docs/specs/`:
- `open-cowork/requirements.md` - Detailed feature requirements
- `open-cowork/design.md` - Technical design document
- `electron-to-tauri-migration/` - Migration documentation

## Vite Configuration

The Vite dev server is configured for Tauri:
- Fixed port: `1420` (required by Tauri)
- HMR on port `1421`
- Path aliases: `@` → `src/`, `@shared` → `src/shared/`
- Ignores `src-tauri/` directory for file watching
- Clears screen disabled to show Rust errors

## TypeScript Configuration

- Strict mode enabled (`strict: true`)
- Unused locals/parameters checking enabled
- Path aliases configured in `tsconfig.json`
- Module resolution: `bundler` mode for Vite
- JSX: `react-jsx` (React 17+ transform)

## Important Notes

- The app identifier is `com.kevinlin.cowork-z`
- Development uses port 1420 - ensure it's available
- Rust changes require app restart (not hot-reloaded)
- Frontend changes are hot-reloaded via Vite HMR
- Sidecar uses a placeholder script in dev mode; build with `pnpm build:binary` for production
- API keys are stored in OS Keychain (macOS Keychain, Windows Credential Manager)
- Task history is stored in SQLite at `~/Library/Application Support/Cowork Z/`
- OpenCode CLI must be installed globally: `npm install -g opencode-ai`

## Future Enhancements

- Azure Foundry connection testing (requires Azure SDK)
- OpenRouter model fetching (requires API key)
- Bedrock model fetching (requires AWS SDK)
- Dev Browser Integration (Playwright support)
- Permission API HTTP server
