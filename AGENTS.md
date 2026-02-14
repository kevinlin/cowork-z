# AGENTS.md

## Project Overview

Cowork-Z is a macOS desktop application built with **Tauri 2.x** that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

**Tech stack:** Tauri 2.x (Rust backend + React/TypeScript frontend), React 19, TypeScript 5.8, Radix UI + shadcn/ui, Tailwind CSS 3.4, Zustand 5, Vite 7, SQLite (rusqlite), pnpm.

## Repository Structure

```
src/                          # React/TypeScript frontend
  components/
    layout/                   # App shell (Sidebar, SettingsDialog)
    ui/                       # Radix UI + shadcn/ui primitives
    sidebar/                  # Sidebar panels (TodoPanel, ArtifactsPanel, FolderPanel)
    settings/                 # Provider configuration forms
    markdown/                 # Rich message rendering
    media/                    # Image/video thumbnails and modals
  pages/
    Home.tsx                  # Task launcher (route: /)
    Execution.tsx             # Active task chat (route: /task/:taskId)
  stores/
    taskStore.ts              # Zustand store — all app state
  lib/
    tauri-api.ts              # Frontend API bridge (all invoke/listen calls)
    tauri-api-interface.ts    # TauriAPI interface abstraction
  shared/types/
    task.ts                   # Core task types (Task, TaskMessage, etc.)
  hooks/
    useKeyboardShortcuts.tsx  # Cmd+, Cmd+N, Cmd+K, Cmd+Enter, Escape

src-tauri/                    # Rust/Tauri backend
  src/
    lib.rs                    # App entry point, plugin/menu setup, command registration
    commands/                 # Tauri command handlers by domain
      tasks.rs, settings.rs, api_keys.rs, providers.rs,
      folder_permissions.rs, ollama.rs, bedrock.rs,
      azure_foundry.rs, litellm.rs, opencode_cli.rs,
      updates.rs, app_info.rs, logging.rs
    db/                       # SQLite persistence layer
      tasks.rs, settings.rs, providers.rs,
      folder_permissions.rs, migrations.rs
    sidecar.rs                # Sidecar process lifecycle and IPC
    types.rs                  # Shared Rust types (serializable structs)
    secure_storage.rs         # OS Keychain wrapper (keyring crate)
  Cargo.toml

src-tauri/sidecar-opencode/   # Node.js sidecar (separate pnpm workspace)
  src/
    types.ts                  # IPC protocol types (source of truth)
    opencode-client.ts        # REST client for OpenCode server
    event-stream.ts           # SSE client for OpenCode server
    session-manager.ts        # Session lifecycle

docs/specs/                   # Design documentation
  cowork-z/requirements.md    # Feature requirements
  cowork-z/design.md          # Technical design
```

**Path aliases:** `@` maps to `src/`, `@shared` maps to `src/shared/` (configured in `tsconfig.json` and `vite.config.ts`).

## Architecture

```
Tauri (Rust) <-> stdin/stdout JSON-line <-> Node.js Sidecar <-> HTTP/SSE <-> opencode serve
```

- **IPC protocol:** Rust serializes `SidecarCommand` to JSON-line on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-line on stdout. Both use `snake_case` type discriminants.
- **Rust -> Sidecar commands:** `start_task`, `resume_session`, `cancel_task`, `abort_session`, `send_permission_reply`, `send_question_reply`, `ping`, `check_server`
- **Sidecar -> Rust events:** `ready`, `pong`, `server_status`, `task_started`, `task_message_partial`, `task_message_complete`, `task_progress`, `task_complete`, `task_error`, `permission_request`, `question_request`, `log`, `error`
- **Frontend events:** Rust emits Tauri events (`task:update`, `task:permission_request`, `task:question_request`) that the frontend listens to via `tauri-api.ts`.
- **OpenCode server endpoints:** `GET /event` (SSE), `POST /session/{id}/message`, `POST /permission/{id}/reply`, `POST /question/{id}/reply`, `PATCH /config`.

## Development Commands

