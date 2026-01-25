# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork Z is a macOS desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. The application integrates with the OpenCode SDK to enable users to interact with AI agents that can safely execute code, manipulate files, and perform multi-step workflows while maintaining strong isolation from the host system.

**Current Status:** Frontend migrated from Electron, backend has stub implementations. Task execution requires sidecar implementation.

## Technology Stack

- **Desktop Framework:** Tauri 2.x (Rust backend + React/TypeScript frontend)
- **Frontend:** React 19 + TypeScript 5.8
- **UI Components:** Radix UI + shadcn/ui patterns
- **Styling:** Tailwind CSS 3.4
- **State Management:** Zustand 5
- **Build Tool:** Vite 7
- **Package Manager:** pnpm
- **Sandbox:** macOS App Sandbox with sandbox-exec (planned)

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

### Multi-Process Architecture (Planned)

The application follows a sidecar pattern where the Tauri app spawns and manages a Node.js subprocess:

```
┌─────────────────────────────────────┐
│   Tauri Desktop App                 │
│   ┌──────────────┐  ┌─────────────┐ │
│   │   React UI   │  │  Rust Core  │ │
│   │  (WebView)   │←→│   (IPC)     │ │
│   └──────────────┘  └─────────────┘ │
└──────────────┬──────────────────────┘
               │ stdin/stdout (JSON)
               ↓
    ┌──────────────────────────────────┐
    │  Node.js Sidecar Process         │
    │  - OpenCode CLI (via node-pty)   │
    │  - Task Manager                  │
    │  - Provider SDKs (AWS, Azure)    │
    └──────────────────────────────────┘
               │
               ↓
    ┌──────────────────────────────────┐
    │  Sandboxed Execution             │
    │  (sandbox-exec)                  │
    │  - Tool Execution                │
    │  - File Operations               │
    └──────────────────────────────────┘
```

### Current Structure

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
- `lib/tauri-api.ts` - Tauri command bridge (replaces Electron IPC)
- `shared/` - Shared types and constants

**Backend (`src-tauri/`):**
- `src/main.rs` - Tauri application entry point
- `src/lib.rs` - Tauri commands (50+ stub implementations)
- `Cargo.toml` - Rust dependencies
- `tauri.conf.json` - Tauri configuration

**Static Assets (`public/`):**
- `assets/` - Images and logos
- `fonts/` - DM Sans font files

**Configuration:**
- `vite.config.ts` - Vite configuration with path aliases
- `tsconfig.json` - TypeScript compiler settings
- `tailwind.config.ts` - Tailwind CSS theme configuration
- `package.json` - Frontend dependencies and scripts

### Key Directories (Planned)

- `~/.open-cowork/` - User configuration and settings
- `~/Library/Application Support/Cowork Z/` - App data and database
- `~/Library/Logs/Cowork Z/` - Application logs

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

```rust
// Rust command definition (src-tauri/src/lib.rs)
#[tauri::command]
async fn start_task(config: TaskConfig) -> Result<Task, String> {
    // TODO: Implement with sidecar
    Err("Task execution not yet implemented".to_string())
}
```

### State Management

Uses Zustand for global state with the store at `src/stores/taskStore.ts`:
- Task state (current task, history, loading)
- Permission handling
- Setup progress tracking
- UI state (launcher modal)

### Event Subscriptions

Tauri events are async - subscriptions return `Promise<UnlistenFn>`:

```typescript
useEffect(() => {
  const unlisteners: (() => void)[] = [];

  api.onTaskUpdate((event) => {
    // Handle event
  }).then((unsub) => unlisteners.push(unsub));

  return () => {
    unlisteners.forEach((unsub) => unsub());
  };
}, []);
```

### Sidecar Communication (To Be Implemented)

Planned architecture uses JSON messages over stdin/stdout:
- Tauri spawns Node.js sidecar with bundled runtime
- Sidecar runs OpenCode CLI via node-pty
- Commands: start_task, cancel_task, resume_session
- Events streamed back: task:update, permission:request, task:progress

## Provider Integrations

The app supports multiple AI providers with dedicated configuration forms:
- **Anthropic** - Claude models
- **OpenAI** - GPT models
- **Google** - Gemini models
- **AWS Bedrock** - Multiple foundation models
- **Azure Foundry** - Azure OpenAI (API key or Entra ID auth)
- **Ollama** - Local models
- **OpenRouter** - Aggregated providers
- **LiteLLM** - Proxy for multiple providers

Provider settings are managed via `src/components/settings/` with forms for each provider.

## Requirements and Design

See documentation in `docs/specs/open-cowork/`:
- `requirements.md` - Detailed feature requirements with acceptance criteria
- `design.md` - Technical design document with architecture details

Key requirements:
1. Chat interface for AI agent interaction
2. OpenCode SDK integration for agent orchestration
3. Tool system (file read/write/edit, bash execution, code search)
4. Sandboxed execution environment
5. Session workspace management
6. Configuration (API keys, model selection, theme)
7. Error handling with user-friendly messages

## Migration Status

**Completed:**
- Frontend migrated from `apps/desktop/src/renderer/` to `src/`
- Shared types migrated to `src/shared/`
- Tauri API bridge created (`src/lib/tauri-api.ts`)
- Rust stub commands for all 50+ IPC handlers
- TypeScript compiles without errors
- Vite builds successfully

**Pending:**
- Rust database layer (rusqlite) for task history
- Secure storage (OS Keychain) for API keys
- Node.js sidecar for OpenCode CLI integration
- Provider integration implementations (Ollama, OpenRouter, etc.)
- Skills bundling as resources

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
- The sidecar is not yet implemented - task execution will fail
- API key storage is not yet implemented - provider configuration won't persist
