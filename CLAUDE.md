# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cowork-Z is a cross-platform Tauri 2.x desktop app that gives autonomous AI agents a sandboxed environment. It drives OpenCode via a Node.js sidecar.

**Stack:** Tauri 2.x (Rust) + React 19 / TypeScript 5.8 · Radix UI + shadcn/ui · Tailwind 3.4 · Zustand 5 · Vite 7 · pnpm · SQLite (rusqlite) · OS Keychain (keyring)

**Path aliases** (mirrored in `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`; all three must agree):
`@` → `src/` · `@shared` → `src/shared/` · `@sidecar` → `src-tauri/sidecar-opencode/src/`

## Commands

```bash
pnpm tauri dev                # full stack (builds sidecar binary first, then Vite + Tauri)
pnpm dev                      # frontend only, no Tauri window

pnpm typecheck                # tsc --noEmit
pnpm test --run               # Vitest, single run
pnpm test path/to/file        # single test file
pnpm ultracite:fix            # format + lint

cd src-tauri && cargo check && cargo test
cd src-tauri/sidecar-opencode && pnpm test          # Jest
cd src-tauri/sidecar-opencode && pnpm build:binary  # see package.json for other targets
```

Rust changes need an app restart; frontend hot-reloads.

**Before reporting completion:** TypeScript edits → `pnpm typecheck`. Rust edits → `cargo check`. Do not claim success until compilation passes.

**Three independent test suites.** A change to the IPC protocol usually needs all three.

- Frontend (Vitest + jsdom): `__tests__/` next to the code, `*.{test,spec}.{ts,tsx}`. `src/test/setup.ts` mocks `matchMedia` and `ResizeObserver`.
- Sidecar (Jest) and Rust (`cargo test`) run from their own directories.

## Architecture

### Multi-Process Overview

```
Tauri (Rust) ↔ stdin/stdout JSON-line ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
  src-tauri/src/                         src-tauri/sidecar-opencode/
  - sidecar.rs (process mgmt)           - opencode-client.ts (REST)
  - lib.rs (Tauri commands)             - event-stream.ts (SSE)
                                        - session-manager.ts
```

OpenCode endpoints in use: `GET /event` (SSE), `POST /session/{id}/message`, `POST /session/{id}/abort`, `POST /permission/{id}/reply`, `POST /question/{id}/reply`, `PATCH /config`.

### IPC Protocol

Rust writes `SidecarCommand` as JSON-lines to sidecar stdin; the sidecar emits `SidecarEvent` as JSON-lines on stdout. Both use `snake_case` type discriminants.

`src-tauri/sidecar-opencode/src/types.ts` is the source of truth; `src-tauri/src/sidecar.rs` mirrors it as Rust enums. **Adding or renaming a message means editing both files**. Neither compiler catches the drift.

- Task payloads carry an `apiKeysFingerprint`, never key material. The sidecar pulls real provider keys via `request_api_keys` → `api_keys_response` only when it (re)spawns the OpenCode server.
- `cancel_task` is a no-op in server mode. Use `abort_session`.

Rust re-emits sidecar events as Tauri events (`task:started`, `task:permission_request`, `task:question_request`, `task:todo_updated`, `copilot:oauth_result`, …); the frontend subscribes through `tauri-api.ts`.

### Sidecar

- **Auth:** random password per launch via `OPENCODE_SERVER_PASSWORD`; all HTTP uses basic auth `opencode:<password>`.
- **Port:** OS ephemeral (port 0). Windows additionally avoids Hyper-V/WinNAT excluded ranges.
- **PATH:** from a GUI launch, resolves the login-shell PATH (`$SHELL -ilc 'echo $PATH'`) and merges well-known dirs (Homebrew, nvm, volta, pnpm).
- **System prompt:** injected via the `system` field on each `sendMessage`, not `PATCH /config`. Carries the server port and password so the agent can call the OpenCode API directly.
- **MCP servers:** OpenCode reads them only at startup, so `update_mcp_config` writes config files to disk and restarts the server. `PATCH /config` will not pick them up.
- **CommonJS only:** `pkg` has limited ESM support. The binary lands at `src-tauri/binaries/sidecar-opencode-<target-triple>` and is wired in `tauri.conf.json` under `bundle.externalBin`.

### Frontend

Routes (hash router): `/` Home · `/execution/:id` · `/arena/:arenaId`.

`/skills` is **not** a `<Route>`. `App.tsx` short-circuits on `location.pathname === '/skills'` and renders `SkillsManager` before the sidebar shell. The Skills Manager runs in its own window and must not inherit the app chrome.

Zustand stores live in `src/stores/`; `taskStore.ts` is the primary one.

Key files:

- [src/lib/tauri-api.ts](src/lib/tauri-api.ts) — every `invoke()` and `listen()` goes through here. This is the frontend↔Rust contract.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — `run()`, plugin registration, menus, `invoke_handler` registration.
- [src-tauri/src/commands/](src-tauri/src/commands/) — one file per domain.
- [src-tauri/src/db/](src-tauri/src/db/) — SQLite. Dev builds use `cowork-dev.db`, release `cowork.db`. WAL and foreign keys on.
- [src-tauri/src/path_guard.rs](src-tauri/src/path_guard.rs) — the sandbox boundary. Every renderer-reachable filesystem command canonicalizes its target (resolving symlinks and `..`) and checks it against the allowed roots: registered workspaces plus granted permission folders. Historical grants are re-validated at load so a bad past grant (`/`, `~/.ssh`) cannot reopen the sandbox. Route new fs-touching commands through this.

### Workspace-as-Folder

