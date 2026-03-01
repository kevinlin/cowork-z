# Cowork-Z — Technical Design Document

## Overview

Cowork-Z is a cross-platform desktop application that provides a sandboxed environment for autonomous AI agents. It delegates agent orchestration to the OpenCode CLI, connected via a Node.js sidecar process that communicates with the Rust backend over JSON-line IPC.

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

## Module Design Specs

Each module has its own comprehensive design document covering technical solutions, architecture, and resolved issues.

| Module | Design Document | Domain |
|--------|----------------|--------|
| **OpenCode Integration** | [design_opencode-integration.md](opencode-integration/design_opencode-integration.md) | IPC protocol, sidecar architecture, session management, security isolation, provider support, build & distribution |
| **Chat Experience** | [design_chat-ux.md](chat-ux/design_chat-ux.md) | Message rendering, streaming, tool call display, question/permission dialogs, input handling, sidebar panels |
| **App Experience** | [design_app-ux.md](app-ux/design_app-ux.md) | Themes, keyboard shortcuts, settings, about panel, feedback, update system, CLI detection |
| **Workspace-as-Folder** | [design_workspace-as-folder.md](workspace-as-folder/design_workspace-as-folder.md) | Workspace lifecycle, file tree, permissions, file preview panel |
| **Workspace Packs** | [design_workspace-packs.md](workspace-packs/design_workspace-packs.md) | Starter pack catalog, installation, workspace creation |
| **Skills Management** | [design_skills-catalog.md](skills-management/design_skills-catalog.md), [design_skills-manager.md](skills-management/design_skills-manager.md) | Bundled skill catalog, repo-based skill management |
| **Windows Support** | [design_windows-support.md](windows-support/design_windows-support.md) | Platform-specific runtime fixes, PATH resolution, build targets |

---

## Architecture Overview

### Multi-Process Architecture

```
Tauri (Rust) ↔ JSON-line IPC (stdin/stdout) ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
```

| Process | Role |
|---------|------|
| **Tauri (Rust)** | App lifecycle, database, secure storage, IPC routing, Tauri command handlers |
| **Node.js Sidecar** | OpenCode server management, HTTP/SSE client, protocol translation |
| **OpenCode Server** | Agent orchestration, tool execution (file ops, bash, search), model API calls |

For detailed IPC protocol, SSE event shapes, session lifecycle, and security architecture, see the [OpenCode Integration design spec](opencode-integration/design_opencode-integration.md).

### Frontend Architecture

#### Pages (react-router-dom)

- `/` — `src/pages/Home.tsx` — Task launcher, starter packs, skills catalog
- `/task/:taskId` — `src/pages/Execution.tsx` — Active task chat view

#### State Management (Zustand)

- `src/stores/taskStore.ts` — Tasks, permissions, questions, active task, UI state
- `src/stores/workspaceStore.ts` — Workspace list, active workspace, switching
- `src/stores/filePreviewStore.ts` — File preview panel state
- `src/stores/skillsStore.ts` — Installed skills for slash-command autocomplete
- `src/stores/skillsManagerStore.ts` — Skills Manager window state

For detailed chat components, message rendering, and input handling, see the [Chat Experience design spec](chat-ux/design_chat-ux.md).

---

## Database Schema

**Storage:** SQLite at `~/Library/Application Support/cowork-z/` (macOS) or `%APPDATA%/Cowork-Z/` (Windows).

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `tasks` | id, prompt, status, session_id, summary, timestamps | Task metadata and lifecycle |
| `task_messages` | task_id, id, type, content, tool_name, tool_input | Persisted conversation messages |
| `folder_permissions` | task_id, folder_path, access_level, source | Per-task folder grants (user or adhoc) |
| `settings` | key, value | App settings (debug_mode, selected_model, etc.) |
| `workspaces` | id, folder_path, display_name, timestamps | Workspace definitions |
| `skill_repos` | id, url, branch, last_synced, error | Registered skill Git repos |
| `repo_skills` | repo_id, skill_path, name, description, category | Discovered skills from repos |

**Credentials:** All API keys stored in OS keychain via the `keyring` crate — never in the database.

**Migrations:** Auto-run on app startup via `migrations.rs`.

**Optional encryption:** When enabled, the SQLite database is encrypted at rest using a key derived from the OS keychain.

---

## Key Source Locations

| Path | Purpose |
|------|---------|
| `src/lib/tauri-api.ts` | Frontend API bridge — all Tauri `invoke()` and `listen()` calls |
| `src/lib/tauri-api-interface.ts` | `TauriAPI` interface abstracting the backend |
| `src/stores/taskStore.ts` | Zustand store for tasks, permissions, questions, UI state |
| `src-tauri/src/lib.rs` | App entry point, plugin registration, menu setup |
| `src-tauri/src/commands/` | Tauri command handlers (organized by domain) |
| `src-tauri/src/db/` | SQLite persistence layer |
| `src-tauri/src/sidecar.rs` | Sidecar process lifecycle, IPC serialization, event routing |
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

## Key Architectural Decisions

1. **OpenCode CLI over embedded agent**: Delegates tool execution, model API calls, and agent orchestration to OpenCode rather than implementing a custom agent runtime
2. **Node.js sidecar over Python**: Switched from the original Python sidecar design to Node.js for better alignment with OpenCode's JavaScript SDK
3. **JSON-line IPC**: Structured stdin/stdout communication between Rust and sidecar — simple, debuggable, no socket management
4. **SSE over WebSocket**: OpenCode uses Server-Sent Events for streaming — simpler protocol, automatic reconnection via `eventsource` library
5. **Tied lifecycle**: Sidecar and OpenCode server start/stop with the app — no orphaned processes
6. **Provider-agnostic frontend**: Frontend doesn't hardcode model lists — fetches dynamically from provider APIs via OpenCode config
7. **OS keychain for all secrets**: No plaintext credential storage anywhere in the system
