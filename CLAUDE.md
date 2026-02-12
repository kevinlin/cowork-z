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

## Testing

### Frontend Tests (Vitest)
- **Test runner:** Vitest with jsdom environment
- **Location:** `src/**/*.{test,spec}.{ts,tsx}` (collocated with source files)
- **Setup file:** `src/test/setup.ts` — mocks `matchMedia` and `ResizeObserver` for jsdom
- **Libraries:** @testing-library/react, @testing-library/jest-dom, @testing-library/user-event

**Running tests:**
```bash
pnpm test                # Watch mode (default)
pnpm test --run          # Single run (CI mode)
pnpm test:coverage       # Coverage report
pnpm test path/to/file   # Run specific test file
```

**Example test locations:**
- UI components: `src/components/ui/__tests__/`
- Layout components: `src/components/layout/*.test.tsx`
- Pages: `src/pages/__tests__/`
- Store: `src/stores/*.test.ts`

### Sidecar Tests (Jest)
```bash
cd src-tauri/sidecar-opencode
pnpm test               # Single run
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
```

### Rust Tests
```bash
cd src-tauri && cargo test
```

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

- **Development:** `pnpm tauri dev` auto-builds the ARM64 binary (via `beforeDevCommand` in `tauri.conf.json`)
- **Production:** Compiled to standalone binary using `pkg` (`@yao-pkg/pkg`)
- **Binary path:** `src-tauri/binaries/sidecar-opencode-<target-triple>`
- **Config:** Referenced in `tauri.conf.json` under `bundle.externalBin`
- **Constraint:** Sidecar must use CommonJS — `pkg` has limited ESM support

**Manual binary builds** (from `src-tauri/sidecar-opencode/`):
```bash
pnpm build:binary              # macOS ARM64 (default)
pnpm build:binary:x64          # macOS x64
pnpm build:binary:win          # Windows x64
pnpm build:binary:linux        # Linux x64
pnpm build:binary:linux-arm64  # Linux ARM64
```

### Path Aliases

- `@` → `src/`
- `@shared` → `src/shared/`

Configured in both `tsconfig.json` and `vite.config.ts`.

### Frontend Structure

**Pages** (react-router-dom)
- `/` — `src/pages/Home.tsx` — Task launcher and empty state
- `/task/:taskId` — `src/pages/Execution.tsx` — Active task chat view

**State Management** (Zustand)
- `src/stores/taskStore.ts` — Single global store for all app state
  - Tasks, permissions, questions
  - Active task tracking
  - UI state (settings dialog, launcher modal)

**Component Organization**
- `src/components/layout/` — App shell (Sidebar, SettingsDialog)
- `src/components/ui/` — Radix UI + shadcn/ui primitives
- `src/components/sidebar/` — Sidebar panels (TodoPanel, ArtifactsPanel, FolderPanel)
- `src/components/settings/` — Provider configuration forms
- `src/components/markdown/` — Rich message rendering (EnhancedLink, file/URL detection)
- `src/components/media/` — Image/video thumbnails and modals

**Shared Types**
- `src/shared/types/task.ts` — Core task types
  - `Task`, `TaskMessage`, `TaskStatus`, `TaskProgress`
  - `Todo`, `Artifact` (session-scoped entities)
  - `PartialMessage` (streaming support)

## Settings UI Patterns

**Textarea inputs** (User Prompt, MCP Servers JSON) must use `defaultValue` + `useRef` to avoid UI re-renders during typing. Never use controlled `value` on settings textareas.
- Read latest value with `textareaRef.current?.value`
- Debounce saves with `setTimeout` (500ms)
- See `src/components/settings/McpServersSettings.tsx` for reference implementation

## Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev`, which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- Shell permissions for sidecar process management defined in `src-tauri/capabilities/default.json`
- OpenCode must be installed globally: `npm install -g opencode-ai`
- Provider configuration forms are in `src/components/settings/` (Anthropic, OpenAI, Google, Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM)
- Reference Electron app source preserved at `apps/desktop/` for reference
- Keyboard shortcuts implemented via `src/hooks/useKeyboardShortcuts.tsx`:
  - App-level: `Cmd+,` (settings), `Cmd+N` (new task), `Cmd+K` (launcher)
  - Chat-level: `Cmd+Enter` (send), `Escape` (cancel)

## Expected Build Warnings

**pnpm esbuild build script warning**: This is a security feature, not a bug. The warning appears because pnpm prevents automatic execution of build scripts to protect against supply chain attacks. The esbuild binary is already installed and functional - everything works correctly. This warning can be safely ignored. If you prefer to suppress it, run `pnpm approve-builds` in the sidecar directory.

## Post-Feature Completion Checklist (MANDATORY)

**IMPORTANT: After completing ANY feature or plan implementation, you MUST perform ALL of these steps before reporting completion. Do not skip this section — it is as important as passing tests.**

1. **Update requirement status** in `docs/specs/cowork-z/requirements.md`:
   - Add `✅` to the requirement heading (e.g., `#### 4.4 About Panel ✅`)
   - Add a plan reference link (`> **Plan:** [Name](plan_name.md)`) if an implementation plan exists
   - Check off the item in the "Outstanding Feature TODO" section at the bottom
   - Add the plan to the "Implementation Plans Index" table if applicable
2. **Add to UPDATE_LOG.md**: Append to the current version section describing the completed feature with its requirement number (e.g., `- 4.5 Feedback — description`)
3. **Verify** both `pnpm typecheck` and `cd src-tauri && cargo check` pass before reporting completion

## Design Documentation

See `docs/specs/`:
- `cowork-z/requirements.md` — Feature requirements
- `cowork-z/design.md` — Technical design
- `sidecar-opencode-rewrite/plan_sidecar-opencode-rewrite.md` — Sidecar rewrite plan (complete)
