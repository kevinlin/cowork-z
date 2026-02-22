# AGENTS.md

## Project Overview

Cowork-Z is a cross-platform desktop application built with **Tauri 2.x** that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

**Tech stack:** Tauri 2.x (Rust backend + React/TypeScript frontend), React 19, TypeScript 5.8, Radix UI + shadcn/ui, Tailwind CSS 3.4, Zustand 5, Vite 7, SQLite (rusqlite), pnpm.

## Repository Structure

```
src/                          # React/TypeScript frontend
  components/
    layout/                   # App shell (Sidebar, SettingsDialog)
    ui/                       # Radix UI + shadcn/ui primitives
    sidebar/                  # Sidebar panels (FileTreePanel, TodoPanel, ArtifactsPanel, FolderPanel)
    file-preview/             # File preview panel (CodePreview, MarkdownPreview, MediaPreview, etc.)
    settings/                 # Provider configuration forms
    markdown/                 # Rich message rendering
    media/                    # Image/video thumbnails and modals
    landing/                  # Task input bar and drag-drop integration
    skills-manager/           # Skills Manager window UI (repo management, skill grid, file tree)
  pages/
    Home.tsx                  # Task launcher (route: /)
    Execution.tsx             # Active task chat (route: /task/:taskId)
  stores/
    taskStore.ts              # Zustand store — tasks, permissions, questions, UI state
    workspaceStore.ts         # Workspace list, active workspace, switchWorkspace()
    filePreviewStore.ts       # File preview panel state, openPreview(), fullscreen toggle
    skillsStore.ts            # Installed skills list for slash-command autocomplete
    skillsManagerStore.ts     # Skills Manager window state: repos, repo skills, target folder
  lib/
    tauri-api.ts              # Frontend API bridge (all invoke/listen calls)
    tauri-api-interface.ts    # TauriAPI interface abstraction
  shared/types/
    task.ts                   # Core task types (Task, TaskMessage, etc.)
    workspace.ts              # Workspace, DirectoryEntry types
  hooks/
    useFileTree.ts            # Lazy-loading file tree with search and filter predicates
    useKeyboardShortcuts.ts   # Cmd+, Cmd+N, Cmd+K, Cmd+Enter, Escape
    useTheme.ts               # Theme management (light/dark mode)
    useAppUpdate.ts           # Auto-update check on app launch
    useSkillAutocomplete.ts   # Slash-command skill autocomplete (activates on / prefix)

src-tauri/                    # Rust/Tauri backend
  src/
    lib.rs                    # App entry point, plugin/menu setup, command registration
    commands/                 # Tauri command handlers by domain
      tasks.rs, settings.rs, api_keys.rs, providers.rs,
      folder_permissions.rs, ollama.rs, bedrock.rs,
      azure_foundry.rs, litellm.rs, opencode_cli.rs,
      updates.rs, app_info.rs, logging.rs, files.rs,
      packs.rs, skills.rs, workspaces.rs, copilot.rs
    db/                       # SQLite persistence (dev: cowork-dev.db, release: cowork.db, WAL mode)
      tasks.rs, settings.rs, providers.rs,
      folder_permissions.rs, workspaces.rs, skill_repos.rs, migrations.rs
    sidecar.rs                # Sidecar process lifecycle and IPC
    types.rs                  # Shared Rust types (serializable structs)
    secure_storage.rs         # OS Keychain wrapper (keyring crate)
    fs_watcher.rs             # Filesystem watcher (300ms debounce), emits workspace:fs_changed
    git_ops.rs                # Git operations (shallow clone, pull) for skill repo sync
    skill_discovery.rs        # Skill discovery from cloned repos (SKILL.md scan, skills.json manifest)
    workspace_validator.rs    # Platform-aware workspace path validation
  Cargo.toml

src-tauri/sidecar-opencode/   # Node.js sidecar (separate pnpm workspace)
  src/
    types.ts                  # IPC protocol types (source of truth)
    opencode-client.ts        # REST client for OpenCode server
    event-stream.ts           # SSE client for OpenCode server
    session-manager.ts        # Session lifecycle

src-tauri/resources/           # Bundled into app binary
  skills/opencode-server-api/ # Deployed to ~/.config/opencode/skills/ on every launch
  skill-templates/            # Installable skill templates (Skills Catalog)
  packs/ + pack-docs/         # Workspace starter pack files and documentation

docs/specs/                   # Design documentation
  cowork-z/requirements.md    # Feature requirements
  cowork-z/design.md          # Technical design
  workspace-as-folder/        # Workspace feature design and plans
  skills-management/          # Skills Catalog and Skills Manager plans
```

**Path aliases:** `@` maps to `src/`, `@shared` maps to `src/shared/` (configured in `tsconfig.json` and `vite.config.ts`).

## Architecture

