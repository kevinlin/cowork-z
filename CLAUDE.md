# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork-Z is a cross-platform desktop application built with Tauri 2.x that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

**Quick reference — key commands:**
- Frontend: `pnpm build` / `pnpm test`
- Rust: `cd src-tauri && cargo build` / `cd src-tauri && cargo check`
- Sidecar: `cd src-tauri/sidecar-opencode && pnpm build` / `pnpm test`
- Full app: `pnpm tauri dev`

### Technology Stack

- **Desktop Framework:** Tauri 2.x (Rust backend + React/TypeScript frontend)
- **Frontend:** React 19 + TypeScript 5.8, Radix UI + shadcn/ui, Tailwind CSS 3.4, Zustand 5, Vite 7
- **Package Manager:** pnpm
- **Database:** SQLite (rusqlite), OS Keychain (keyring crate) for secrets
- **Sidecar:** Node.js + HTTP/SSE for OpenCode server API (`src-tauri/sidecar-opencode/`)

### Path Aliases

- `@` → `src/`
- `@shared` → `src/shared/`

Configured in both `tsconfig.json` and `vite.config.ts`.

## Development

### Commands

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

### Build & Validation

After making TypeScript edits, always run `pnpm typecheck` (or `tsc --noEmit`) before reporting completion. After Rust edits, run `cd src-tauri && cargo check`. Do not report success until compilation passes.

### Testing

#### Frontend (Vitest)

- **Test runner:** Vitest with jsdom environment
- **Location:** `src/**/__tests__/*.{test,spec}.{ts,tsx}` — tests live in `__tests__/` subdirectories within their component directory
- **Setup file:** `src/test/setup.ts` — mocks `matchMedia` and `ResizeObserver` for jsdom
- **Libraries:** @testing-library/react, @testing-library/jest-dom, @testing-library/user-event

```bash
pnpm test                # Watch mode (default)
pnpm test --run          # Single run (CI mode)
pnpm test:coverage       # Coverage report
pnpm test path/to/file   # Run specific test file
```

#### Sidecar (Jest)

```bash
cd src-tauri/sidecar-opencode
pnpm test               # Single run
pnpm test:watch         # Watch mode
pnpm test:coverage      # Coverage report
```

#### Rust

```bash
cd src-tauri && cargo test
```

### Expected Build Warnings

**pnpm esbuild build script warning**: This is a security feature, not a bug. The warning appears because pnpm prevents automatic execution of build scripts to protect against supply chain attacks. The esbuild binary is already installed and functional — everything works correctly. This warning can be safely ignored. If you prefer to suppress it, run `pnpm approve-builds` in the sidecar directory.

## Architecture

### Multi-Process Overview

```
Tauri (Rust) ↔ stdin/stdout JSON-line ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
  src-tauri/src/                         src-tauri/sidecar-opencode/
  - sidecar.rs (process mgmt)           - opencode-client.ts (REST)
  - lib.rs (Tauri commands)             - event-stream.ts (SSE)
                                         - session-manager.ts
```

OpenCode server endpoints used by sidecar: `GET /event` (SSE), `POST /session/{id}/message`, `POST /permission/{id}/reply`, `POST /question/{id}/reply`, `PATCH /config`.

### IPC Protocol

Rust serializes `SidecarCommand` to JSON-line on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-line on stdout. Both use `snake_case` type discriminants.

**Rust → Sidecar:** `start_task`, `resume_session`, `cancel_task`, `abort_session`, `send_permission_reply`, `send_question_reply`, `get_session_todos`, `update_mcp_config`, `copilot_oauth_authorize`, `copilot_get_models`, `copilot_disconnect`, `api_keys_response`, `ping`, `check_server`, `shutdown`

**Sidecar → Rust:** `ready`, `pong`, `server_status`, `task_started`, `task_message`, `task_message_partial`, `task_message_complete`, `task_progress`, `task_complete`, `task_error`, `permission_request`, `question_request`, `todo_updated`, `copilot_oauth_result`, `copilot_oauth_complete`, `copilot_models_result`, `request_api_keys`, `log`, `error`

Note: task payloads carry an `apiKeysFingerprint` (no key material). The sidecar pulls actual provider keys via `request_api_keys` → `api_keys_response` only when it (re)spawns the OpenCode server.

Note: `cancel_task` is a no-op in server mode — use `abort_session` instead.

Rust emits Tauri events (e.g., `task:started`, `task:permission_request`, `task:question_request`, `task:todo_updated`, `copilot:oauth_result`) that the frontend listens to via `tauri-api.ts`.

### Sidecar

#### Security & Config

- **Server auth:** The sidecar generates a random password per launch, passed as `OPENCODE_SERVER_PASSWORD`. All HTTP requests use basic auth `opencode:<password>`.
- **Port selection:** Uses OS ephemeral port (port 0). On Windows, additionally checks against Hyper-V/WinNAT excluded port ranges.
- **PATH augmentation:** When launched from a GUI context, the sidecar resolves the user's login-shell PATH (`$SHELL -ilc 'echo $PATH'`) and merges with well-known dirs (Homebrew, nvm, volta, pnpm).
- **Config files:** Writes `opencode.json` and `config.json` to `OPENCODE_DATA_DIR` before spawning `opencode serve`.
- **System prompt:** Injected via the `system` field on each `sendMessage` call (not via `PATCH /config`). Includes server port and password so the agent can call the OpenCode server API directly.

