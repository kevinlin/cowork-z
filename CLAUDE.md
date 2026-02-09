# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork-Z is a macOS desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

**Quick reference — key commands:**
- Frontend: `pnpm build` / `pnpm test`
- Rust: `cd src-tauri && cargo build` / `cd src-tauri && cargo check`
- Sidecar: `cd src-tauri/sidecar-opencode && pnpm build` / `pnpm test`
- Full app: `pnpm tauri dev`

## Technology Stack

- **Desktop Framework:** Tauri 2.x (Rust backend + React/TypeScript frontend)
- **Frontend:** React 19 + TypeScript 5.8, Radix UI + shadcn/ui, Tailwind CSS 3.4, Zustand 5, Vite 7
- **Package Manager:** pnpm
- **Database:** SQLite (rusqlite), OS Keychain (keyring crate) for secrets
- **Sidecar:** Node.js + HTTP/SSE for OpenCode server API (`src-tauri/sidecar-opencode/`)

## Development Commands

```bash
# Full-stack development (Vite + Tauri + sidecar binary build)
pnpm tauri dev

# Frontend only (no Tauri window)
pnpm dev

# Build & type check
pnpm build                    # tsc + vite build
pnpm typecheck                # tsc --noEmit

# Rust
cd src-tauri && cargo check
cd src-tauri && cargo test

# Sidecar (separate pnpm workspace)
cd src-tauri/sidecar-opencode && pnpm install
cd src-tauri/sidecar-opencode && pnpm build          # TypeScript compile
cd src-tauri/sidecar-opencode && pnpm test           # Jest tests
cd src-tauri/sidecar-opencode && pnpm test:watch     # Watch mode
cd src-tauri/sidecar-opencode && pnpm build:binary   # macOS ARM64 standalone binary

# Testing
pnpm test                     # Vitest (frontend, watch mode)
pnpm test --run               # Vitest (CI mode, single run)
pnpm test:coverage            # Vitest with coverage

# Linting & formatting (Ultracite / Biome)
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/

# Production build
pnpm tauri build
```

**Important:** `pnpm tauri dev` auto-builds the sidecar binary before starting (configured in `tauri.conf.json` `beforeDevCommand`). Rust changes require app restart; frontend changes are hot-reloaded.

## Build & Validation

After making TypeScript edits, always run `pnpm typecheck` (or `tsc --noEmit`) before reporting completion. After Rust edits, run `cd src-tauri && cargo check`. Do not report success until compilation passes.

## Architecture

### Multi-Process Architecture

```
Tauri (Rust) ↔ stdin/stdout JSON-line ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
  src-tauri/src/                         src-tauri/sidecar-opencode/
  - sidecar.rs (process mgmt)           - opencode-client.ts (REST)
  - lib.rs (Tauri commands)             - event-stream.ts (SSE)
                                         - session-manager.ts
```

OpenCode server endpoints used by sidecar: `GET /event` (SSE), `POST /session/{id}/message`, `POST /permission/{id}/reply`, `POST /question/{id}/reply`, `PATCH /config`.

### Key Source Locations

- **`src/lib/tauri-api.ts`** — Centralized frontend API bridge. All Tauri `invoke()` calls and `listen()` event subscriptions go through here. This is the contract between frontend and Rust.
- **`src/lib/tauri-api-interface.ts`** — `TauriAPI` interface abstracting the backend. Wraps `getTauriApi()` from `tauri-api.ts` with synchronous event unlisteners.
- **`src/stores/taskStore.ts`** — Zustand store for all app state: tasks, permissions, questions, UI state.
- **`src-tauri/src/lib.rs`** — All Tauri command handlers (60+). Commands are registered in `invoke_handler`.
- **`src-tauri/src/sidecar.rs`** — Sidecar process lifecycle, IPC serialization (`SidecarCommand` enum), and event routing.
- **`src-tauri/sidecar-opencode/src/types.ts`** — Single source of truth for the IPC protocol between Rust and sidecar.

### IPC Protocol

Rust serializes `SidecarCommand` to JSON-line on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-line on stdout. Both use `snake_case` type discriminants.

**Rust → Sidecar:** `start_task`, `resume_session`, `cancel_task`, `abort_session`, `send_permission_reply`, `send_question_reply`, `ping`, `check_server`

**Sidecar → Rust:** `ready`, `pong`, `server_status`, `task_started`, `task_message_partial`, `task_message_complete`, `task_progress`, `task_complete`, `task_error`, `permission_request`, `question_request`, `log`, `error`

Rust emits Tauri events (e.g., `task:update`, `task:permission_request`, `task:question_request`) that the frontend listens to via `tauri-api.ts`.

### Sidecar Binary

- **Development:** `pnpm tauri dev` builds and bundles the sidecar binary automatically
- **Production:** Compiled to standalone binary using `pkg` (`@yao-pkg/pkg`)
- **Binary path:** `src-tauri/binaries/sidecar-opencode-<target-triple>`
- **Config:** Referenced in `tauri.conf.json` under `bundle.externalBin`
- **Constraint:** Sidecar must use CommonJS — `pkg` has limited ESM support

### Path Aliases

- `@` → `src/`
- `@shared` → `src/shared/`

Configured in both `tsconfig.json` and `vite.config.ts`.

## Settings UI Patterns

- **Textarea inputs** (User Prompt, MCP Servers JSON) must use `defaultValue` + `useRef` to avoid UI re-renders during user typing. Never use controlled `value` on settings textareas.
  - Use `textareaRef.current?.value` to read the latest text (avoids stale state in callbacks)
  - Debounce saves with `setTimeout` (500ms) — update React state only inside the debounce callback, not on every keystroke
  - On toggle, read from `ref.current?.value ?? stateValue` to get the latest content
  - See `src/components/settings/McpServersSettings.tsx` and `SettingsDialog.tsx` (User Prompt section) for reference

## Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev`, which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- Shell permissions for sidecar process management defined in `src-tauri/capabilities/default.json`
- OpenCode must be installed globally: `npm install -g opencode-ai`
- Provider configuration forms are in `src/components/settings/` (Anthropic, OpenAI, Google, Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM)
- Reference Electron app source preserved at `apps/desktop/` for reference

## Expected Build Warnings

**pnpm esbuild build script warning**: This is a security feature, not a bug. The warning appears because pnpm prevents automatic execution of build scripts to protect against supply chain attacks. The esbuild binary is already installed and functional - everything works correctly. This warning can be safely ignored. If you prefer to suppress it, run `pnpm approve-builds` in the sidecar directory.

## Design Documentation

See `docs/specs/`:
- `open-cowork/requirements.md` — Feature requirements
- `open-cowork/design.md` — Technical design
- `sidecar-opencode-rewrite/plan_sidecar-opencode-rewrite.md` — Sidecar rewrite plan (complete)