Workspaces scope each session to a directory. The sidecar passes `?directory=<workspace_path>` on the `GET /event` SSE subscription and on `POST /permission/{id}/reply`. A mismatch misroutes events. Switching workspaces forces an SSE reconnect (same path as `PATCH /config`), managed by `workspaceStore`. `useFileTree` drives the sidebar with lazy loading and hidden-file filtering; `fs_watcher.rs` (debounced `notify`) pushes external changes back to the UI.

### Automations

Scheduled, unattended runs, split across three Rust modules:

- `automation_scheduler.rs` — one thread per enabled automation, sleeping on a `Condvar` until its next fire time. Registry keyed by automation id, so enable/disable/edit cancels and respawns just that thread.
- `dispatch_slot.rs` — one global "one run at a time" slot. `try_acquire()` CASes an `AtomicBool` and returns an RAII `SlotGuard` that releases on drop, panic included.
- `cron_schedule.rs` — pure next-fire-time math, no I/O, unit-tested standalone.

Dispatch reuses the normal task path: `automation_dispatch.rs` resolves workspace, folder permissions, model and MCP config into a `StartTaskPayload` and sends the same `start_task` a user would.

### App Startup

`lib.rs` does two things on launch: copies bundled `resources/skills/opencode-server-api/SKILL.md` to `~/.config/opencode/skills/` (overwriting every launch), and after a 3-second delay spawns a thread that syncs registered skill repos (`git pull` / `git clone --depth 1`), emitting `skills:sync_progress` and `skills:changed`.

## Conventions

Ultracite (Biome preset) owns formatting and linting; the husky pre-commit hook auto-formats staged `.ts`/`.tsx`. React 19: use ref as a prop, not `React.forwardRef` (a few older `src/components/ui/` files predate this).

### Settings textareas

User Prompt and MCP Servers JSON must use `defaultValue` + `useRef`, never a controlled `value`; controlled inputs re-render the dialog on every keystroke. Read via `textareaRef.current?.value`, debounce saves ~500ms. Reference: [McpServersSettings.tsx](src/components/settings/McpServersSettings.tsx).

### Tauri drag-and-drop

Tauri 2.x intercepts all drag events at the native webview level, so HTML5 `dragover`/`dragleave`/`drop` **never fire** for intra-webview drags. Tauri's `onDragDropEvent` fires instead, with `paths: []` for intra-app drags and a populated `paths` for Finder/Desktop drops.

Do not use the HTML5 Drag and Drop API for intra-app DnD. It fails silently (`dragstart` fires, the drop target gets nothing). Instead: stash the payload in a module-level variable on `dragStart`, and on `onDragDropEvent` `drop` with empty `paths`, read it back. Reference: [FileTreePanel.tsx](src/components/sidebar/FileTreePanel.tsx) (source) and [drag-drop-input.tsx](src/components/ui/drag-drop-input.tsx) (target).

### Wide content in flex layouts

Flex children default to `min-width: auto` and `<pre>` does not wrap, so both overflow their parent. The wrapper needs `min-w-0 overflow-hidden`; the `<pre>` needs `whitespace-pre-wrap break-words overflow-auto`. Reference: [ToolCallCard.tsx](src/components/chat/ToolCallCard.tsx).

### Inline text inputs inside Radix primitives

Four traps, all hit by inline rename in [ConversationListItem.tsx](src/components/layout/ConversationListItem.tsx):

1. Radix steals focus ~120-150ms after menu close, firing a spurious `blur`. Timing guards (`useRef` + `requestAnimationFrame`) do not work. Check `e.relatedTarget` in `onBlur`: `null`, `document.body`, or an ancestor/sibling of the input means an internal steal, so re-focus. Only commit on a genuinely external target.
2. Do not set state in `onSelect`: the input mounts while Radix is still tearing the menu down. Set a `pendingRenameRef` flag, then activate in `onOpenChange(false)` after a double `requestAnimationFrame`.
3. The trigger's `onKeyDown` swallows arrows and modifiers. The input's `onKeyDown` must call `e.stopPropagation()`.
4. Never apply `truncate` to an editable input; `overflow: hidden` hides the caret. Use `caret-foreground`.

### Keyboard shortcuts

App-level bindings live in [useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts); the modifier is `metaKey || ctrlKey`, so they work unchanged on Windows/Linux. `Cmd/Ctrl+,` settings · `Cmd/Ctrl+N` new task · `Cmd/Ctrl+K` launcher · `Shift+?` help (no modifier, suppressed on editable targets). Chat send is plain `Enter`, `Shift+Enter` newline, handled locally in `ChatInput.tsx` and `TaskInputBar.tsx`, not in the hook.

## Reference

- [docs/specs/index.md](docs/specs/index.md) indexes every requirement, design doc and plan. Start there rather than browsing the directory.
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) — positioning and the visual system ("The Helpful Colleague": DM Sans only, Deep Forest `#213c20` as the sole action color, 6px controls / 24px cards). Read before any UI work.

### Gotchas

- Dev server port `1420` must be free (Tauri requires it).
- OpenCode must be installed globally: `npm install -g opencode-ai`.
- API keys live in the OS Keychain; task history in SQLite under `~/Library/Application Support/cowork-z/`.
- Tauri capabilities are split three ways: `default.json` (shell/dialog/opener for `main` + `skills`), `desktop.json` (updater/process, `main` only), `skills.json` (shell execute + opener, `skills` only). The Skills Manager needs shell execute for Git.
- `src-tauri/resources/` is bundled into the binary: `skills/`, `packs/`, `pack-docs/`, per `tauri.conf.json`.
- Provider forms live in `src/components/settings/providers/`. `ClassicProviderForm` covers the plain API-key providers (Anthropic, OpenAI, Google); Bedrock, Azure Foundry, Ollama, OpenRouter, LiteLLM and Copilot each have their own.