#### Binary

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

### Frontend Structure

#### Pages (react-router-dom)

- `/` — `src/pages/Home.tsx` — Task launcher and empty state
- `/task/:taskId` — `src/pages/Execution.tsx` — Active task chat view

#### State Management (Zustand)

Stores live in `src/stores/`. The primary store is `taskStore.ts` (tasks, permissions, questions, active task, UI state). Other stores: `workspaceStore.ts`, `filePreviewStore.ts`, `skillsStore.ts`, `skillsManagerStore.ts`.

#### Key Source Locations

- **`src/lib/tauri-api.ts`** — Centralized frontend API bridge. All Tauri `invoke()` calls and `listen()` event subscriptions go through here. This is the contract between frontend and Rust.
- **`src-tauri/src/lib.rs`** — App entry point (`run()`), plugin registration, menu setup, and `invoke_handler` command registration.
- **`src-tauri/src/commands/`** — Tauri command handlers, organized by domain (one file per domain).
- **`src-tauri/src/db/`** — SQLite persistence layer. Dev builds use `cowork-dev.db`, release builds use `cowork.db`. WAL mode and foreign keys enabled.
- **`src-tauri/src/sidecar.rs`** — Sidecar process lifecycle, IPC serialization (`SidecarCommand` enum), and event routing.
- **`src-tauri/sidecar-opencode/src/types.ts`** — Single source of truth for the IPC protocol between Rust and sidecar.

## Conventions & Patterns

### Settings UI

**Textarea inputs** (User Prompt, MCP Servers JSON) must use `defaultValue` + `useRef` to avoid UI re-renders during typing. Never use controlled `value` on settings textareas.
- Read latest value with `textareaRef.current?.value`
- Debounce saves with `setTimeout` (500ms)
- See `src/components/settings/McpServersSettings.tsx` for reference implementation

### Tauri Drag-and-Drop

**Tauri 2.x intercepts ALL drag events at the native webview level.** This means HTML5 `dragover`, `dragleave`, and `drop` DOM events **never fire** for intra-webview drags (e.g., dragging from a sidebar component to an input). Tauri's `onDragDropEvent` fires instead, with `paths: []` for intra-app drags (vs. populated `paths` for OS-level Finder/Desktop drops).

**Do NOT use HTML5 Drag and Drop API** for intra-app drag-and-drop in Tauri. It will silently fail — the drag ghost appears and `dragstart` fires, but the drop target never receives `dragover`/`drop`.

**Pattern for intra-app drag-and-drop:**
1. On `dragStart`: store the payload in a module-level variable (e.g., `pendingDragPath` in `FileTreePanel.tsx`)
2. On Tauri `onDragDropEvent` `drop`: if `paths` is empty, check the module-level variable for the intra-app payload
3. Export getter/setter functions (`getPendingDragPath()`, `clearPendingDragPath()`) for drop targets to consume

See `src/components/sidebar/FileTreePanel.tsx` (drag source) and `src/components/ui/drag-drop-input.tsx` / `src/components/landing/TaskInputBar.tsx` (drop targets) for the reference implementation.

### Keyboard Shortcuts

Implemented via `src/hooks/useKeyboardShortcuts.ts`:
- **App-level:** `Cmd+,` (settings), `Cmd+N` (new task), `Cmd+K` (launcher)
- **Chat-level:** `Cmd+Enter` (send), `Escape` (cancel)

### Containing `<pre>` and `<div>` Width in Flex Layouts

When rendering `<pre>` blocks or wide content inside flex children (e.g., expandable tool call cards, code blocks in chat), two CSS issues cause content to overflow the parent container:

1. **Flex children default to `min-width: auto`**, which allows content to push the container wider than its parent. Always add `min-w-0` to flex children that contain wide content.
2. **`<pre>` elements preserve whitespace and don't wrap by default**, so long lines (JSON, file paths, command output) extend horizontally without limit.

**Required pattern for contained `<pre>` blocks:**
- Wrapper `<div>`: `min-w-0 overflow-hidden` — establishes a width boundary and creates a block formatting context
- `<pre>` element: `whitespace-pre-wrap break-words overflow-auto` — wraps long lines within the container while preserving indentation, with scrollbars for vertical overflow

Never use bare `<pre>` inside a flex layout without `whitespace-pre-wrap break-words` — it will overflow. See `src/components/chat/ToolCallCard.tsx` (expanded state) for the reference implementation.

### Inline Text Inputs inside Radix Primitives

When embedding an `<input>` inside a Radix component (e.g., `DropdownMenuTrigger`), four issues arise:

