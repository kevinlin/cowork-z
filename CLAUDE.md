# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork-Z is a cross-platform desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

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
pnpm ultracite:fix                # or: pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm ultracite:check              # or: pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/

# Production build
pnpm tauri build
```

**Important:** `pnpm tauri dev` auto-builds the sidecar binary before starting (configured in `tauri.conf.json` `beforeDevCommand`). Rust changes require app restart; frontend changes are hot-reloaded.

## Build & Validation

After making TypeScript edits, always run `pnpm typecheck` (or `tsc --noEmit`) before reporting completion. After Rust edits, run `cd src-tauri && cargo check`. Do not report success until compilation passes.

## Testing

### Frontend Tests (Vitest)
- **Test runner:** Vitest with jsdom environment
- **Location:** `src/**/__tests__/*.{test,spec}.{ts,tsx}` — tests live in `__tests__/` subdirectories within their component directory
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
- Layout components: `src/components/layout/__tests__/`
- Sidebar components: `src/components/sidebar/__tests__/`
- Pages: `src/pages/__tests__/`
- Store: `src/stores/__tests__/`

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
- **`src-tauri/src/lib.rs`** — App entry point (`run()`), plugin registration, menu setup, and `invoke_handler` command registration.
- **`src-tauri/src/commands/`** — Tauri command handlers, organized by domain: `tasks.rs`, `settings.rs`, `api_keys.rs`, `providers.rs`, `folder_permissions.rs`, `ollama.rs`, `bedrock.rs`, `azure_foundry.rs`, `litellm.rs`, `opencode_cli.rs`, `updates.rs`, `app_info.rs`, `logging.rs`, `files.rs`, `packs.rs`, `skills.rs`, `workspaces.rs`, `copilot.rs`.
- **`src-tauri/src/db/`** — SQLite persistence layer: `tasks.rs`, `settings.rs`, `providers.rs`, `folder_permissions.rs`, `workspaces.rs`, `skill_repos.rs`, `migrations.rs`. Dev builds use `cowork-dev.db`, release builds use `cowork.db`. WAL mode and foreign keys enabled.
- **`src-tauri/src/sidecar.rs`** — Sidecar process lifecycle, IPC serialization (`SidecarCommand` enum), and event routing.
- **`src-tauri/src/types.rs`** — Shared Rust types (serializable structs for IPC).
- **`src-tauri/src/secure_storage.rs`** — OS Keychain wrapper (keyring crate).
- **`src-tauri/src/fs_watcher.rs`** — Filesystem watcher (300ms debounce) for the active workspace, emits `workspace:fs_changed` events.
- **`src-tauri/src/git_ops.rs`** — Git operations (shallow clone, pull, token injection) for skill repo sync.
- **`src-tauri/src/skill_discovery.rs`** — Skill discovery from cloned repos: convention-based (`SKILL.md` scan), manifest-based (`skills.json`), and specialized adapters for known repos.
- **`src-tauri/src/workspace_validator.rs`** — Platform-aware workspace path validation (blocks system dirs, drive roots, exact home directory).
- **`src-tauri/sidecar-opencode/src/types.ts`** — Single source of truth for the IPC protocol between Rust and sidecar.

### IPC Protocol

Rust serializes `SidecarCommand` to JSON-line on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-line on stdout. Both use `snake_case` type discriminants.

**Rust → Sidecar:** `start_task`, `resume_session`, `cancel_task`, `abort_session`, `send_permission_reply`, `send_question_reply`, `get_session_todos`, `update_mcp_config`, `copilot_oauth_authorize`, `copilot_get_models`, `copilot_disconnect`, `ping`, `check_server`, `shutdown`

**Sidecar → Rust:** `ready`, `pong`, `server_status`, `task_started`, `task_message`, `task_message_partial`, `task_message_complete`, `task_progress`, `task_complete`, `task_error`, `permission_request`, `question_request`, `todo_updated`, `copilot_oauth_result`, `copilot_oauth_complete`, `copilot_models_result`, `log`, `error`

Note: `cancel_task` is a no-op in server mode — use `abort_session` instead.

Rust emits Tauri events (e.g., `task:started`, `task:permission_request`, `task:question_request`, `task:todo_updated`, `copilot:oauth_result`) that the frontend listens to via `tauri-api.ts`.

### Sidecar Security & Config

- **Server auth:** The sidecar generates a random password per launch, passed as `OPENCODE_SERVER_PASSWORD`. All HTTP requests use basic auth `opencode:<password>`.
- **Port selection:** Uses OS ephemeral port (port 0). On Windows, additionally checks against Hyper-V/WinNAT excluded port ranges.
- **PATH augmentation:** When launched from a GUI context, the sidecar resolves the user's login-shell PATH (`$SHELL -ilc 'echo $PATH'`) and merges with well-known dirs (Homebrew, nvm, volta, pnpm).
- **Config files:** Writes `opencode.json` and `config.json` to `OPENCODE_DATA_DIR` before spawning `opencode serve`.
- **System prompt:** Injected via the `system` field on each `sendMessage` call (not via `PATCH /config`). Includes server port and password so the agent can call the OpenCode server API directly.

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
- `src/stores/taskStore.ts` — Tasks, permissions, questions, active task, UI state (settings, launcher)
- `src/stores/workspaceStore.ts` — Workspace list, active workspace, `initialize()` / `switchWorkspace()` / `addWorkspace()` / `removeWorkspace()`
- `src/stores/filePreviewStore.ts` — File preview panel state: `openPreview()`, `openPreviewByPath()`, `closePreview()`, fullscreen toggle
- `src/stores/skillsStore.ts` — Installed skills list for slash-command autocomplete
- `src/stores/skillsManagerStore.ts` — Skills Manager window state: repos, repo skills, installed skills, target folder selection, search/filter

**Component Organization**
- `src/components/layout/` — App shell (Sidebar, SettingsDialog)
- `src/components/ui/` — Radix UI + shadcn/ui primitives
- `src/components/sidebar/` — Sidebar panels (FileTreePanel, TodoPanel, ArtifactsPanel, FolderPanel)
- `src/components/file-preview/` — File preview panel: `FilePreviewPanel.tsx`, per-type renderers (`CodePreview`, `MarkdownPreview`, `MediaPreview`, `PdfPreview`, `HtmlPreview`, `TextPreview`, `BinaryPreview`), `preview-utils.ts`
- `src/components/settings/` — Provider configuration forms
- `src/components/markdown/` — Rich message rendering (EnhancedLink, file/URL detection)
- `src/components/media/` — Image/video thumbnails and modals
- `src/components/landing/` — Task input bar and drag-drop integration
- `src/components/skills-manager/` — Skills Manager window UI (repo management, skill grid, file tree)

**Custom Hooks**
- `src/hooks/useFileTree.ts` — Lazy-loading file tree with search and filtering predicates
- `src/hooks/useKeyboardShortcuts.ts` — App-level and chat-level shortcuts
- `src/hooks/useTheme.ts` — Theme management (light/dark mode)
- `src/hooks/useAppUpdate.ts` — Auto-update check on app launch
- `src/hooks/useSkillAutocomplete.ts` — Slash-command skill autocomplete for chat input (activates on `/` prefix)

**Shared Types**
- `src/shared/types/task.ts` — `Task`, `TaskMessage`, `TaskStatus`, `TaskProgress`, `Todo`, `Artifact`, `PartialMessage`
- `src/shared/types/workspace.ts` — `Workspace`, `DirectoryEntry`

## Settings UI Patterns

**Textarea inputs** (User Prompt, MCP Servers JSON) must use `defaultValue` + `useRef` to avoid UI re-renders during typing. Never use controlled `value` on settings textareas.
- Read latest value with `textareaRef.current?.value`
- Debounce saves with `setTimeout` (500ms)
- See `src/components/settings/McpServersSettings.tsx` for reference implementation

## Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev`, which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- Tauri capabilities split across three files: `default.json` (shell/dialog/opener for `main` + `skills` windows), `desktop.json` (updater/process for `main` only), `skills.json` (shell execute + opener for `skills` window only)
- OpenCode must be installed globally: `npm install -g opencode-ai`
- Provider configuration forms are in `src/components/settings/` (Anthropic, OpenAI, Google, Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM)
- Reference Electron app source preserved at `apps/desktop/` for reference
- Keyboard shortcuts implemented via `src/hooks/useKeyboardShortcuts.ts`:
  - App-level: `Cmd+,` (settings), `Cmd+N` (new task), `Cmd+K` (launcher)
  - Chat-level: `Cmd+Enter` (send), `Escape` (cancel)

## Tauri Drag-and-Drop Constraint

**Tauri 2.x intercepts ALL drag events at the native webview level.** This means HTML5 `dragover`, `dragleave`, and `drop` DOM events **never fire** for intra-webview drags (e.g., dragging from a sidebar component to an input). Tauri's `onDragDropEvent` fires instead, with `paths: []` for intra-app drags (vs. populated `paths` for OS-level Finder/Desktop drops).

**Do NOT use HTML5 Drag and Drop API** for intra-app drag-and-drop in Tauri. It will silently fail — the drag ghost appears and `dragstart` fires, but the drop target never receives `dragover`/`drop`.

**Pattern for intra-app drag-and-drop:**
1. On `dragStart`: store the payload in a module-level variable (e.g., `pendingDragPath` in `FileTreePanel.tsx`)
2. On Tauri `onDragDropEvent` `drop`: if `paths` is empty, check the module-level variable for the intra-app payload
3. Export getter/setter functions (`getPendingDragPath()`, `clearPendingDragPath()`) for drop targets to consume

See `src/components/sidebar/FileTreePanel.tsx` (drag source) and `src/components/ui/drag-drop-input.tsx` / `src/components/landing/TaskInputBar.tsx` (drop targets) for the reference implementation.

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

## App Startup Behavior

On launch, `lib.rs` performs two actions:
1. **Skill deployment** — Copies the bundled `resources/skills/opencode-server-api/SKILL.md` to `~/.config/opencode/skills/opencode-server-api/` (overwrites every launch) so the agent can discover the OpenCode server API.
2. **Repo sync** — After a 3-second delay, spawns a background thread that syncs all registered skill repos (`git pull` or `git clone --depth 1`), emitting `skills:sync_progress` and `skills:changed` Tauri events.

## Skills Manager Window

The Skills Manager opens as a separate Tauri window (label `skills`, route `/#/skills`) with single-instance enforcement. It has its own capability file (`skills.json`) granting shell execute permission for Git operations. Both the main and skills windows subscribe to `skills:changed` events to stay in sync. The Rust backend is the source of truth for all skill and repo data.

## Workspace-as-Folder Architecture

Workspaces scope each AI session to a directory. The OpenCode sidecar receives `?directory=<workspace_path>` on the `GET /event` SSE subscription and on `POST /permission/{id}/reply` — the directory must match for events to be routed correctly.

Switching workspaces triggers SSE reconnection (same mechanism as `PATCH /config`). The `workspaceStore` manages this lifecycle; `useFileTree` drives the sidebar file tree with lazy-loading and hidden-file filtering (`isHiddenEntry()` blocks dotfiles and platform system entries like `.DS_Store`, `$RECYCLE.BIN`).

## Bundled Resources

`src-tauri/resources/` contains files bundled into the app binary (configured in `tauri.conf.json`):
- `skills/opencode-server-api/SKILL.md` — Deployed to `~/.config/opencode/skills/` on every launch
- `skill-templates/` — Installable skill templates (browsable via Skills Catalog on Home screen)
- `packs/` + `pack-docs/` — Workspace starter pack files and documentation

## Design Documentation

See `docs/specs/`:
- `cowork-z/requirements.md` — Feature requirements
- `cowork-z/design.md` — Technical design
- `workspace-as-folder/` — Workspace feature design and plans
- `skills-management/` — Skills Catalog and Skills Manager plans
- `sidecar-opencode-rewrite/plan_sidecar-opencode-rewrite.md` — Sidecar rewrite plan (complete)