```
Tauri (Rust) <-> stdin/stdout JSON-line <-> Node.js Sidecar <-> HTTP/SSE <-> opencode serve
```

- **IPC protocol:** Rust serializes `SidecarCommand` to JSON-line on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-line on stdout. Both use `snake_case` type discriminants.
- **Rust -> Sidecar commands:** `start_task`, `resume_session`, `cancel_task`, `abort_session`, `send_permission_reply`, `send_question_reply`, `get_session_todos`, `update_mcp_config`, `copilot_oauth_authorize`, `copilot_get_models`, `copilot_disconnect`, `ping`, `check_server`, `shutdown`
- **Sidecar -> Rust events:** `ready`, `pong`, `server_status`, `task_started`, `task_message`, `task_message_partial`, `task_message_complete`, `task_progress`, `task_complete`, `task_error`, `permission_request`, `question_request`, `todo_updated`, `copilot_oauth_result`, `copilot_oauth_complete`, `copilot_models_result`, `log`, `error`
- **Note:** `cancel_task` is a no-op in server mode — use `abort_session` instead.
- **Frontend events:** Rust emits Tauri events (`task:started`, `task:permission_request`, `task:question_request`, `task:todo_updated`, `copilot:oauth_result`) that the frontend listens to via `tauri-api.ts`.
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
pnpm ultracite:fix                # or: pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm ultracite:check              # or: pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/
```

## Testing

### Frontend (Vitest)

- Runner: Vitest with jsdom environment
- Location: `src/**/__tests__/*.{test,spec}.{ts,tsx}` — tests live in `__tests__/` subdirectories within their component directory
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

### Tauri Drag-and-Drop Constraint

Tauri 2.x intercepts ALL drag events at the native webview level. HTML5 `dragover`/`drop` DOM events **never fire** for intra-webview drags. Tauri's `onDragDropEvent` fires instead with `paths: []` for intra-app drags. Do NOT use HTML5 Drag and Drop API for intra-app drag-and-drop — use a module-level variable to pass the payload from `dragStart` to the Tauri drop handler. See `FileTreePanel.tsx` and `drag-drop-input.tsx` for the pattern.

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

## Sidecar Security & Config

- **Server auth:** The sidecar generates a random password per launch, passed as `OPENCODE_SERVER_PASSWORD`. All HTTP requests use basic auth `opencode:<password>`.
- **Port selection:** Uses OS ephemeral port (port 0). On Windows, additionally checks against Hyper-V/WinNAT excluded port ranges.
- **PATH augmentation:** When launched from a GUI context, the sidecar resolves the user's login-shell PATH (`$SHELL -ilc 'echo $PATH'`) and merges with well-known dirs (Homebrew, nvm, volta, pnpm).
- **Config files:** Writes `opencode.json` and `config.json` to `OPENCODE_DATA_DIR` before spawning `opencode serve`.
- **System prompt:** Injected via the `system` field on each `sendMessage` call (not via `PATCH /config`). Includes server port and password so the agent can call the OpenCode server API directly.

## App Startup Behavior

On launch, `lib.rs` performs two actions:
1. **Skill deployment** — Copies the bundled `resources/skills/opencode-server-api/SKILL.md` to `~/.config/opencode/skills/opencode-server-api/` (overwrites every launch) so the agent can discover the OpenCode server API.
2. **Repo sync** — After a 3-second delay, spawns a background thread that syncs all registered skill repos (`git pull` or `git clone --depth 1`), emitting `skills:sync_progress` and `skills:changed` Tauri events.

## Skills Manager Window

The Skills Manager opens as a separate Tauri window (label `skills`, route `/#/skills`) with single-instance enforcement. It has its own capability file (`skills.json`) granting shell execute permission for Git operations. Both the main and skills windows subscribe to `skills:changed` events to stay in sync. The Rust backend is the source of truth for all skill and repo data.

## Workspace-as-Folder Architecture

Workspaces scope each AI session to a directory. The OpenCode sidecar receives `?directory=<workspace_path>` on the `GET /event` SSE subscription and on `POST /permission/{id}/reply` — the directory must match for events to be routed correctly.

Switching workspaces triggers SSE reconnection (same mechanism as `PATCH /config`). The `workspaceStore` manages this lifecycle; `useFileTree` drives the sidebar file tree with lazy-loading and hidden-file filtering (`isHiddenEntry()` blocks dotfiles and platform system entries like `.DS_Store`, `$RECYCLE.BIN`).

## Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev` which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- OpenCode must be installed globally: `npm install -g opencode-ai`
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- Tauri capabilities split across three files: `default.json` (shell/dialog/opener for `main` + `skills` windows), `desktop.json` (updater/process for `main` only), `skills.json` (shell execute + opener for `skills` window only)
- The `pnpm esbuild` build script warning is expected and can be safely ignored