```bash
# Full-stack development (Vite + Tauri + sidecar binary build)
pnpm tauri dev

# Frontend only (no Tauri window)
pnpm dev

# Build and type check
pnpm build                    # tsc + vite build
pnpm typecheck                # tsc --noEmit

# Rust
cd src-tauri && cargo check
cd src-tauri && cargo test

# Sidecar (separate pnpm workspace)
cd src-tauri/sidecar-opencode && pnpm install
cd src-tauri/sidecar-opencode && pnpm build          # TypeScript compile
cd src-tauri/sidecar-opencode && pnpm test           # Jest tests
cd src-tauri/sidecar-opencode && pnpm build:binary   # macOS ARM64 standalone binary

# Frontend tests
pnpm test --run               # Vitest single run
pnpm test:coverage            # Vitest with coverage

# Linting and formatting (Ultracite / Biome)
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/
```

## Testing

### Frontend (Vitest)

- Runner: Vitest with jsdom environment
- Location: `src/**/*.{test,spec}.{ts,tsx}` (collocated with source files)
- Setup: `src/test/setup.ts` (mocks `matchMedia` and `ResizeObserver`)
- Libraries: @testing-library/react, @testing-library/jest-dom, @testing-library/user-event

```bash
pnpm test --run              # Single run (use this for verification)
pnpm test:coverage           # With coverage report
pnpm test path/to/file       # Run specific test file
```

### Sidecar (Jest)

```bash
cd src-tauri/sidecar-opencode && pnpm test
cd src-tauri/sidecar-opencode && pnpm test:coverage
```

### Rust

```bash
cd src-tauri && cargo test
```

## Code Style and Conventions

This project uses **Ultracite** (Biome engine) for formatting and linting. Run `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/` after every change.

### TypeScript

- Use `const` by default, `let` only when reassignment is needed, never `var`
- Arrow functions for callbacks and short functions
- `for...of` over `.forEach()` and indexed `for` loops
- Optional chaining (`?.`) and nullish coalescing (`??`) for safe property access
- Template literals over string concatenation
- Prefer `unknown` over `any`
- Always `await` promises in async functions
- Throw `Error` objects, not strings

### React

- Function components only (no class components)
- Hooks at the top level only, never conditionally
- Specify all hook dependency arrays correctly
- Use `key` prop with unique IDs (not array indices) in iterables
- Semantic HTML and ARIA attributes for accessibility
- React 19: use `ref` as a prop instead of `React.forwardRef`

### Settings UI Pattern

Textarea inputs (User Prompt, MCP Servers JSON) must use `defaultValue` + `useRef` to avoid re-renders during typing. See `src/components/settings/McpServersSettings.tsx` for reference.

### Sidecar Constraints

- Sidecar must use **CommonJS** (not ESM) — the `pkg` bundler fails with ESM
- Do not include `.js` extensions in TypeScript imports
- Binary is built with `@yao-pkg/pkg` targeting macOS ARM64

## Verification (MANDATORY before completing any task)

After TypeScript edits:
```bash
pnpm typecheck
```

After Rust edits:
```bash
cd src-tauri && cargo check
```

After any code change, run the formatter:
```bash
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
```

Do not report a task as complete until all applicable checks pass.

## Post-Feature Completion Checklist

After completing any feature or plan implementation:

1. Update requirement status in `docs/specs/cowork-z/requirements.md` (add checkmark to heading, check off in TODO section)
2. Append to `UPDATE_LOG.md` describing the completed feature with its requirement number
3. Verify `pnpm typecheck` and `cd src-tauri && cargo check` both pass

## Off-Limits

- Do not modify files in `src-tauri/binaries/` directly (these are built artifacts)
- Do not commit API keys, secrets, or `.env` files (keys are stored in OS Keychain)
- Do not use ESM syntax in sidecar code (`src-tauri/sidecar-opencode/`)
- Do not add `console.log`, `debugger`, or `alert` statements to production code
- Do not use dynamic code execution or raw HTML injection patterns
- Always sanitize and escape user-provided content before rendering

## Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev` which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- OpenCode must be installed globally: `npm install -g opencode-ai`
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- The `pnpm esbuild` build script warning is expected and can be safely ignored
