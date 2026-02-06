# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork Z is a macOS desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. The application integrates with the OpenCode SDK to enable users to interact with AI agents that can safely execute code, manipulate files, and perform multi-step workflows while maintaining strong isolation from the host system.

**Current Status:** Migration from Electron complete. The app is functional for task execution with OpenCode CLI. A sidecar rewrite is in progress — migrating from PTY-based `opencode run` to HTTP/SSE-based `opencode serve` (see Sidecar Modules below).

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
- **Sidecar (legacy):** Node.js + node-pty for OpenCode CLI integration (`src-tauri/sidecar/`)
- **Sidecar (new, in development):** Node.js + HTTP/SSE for OpenCode server API (`src-tauri/sidecar-opencode/`)

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
pnpm typecheck
```

#### Linter & Formatter
This project uses **Ultracite**, Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

```bash
# Format code
pnpm dlx ultracite fix src/ src-tauri/sidecar/ src-tauri/sidecar-opencode/

# Check for issues
pnpm dlx ultracite check src/ src-tauri/sidecar/ src-tauri/sidecar-opencode/

# Diagnose setup
pnpm dlx ultracite doctor
```

### Sidecar Development (Legacy — `src-tauri/sidecar/`)

> **Note:** This is the legacy PTY-based sidecar using `opencode run`. It is being replaced by `sidecar-opencode`. Do not add new features here.

```bash
cd src-tauri/sidecar && pnpm install
cd src-tauri/sidecar && pnpm build
cd src-tauri/sidecar && pnpm test
cd src-tauri/sidecar && pnpm build:binary           # macOS ARM64
cd src-tauri/sidecar && pnpm build:binary:x64       # macOS Intel
cd src-tauri/sidecar && pnpm build:binary:win       # Windows
cd src-tauri/sidecar && pnpm build:binary:linux     # Linux
```

### Sidecar Development (New — `src-tauri/sidecar-opencode/`)

> **Note:** This is the new HTTP/SSE-based sidecar using `opencode serve`. Under active development — see `docs/specs/sidecar-opencode-rewrite/plan_sidecar-opencode-rewrite.md` for the phased implementation plan.

```bash
cd src-tauri/sidecar-opencode && pnpm install
cd src-tauri/sidecar-opencode && pnpm build          # TypeScript compile
cd src-tauri/sidecar-opencode && pnpm test           # Jest tests
cd src-tauri/sidecar-opencode && pnpm test:watch     # Watch mode
cd src-tauri/sidecar-opencode && pnpm build:binary   # macOS ARM64 standalone binary
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

### Testing
```bash
# Run frontend tests (Vitest)
pnpm test

# Run frontend tests in watch mode
pnpm test

# Run frontend tests with coverage
pnpm test:coverage

# Run frontend tests once (CI mode)
pnpm test --run

# Run legacy sidecar tests (Jest)
cd src-tauri/sidecar && pnpm test

# Run new sidecar tests (Jest)
cd src-tauri/sidecar-opencode && pnpm test

# Run new sidecar tests in watch mode
cd src-tauri/sidecar-opencode && pnpm test:watch

# Run all tests (frontend + both sidecars)
pnpm test --run && cd src-tauri/sidecar && pnpm test && cd ../sidecar-opencode && pnpm test
```

## Project Architecture

### Multi-Process Architecture

The application follows a sidecar pattern where the Tauri app spawns and manages a Node.js subprocess:

**Current architecture (legacy sidecar):**
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ PTY (NDJSON) ↔ opencode run
                                    (src-tauri/sidecar/)
```

**New architecture (sidecar-opencode, in development):**
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
                                    (src-tauri/sidecar-opencode/)
                                    - GET /event (SSE stream)
                                    - POST /session/{id}/message
                                    - POST /permission/{id}/reply
                                    - POST /question/{id}/reply
                                    - PATCH /config
```

The new sidecar eliminates PTY/NDJSON complexity and enables native permission/question handling through OpenCode's REST API.

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
- `lib.rs` - Tauri commands (60+ implementations)
- `sidecar.rs` - Sidecar process management
- `db/` - Database layer
  - `mod.rs` - Database connection with app data directory
  - `migrations.rs` - Schema migrations
  - `tasks.rs` - Task CRUD operations
  - `settings.rs` - App settings
  - `providers.rs` - Provider management
- `secure_storage.rs` - OS Keychain integration

**Legacy Sidecar (`src-tauri/sidecar/src/`) — being replaced:**
- `index.ts` - IPC entry point, JSON-line protocol
- `adapter.ts` - OpenCode CLI adapter (node-pty)
- `stream-parser.ts` - NDJSON parser with Windows PTY handling
- `task-manager.ts` - Multi-task lifecycle management
- `config-generator.ts` - OpenCode config generation

**New Sidecar (`src-tauri/sidecar-opencode/src/`) — under development:**
- `index.ts` - IPC entry point (stdin/stdout JSON-line)
- `opencode-client.ts` - HTTP client for OpenCode server REST API
- `event-stream.ts` - SSE event stream handler with auto-reconnect
- `session-manager.ts` - Session lifecycle management (start, resume, abort)
- `config-builder.ts` - Runtime config generation for PATCH /config
- `process-manager.ts` - Spawn/manage `opencode serve` process
- `logger.ts` - File logging to `~/.local/share/opencode/log/`
- `types.ts` - OpenCode API types + IPC protocol definitions

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

The Rust backend manages the sidecar via `tauri-plugin-shell` using JSON-line IPC over stdin/stdout. The sidecar binary name is configured in `src-tauri/tauri.conf.json` under `bundle.externalBin`.

Currently uses the legacy sidecar (`cowork-sidecar`). Will switch to `sidecar-opencode` once the rewrite is complete.

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

### Sidecar Binary Management

- **Development**: Sidecar runs from TypeScript source via `tsx watch`
- **Production**: Compiled to standalone binary using `pkg` (`@yao-pkg/pkg`)
- **Legacy binary**: `src-tauri/binaries/cowork-sidecar-<target-triple>`
- **New binary**: `src-tauri/binaries/sidecar-opencode-<target-triple>`
- **Configuration**: Referenced in `tauri.conf.json` under `bundle.externalBin`
- **Current binary**: Only macOS ARM64 (`aarch64-apple-darwin`) is committed
- **Important**: Both sidecars use CommonJS (`"module": "CommonJS"`) — `pkg` has limited ESM support

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
- `sidecar-opencode-rewrite/plan_sidecar-opencode-rewrite.md` - Phased plan for sidecar rewrite (Phases 1-2 complete, Phase 3+ in progress)

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
- `pnpm dev` runs only the Vite dev server (frontend only)
- `pnpm tauri dev` runs the full stack (Vite + Tauri + spawns the app window)
- Always use `pnpm tauri dev` for full-stack development
- Rust changes require app restart (not hot-reloaded)
- Frontend changes are hot-reloaded via Vite HMR
- Sidecar uses a placeholder script in dev mode; build with `pnpm build:binary` for production
- Shell permissions are defined in `src-tauri/capabilities/default.json`
- Currently allows: spawn, stdin-write, kill, and open commands
- Required for sidecar process management via `tauri-plugin-shell`
- API keys are stored in OS Keychain (macOS Keychain, Windows Credential Manager)
- Task history is stored in SQLite at `~/Library/Application Support/Cowork Z/`
- OpenCode CLI must be installed globally: `npm install -g opencode-ai`
