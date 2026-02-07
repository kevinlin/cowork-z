# Cowork Z — Technical Design Document

## Overview

Cowork Z is a cross-platform desktop application that provides a sandboxed environment for autonomous AI agents. It delegates agent orchestration to the OpenCode CLI, connected via a Node.js sidecar process that communicates with the Rust backend over JSON-line IPC.

### Design Goals

1. **Security First**: Defense-in-depth — OS keychain for secrets, folder permissions for file access, HTTP basic auth for internal services, optional DB encryption
2. **Provider Agnostic**: Support 13+ AI providers through OpenCode's unified interface
3. **Cross-Platform**: macOS, Windows, and Linux with platform-native conventions
4. **Single Cohesive Application**: UI and agent lifecycle tied together — launching the app starts the sidecar, quitting shuts it down
5. **Extensible**: User-managed skills directory and MCP server support
6. **Observability**: Visibility into agent actions, tool calls, and permission requests

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Desktop Framework** | Tauri 2.x | Lightweight, secure Rust backend, system WebView, cross-platform |
| **Frontend** | React 19 + TypeScript 5.8 | Component reusability, type safety, rich ecosystem |
| **UI Components** | Radix UI + shadcn/ui | Accessible, composable primitives with consistent design |
| **Styling** | Tailwind CSS 3.4 | Utility-first, rapid UI development |
| **State Management** | Zustand 5 | Lightweight, TypeScript-friendly |
| **Build** | Vite 7 + Cargo | Fast frontend builds, native Rust compilation |
| **Agent Orchestration** | OpenCode CLI via HTTP/SSE | Provider-agnostic agent runtime with tool execution |
| **Sidecar** | Node.js + pkg (CommonJS) | Bridges Tauri IPC to OpenCode HTTP/SSE API |
| **Database** | SQLite (rusqlite) | Embedded, zero-config, cross-platform |
| **Secure Storage** | OS Keychain (keyring crate) | Native credential storage on all platforms |

---

## Architecture

### Multi-Process Architecture

```
Tauri (Rust) ↔ JSON-line IPC (stdin/stdout) ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
```

| Process | Role |
|---------|------|
| **Tauri (Rust)** | App lifecycle, database, secure storage, IPC routing, Tauri command handlers |
| **Node.js Sidecar** | OpenCode server management, HTTP/SSE client, protocol translation |
| **OpenCode Server** | Agent orchestration, tool execution (file ops, bash, search), model API calls |

### Process Lifecycle

1. Tauri app launches and spawns the sidecar binary as a child process
2. Sidecar starts the OpenCode server on a random loopback port with HTTP basic auth
3. Sidecar connects to the OpenCode SSE event stream
4. Frontend sends user prompts via Tauri commands → Rust → sidecar stdin
5. Sidecar forwards to OpenCode HTTP API, streams SSE events back as JSON-line stdout
6. Rust emits Tauri events (`task:update`, `task:permission_request`, etc.) to the frontend
7. On app quit, Rust terminates the sidecar, which shuts down the OpenCode server

### IPC Protocol

Rust serializes `SidecarCommand` as JSON-lines on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-lines on stdout. Both use `snake_case` type discriminants.

#### Rust → Sidecar (Commands)

| Command | Purpose |
|---------|---------|
| `start_task` | Begin a new task with prompt, model config, and permissions |
| `resume_session` | Resume a previous session with a new prompt |
| `cancel_task` | Cancel a running task |
| `abort_session` | Force-abort an OpenCode session |
| `send_permission_reply` | Reply to a permission request (allow/deny) |
| `send_question_reply` | Reply to an agent question |
| `ping` | Health check |
| `check_server` | Verify OpenCode server is running |

#### Sidecar → Rust (Events)

| Event | Purpose |
|-------|---------|
| `ready` | Sidecar initialized and server connected |
| `pong` | Response to ping |
| `server_status` | OpenCode server health status |
| `task_started` | Task accepted, session created |
| `task_message_partial` | Streaming token update |
| `task_message_complete` | Full message received |
| `task_progress` | Stage update (starting, connecting, configuring, executing, completing) |
| `task_complete` | Task finished with summary |
| `task_error` | Task failed with error details |
| `permission_request` | Agent needs file/command permission from user |
| `question_request` | Agent has a question for the user |
| `log` | Sidecar log message |
| `error` | Sidecar error |