1. **Radix steals focus ~120-150ms after menu close.** The trigger element receives focus after the menu's exit animation completes, firing a spurious `blur` on the input. A timing-based guard (`useRef` boolean + `requestAnimationFrame`) is **not reliable** — the focus steal happens after the rAF callback. Instead, check `e.relatedTarget` in the `onBlur` handler: if focus moved to `null`, `document.body`, or an ancestor/sibling of the input (i.e., the trigger div), treat it as an internal focus steal and re-focus the input. Only call `commitRename()` when focus moves to a genuinely external element.
2. **Don't set state in `onSelect` — defer past menu teardown.** Setting `isRenaming = true` inside `DropdownMenuItem.onSelect` causes the input to mount while Radix is still tearing down the menu, leading to focus conflicts. Instead, set a `pendingRenameRef` flag in `onSelect`, then activate rename in `onOpenChange(false)` after a double `requestAnimationFrame` to let Radix fully complete its cleanup.
3. **Radix intercepts keyboard events.** The trigger's internal `onKeyDown` swallows keys like arrows and modifiers. The input's `onKeyDown` must call `e.stopPropagation()` so standard text-editing shortcuts (Ctrl+A, arrow keys, Home/End) work.
4. **`truncate` hides the text cursor.** Never apply Tailwind's `truncate` class to an editable input — `overflow: hidden` hides the caret. Use `caret-foreground` for a visible cursor.

See `src/components/layout/ConversationListItem.tsx` (inline rename) for the reference implementation.

## Runtime Behavior

### App Startup

On launch, `lib.rs` performs two actions:
1. **Skill deployment** — Copies the bundled `resources/skills/opencode-server-api/SKILL.md` to `~/.config/opencode/skills/opencode-server-api/` (overwrites every launch) so the agent can discover the OpenCode server API.
2. **Repo sync** — After a 3-second delay, spawns a background thread that syncs all registered skill repos (`git pull` or `git clone --depth 1`), emitting `skills:sync_progress` and `skills:changed` Tauri events.

### Workspace-as-Folder

Workspaces scope each AI session to a directory. The OpenCode sidecar receives `?directory=<workspace_path>` on the `GET /event` SSE subscription and on `POST /permission/{id}/reply` — the directory must match for events to be routed correctly.

Switching workspaces triggers SSE reconnection (same mechanism as `PATCH /config`). The `workspaceStore` manages this lifecycle; `useFileTree` drives the sidebar file tree with lazy-loading and hidden-file filtering (`isHiddenEntry()` blocks dotfiles and platform system entries like `.DS_Store`, `$RECYCLE.BIN`).

### Skills Manager Window

The Skills Manager opens as a separate Tauri window (label `skills`, route `/#/skills`) with single-instance enforcement. It has its own capability file (`skills.json`) granting shell execute permission for Git operations. Both the main and skills windows subscribe to `skills:changed` events to stay in sync. The Rust backend is the source of truth for all skill and repo data.

### Bundled Resources

`src-tauri/resources/` contains files bundled into the app binary (configured in `tauri.conf.json`):
- `skills/opencode-server-api/SKILL.md` — Deployed to `~/.config/opencode/skills/` on every launch
- `skill-templates/` — Installable skill templates (browsable via Skills Catalog on Home screen)
- `packs/` + `pack-docs/` — Workspace starter pack files and documentation

## Reference

### Important Notes

- `pnpm tauri dev` for full-stack dev (not `pnpm dev`, which is frontend-only)
- Dev server port `1420` must be available (required by Tauri)
- API keys stored in OS Keychain; task history in SQLite at `~/Library/Application Support/cowork-z/`
- Tauri capabilities split across three files: `default.json` (shell/dialog/opener for `main` + `skills` windows), `desktop.json` (updater/process for `main` only), `skills.json` (shell execute + opener for `skills` window only)
- OpenCode must be installed globally: `npm install -g opencode-ai`
- Provider configuration forms are in `src/components/settings/` (Anthropic, OpenAI, Google, Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM)
- Reference Electron app source preserved at `apps/desktop/` for reference

### Design Documentation

See `docs/specs/`:
- `requirements.md` — Feature requirements
- `design.md` — Technical design
- `windows-support/` — Windows platform support plans
- `opencode-integration` - OpenCode sidecar integration
- `chat-ux` - Agent chat feature plans
- `app-ux` - General app feature plans
- `workspace-as-folder/` — Workspace feature design and plans
- `workspace-packs/` — Workspace starter packs feature design and plans
- `skills-management/` — Skills Catalog and Skills Manager plans

## Post-Feature Completion Checklist (MANDATORY)

**IMPORTANT: After completing ANY feature or plan implementation, you MUST perform ALL of these steps before reporting completion. Do not skip this section — it is as important as passing tests.**

1. **Update requirement status** in `docs/specs/requirements.md`:
   - Add `✅` to the requirement heading (e.g., `#### 4.4 About Panel ✅`)
   - Add a plan reference link (`> **Plan:** [Name](plan_name.md)`) if an implementation plan exists
   - Check off the item in the "Outstanding Feature TODO" section at the bottom
   - Add the plan to the "Implementation Plans Index" table if applicable
2. **Add to UPDATE_LOG.md**: Append to the current version section describing the completed feature with its requirement number (e.g., `- 4.5 Feedback — description`)
3. **Verify** both `pnpm typecheck` and `cd src-tauri && cargo check` pass before reporting completion