### OpenCode Server Integration

The sidecar communicates with the OpenCode server via HTTP REST and Server-Sent Events.

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/event` | GET | SSE event stream for real-time updates |
| `/session/{id}/message` | POST | Send a message to an active session |
| `/permission/{id}/reply` | POST | Reply to a permission request |
| `/question/{id}/reply` | POST | Reply to an agent question |
| `/config` | PATCH | Update provider config, MCP servers |

**SSE Event Shapes (OpenCode v1.1.48):**

| Event | Payload |
|-------|---------|
| `session.status` | `{ sessionID: string, status: SessionStatus }` |
| `message.updated` | `{ info: MessageInfo }` |
| `message.part.updated` | `sessionID` and `messageID` nested inside `part` |
| `server.heartbeat` | Keepalive |
| `server.instance.disposed` | Server instance recycled (triggers SSE reconnection) |

**Note:** `PATCH /config` causes the OpenCode server to dispose and recreate its instance, terminating the SSE connection. The `eventsource` npm library auto-reconnects in ~1s. Do not add manual reconnection logic on top.

---

## Key Source Locations

| Path | Purpose |
|------|---------|
| `src/lib/tauri-api.ts` | Frontend API bridge — all Tauri `invoke()` and `listen()` calls |
| `src/lib/accomplish.ts` | `AccomplishAPI` interface abstracting the backend |
| `src/stores/taskStore.ts` | Zustand store for tasks, permissions, questions, UI state |
| `src-tauri/src/lib.rs` | Tauri command handlers (60+) |
| `src-tauri/src/sidecar.rs` | Sidecar process lifecycle, IPC serialization, event routing |
| `src-tauri/src/migrations.rs` | SQLite schema migrations |
| `src-tauri/sidecar-opencode/src/types.ts` | IPC protocol type definitions (single source of truth) |
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | OpenCode REST client |
| `src-tauri/sidecar-opencode/src/event-stream.ts` | OpenCode SSE client |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Session lifecycle management |

### Path Aliases

| Alias | Maps to |
|-------|---------|
| `@` | `src/` |
| `@shared` | `src/shared/` |

Configured in both `tsconfig.json` and `vite.config.ts`.

---

## Database Schema

**Storage:** SQLite at `~/Library/Application Support/Cowork Z/` (macOS) or `%APPDATA%/Cowork Z/` (Windows).

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `tasks` | id, prompt, status, session_id, summary, timestamps | Task metadata and lifecycle |
| `task_messages` | task_id, id, type, content, tool_name, tool_input | Persisted conversation messages |
| `folder_permissions` | task_id, folder_path, access_level, source | Per-task folder grants (user or adhoc) |
| `settings` | key, value | App settings (debug_mode, selected_model, etc.) |

**Credentials:** All API keys stored in OS keychain via the `keyring` crate — never in the database.

**Migrations:** Auto-run on app startup via `migrations.rs`.

**Optional encryption:** When enabled, the SQLite database is encrypted at rest using a key derived from the OS keychain.

---

## Sidecar Build & Distribution

### Constraints

- **Must use CommonJS** — the `pkg` bundler (`@yao-pkg/pkg`) has limited ESM support
- **No `.js` extensions** in TypeScript imports (CommonJS convention)
- **Tests:** Jest with `ts-jest` (CommonJS transpile)

### Binary Targets

| Target | Binary Name | Build Command |
|--------|------------|---------------|
| macOS ARM64 | `sidecar-opencode-aarch64-apple-darwin` | `pnpm build:binary` |
| macOS x64 | `sidecar-opencode-x86_64-apple-darwin` | `pnpm build:binary:x64` |
| Windows x64 | `sidecar-opencode-x86_64-pc-windows-msvc.exe` | `pnpm build:binary:win` |
| Linux x64 | `sidecar-opencode-x86_64-unknown-linux-gnu` | `pnpm build:binary:linux` |
| Linux ARM64 | `sidecar-opencode-aarch64-unknown-linux-gnu` | `pnpm build:binary:linux-arm64` |

**Binary path:** `src-tauri/binaries/sidecar-opencode-<target-triple>`

**Tauri config:** Referenced in `tauri.conf.json` under `bundle.externalBin`. The `beforeDevCommand` auto-builds the sidecar binary before starting dev mode.

---

## Security Architecture

### Credential Storage

All API keys and secrets are stored in the OS-native keychain:

| Platform | Backend |
|----------|---------|
| macOS | Keychain |
| Windows | Credential Manager |
| Linux | Secret Service (D-Bus) |

Service identifier: `com.kevinlin.cowork-z`

Keys are retrieved on-demand during task startup. Only masked prefixes are returned to the frontend.

### OpenCode Server Isolation

- Server binds to `127.0.0.1` on a **random available port** (not a fixed port)
- A **random password** is generated on each app launch
- The password is set via `OPENCODE_SERVER_PASSWORD` environment variable when spawning the OpenCode server
- All HTTP requests to the server require HTTP basic auth (`opencode` username + generated password)
- The sidecar handles authentication automatically

### Folder Permission Model

- Default access: user's **Desktop** and **Downloads** folders
- All other paths require explicit user approval via runtime permission dialogs
- Approved paths are stored as ad-hoc grants (parent folder extracted from requested path)
- Grants are persisted per task and restored on session resume
- Two access levels: `read` and `read-write`
- Two sources: `user` (explicit) and `adhoc` (from runtime approval)

### Database Encryption (Optional)

- SQLite database can optionally be encrypted at rest
- Encryption key derived from OS keychain
- Disabled by default (plaintext SQLite)

---

## Keyboard Shortcuts

Keyboard shortcuts are implemented in two layers: **app-level** (global) and **chat-scoped** (Execution page only).

### App-Level Shortcuts

Handled by a centralized `useKeyboardShortcuts` hook (`src/hooks/useKeyboardShortcuts.ts`) wired into `App.tsx`. The hook attaches a single `window.addEventListener('keydown', ...)` listener and checks for `metaKey` (macOS) or `ctrlKey` (Windows/Linux).

| Shortcut | Action | Implementation |
|----------|--------|----------------|
| `Cmd+,` / `Ctrl+,` | Open settings dialog | Calls `setShowSettings(true)` on Zustand store |
| `Cmd+N` / `Ctrl+N` | New task | Navigates to `/` via React Router |
| `Cmd+K` / `Ctrl+K` | Open task launcher | Calls `openLauncher()` on Zustand store |

### Chat-Scoped Shortcuts

Handled by a `useEffect` in `src/pages/Execution.tsx` that attaches a `window.addEventListener('keydown', ...)` listener scoped to the chat view lifecycle.

| Shortcut | Action | Guard Conditions |
|----------|--------|-----------------|
| `Escape` | Cancel running task (`interruptTask()`) | Task must be running; no permission dialog active |
| `Cmd+Enter` / `Ctrl+Enter` | Send follow-up message (`handleFollowUp()`) | Task must be in follow-up state (`canFollowUp`) |

---

## Key Architectural Decisions

1. **OpenCode CLI over embedded agent**: Delegates tool execution, model API calls, and agent orchestration to OpenCode rather than implementing a custom agent runtime
2. **Node.js sidecar over Python**: Switched from the original Python sidecar design to Node.js for better alignment with OpenCode's JavaScript SDK
3. **JSON-line IPC**: Structured stdin/stdout communication between Rust and sidecar — simple, debuggable, no socket management
4. **SSE over WebSocket**: OpenCode uses Server-Sent Events for streaming — simpler protocol, automatic reconnection via `eventsource` library
5. **Tied lifecycle**: Sidecar and OpenCode server start/stop with the app — no orphaned processes
6. **Provider-agnostic frontend**: Frontend doesn't hardcode model lists — fetches dynamically from provider APIs via OpenCode config
7. **OS keychain for all secrets**: No plaintext credential storage anywhere in the system
