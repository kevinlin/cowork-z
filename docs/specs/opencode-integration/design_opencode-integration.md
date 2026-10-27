# OpenCode Integration — Design Document

## Overview

The OpenCode integration layer bridges the Tauri (Rust) desktop application to the OpenCode CLI agent runtime via a Node.js sidecar process. It handles the full lifecycle of agent sessions — from spawning the OpenCode server, through IPC command/event routing, to real-time SSE streaming — and encompasses security isolation, permission management, provider configuration, and system prompt injection.

---

## Multi-Process Architecture

> **Plan:** [Sidecar OpenCode Rewrite](plan_sidecar-opencode-rewrite.md) — Complete rewrite from PTY-based `opencode run` to the `opencode serve` HTTP/SSE API.

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

---

## IPC Protocol

Rust serializes `SidecarCommand` as JSON-lines on sidecar stdin. Sidecar emits `SidecarEvent` as JSON-lines on stdout. Both use `snake_case` type discriminants.

### Rust → Sidecar (Commands)

| Command | Purpose |
|---------|---------|
| `start_task` | Begin a new task with prompt, model config, and permissions |
| `resume_session` | Resume a previous session with a new prompt |
| `cancel_task` | Cancel a running task (no-op in server mode — use `abort_session`) |
| `abort_session` | Force-abort an OpenCode session |
| `send_permission_reply` | Reply to a permission request (allow/deny) |
| `send_question_reply` | Reply to an agent question |
| `get_session_todos` | Fetch todo items for a session |
| `update_mcp_config` | Update MCP server configuration |
| `copilot_oauth_authorize` | Initiate GitHub Copilot OAuth device flow |
| `copilot_get_models` | Fetch available Copilot models |
| `copilot_disconnect` | Disconnect GitHub Copilot OAuth |
| `ping` | Health check |
| `check_server` | Verify OpenCode server is running |
| `shutdown` | Gracefully shut down the sidecar |

### Sidecar → Rust (Events)

| Event | Purpose |
|-------|---------|
| `ready` | Sidecar initialized and server connected |
| `pong` | Response to ping |
| `server_status` | OpenCode server health status |
| `task_started` | Task accepted, session created (includes `sessionId`) |
| `task_message` | Full assistant message received |
| `task_message_partial` | Streaming token update |
| `task_message_complete` | Full message finalized with accumulated text |
| `task_progress` | Stage update (starting, connecting, configuring, executing, completing) |
| `task_complete` | Task finished with summary |
| `task_error` | Task failed with error details |
| `permission_request` | Agent needs file/command permission from user |
| `question_request` | Agent has a question for the user |
| `todo_updated` | Agent's todo list changed |
| `copilot_oauth_result` | GitHub Copilot device code for user |
| `copilot_oauth_complete` | GitHub Copilot OAuth flow completed |
| `copilot_models_result` | Available Copilot models |
| `log` | Sidecar log message |
| `error` | Sidecar error |

---

## OpenCode Server Integration

The sidecar communicates with the OpenCode 2.x server via HTTP REST and Server-Sent Events. Every route lives under `/api`; the full contract is [`opencode-api.json`](opencode-api.json), a snapshot of `GET /openapi.json` from `opencode serve` 2.2.0.

### Endpoints

Location-scoped routes (MCP, integrations, models) take `?location[directory]=<workspace>`, an OpenAPI `deepObject` parameter. Session routes need no scoping: the workspace is fixed when the session is created.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/info` | GET | Health and version probe; a 1.x server doesn't answer it and is rejected at startup |
| `/api/event` | GET | SSE event stream for real-time updates (one stream for all workspaces; client filters by `location.directory`) |
| `/api/session` | POST | Create a session with its `location`, `model` and `permissions` |
| `/api/session/{id}` | GET, PATCH | Check that a session exists; replace its permission rules |
| `/api/session/{id}/prompt` | POST | Send a user turn; returns once the server has admitted it |
| `/api/session/{id}/interrupt` | POST | Abort the running turn |
| `/api/experimental/session/{id}/instructions/entries/{key}` | PUT | Write the system prompt (entry `cowork-z`) |
| `/api/session/{sid}/permission/{rid}/reply` | POST | Reply to a permission request |
| `/api/session/{sid}/form/{fid}/reply` | POST | Reply to an agent question (a form) |
| `/api/experimental/mcp/{name}` | PUT, DELETE | Add, replace or remove an MCP server at runtime |

GitHub Copilot sign-in uses the `/api/integration/github-copilot/connect/oauth` routes, and model listing uses `/api/model`.

### SSE Event Shapes

`/api/event` delivers each frame as a plain `data:` line:

```json
{ "id": "...", "created": 1793115671105, "type": "...", "location": { "directory": "<workspace path>" }, "data": { ... } }
```

Frames without a `location` (`server.connected`, `session.execution.*`) are server-wide. The sidecar's `EventStream` drops frames whose `location.directory` belongs to another workspace and passes everything else through; handlers receive the frame's `data`.

| Event type | Data |
|------------|------|
| `session.execution.started` / `.succeeded` / `.failed` / `.interrupted` | Turn lifecycle; `.failed` carries `error { type, message }`, `.interrupted` carries `reason` |
| `session.text.delta` | `{ assistantMessageID, ordinal, delta }`, followed by `session.text.ended { text }` |
| `session.tool.input.started` | `{ id, name }` (the only event that carries the tool name) |
| `session.tool.called` / `.success` / `.failed` | `{ id, input }`, then `{ content }` or `{ error }` |
| `permission.asked` | `{ id, sessionID, action, resources, metadata }` |
| `form.created` | `{ form: { id, sessionID, title, fields } }` |

**Volatile stream:** `/api/event` is volatile by contract. Events sent while the stream is down are lost, and a slow consumer gets the stream killed. The first `server.connected` frame marks the stream ready; every later one makes `EventStream` emit `reconnected`, and the session manager rebuilds each active session over REST (session state, pending permission asks and forms). See [Resolved: OpenCode 2.x migration (1.0.0)](#resolved-opencode-2x-migration).

---

## System Prompt Injection

The system prompt is written into a per-session instructions entry named `cowork-z` before every prompt, bypassing agent resolution entirely. OpenCode 2.x's `prompt` route has no `system` field, and the entry is replaced by key, so each resume refreshes it. This replaces the 1.x `system` field on each message (see [Resolved Issue: System Prompt Not Applied](#resolved-system-prompt-not-applied) for the earlier agent-config attempt).

**Sequence:**

1. Rust sends `start_task(prompt, ...)` to sidecar
2. Sidecar sends `POST /api/session` (`location`, `model`, `permissions` — no agent)
3. Sidecar sends `PUT /api/experimental/session/{id}/instructions/entries/cowork-z` with `SYSTEM_PROMPT`
4. Sidecar sends `POST /api/session/{id}/prompt` with `text`

`resume_session` repeats steps 3 and 4 on the existing session, after `PATCH /api/session/{id}` re-applies the current permissions. If `GET /api/session/{id}` returns 404 (a session from before the upgrade), the sidecar creates a new session in the same task instead.

The system prompt includes:
- Server port, and the password only as a reference to `$OPENCODE_SERVER_PASSWORD` (so the agent can call the OpenCode server API directly without the password appearing in the prompt)
- **Workspace conventions** (always emitted): the current workspace path, an auto-create `mkdir -p` first action for the four convention folders (`Input/`, `Output/`, `Misc/`, `Artefacts/`), and the soft rules covering read-only folders, category-subfolder layout under `Output/`, and the dual promotion workflow (`Output/` → `Artefacts/` for governed deliverables, `Output/` → `Misc/` for curated utilities). See [Workspace Conventions in System Prompt](#workspace-conventions-in-system-prompt).
- User custom prompt (when enabled, wrapped in `<user-instructions>` XML block)

### Workspace Conventions in System Prompt

`buildSystemPrompt` requires `workspaceDir: string` as a mandatory parameter — the signature order is `(serverPort, serverPassword, workspaceDir, customPrompt?)`. Callers in `session-manager.ts` pass `workingDirectory ?? ''` (the payload type marks `workingDirectory` optional, but in practice every task runs inside a workspace).

The injected `<workspace-conventions>` block:
1. **Declares the current workspace path** so the agent can resolve relative references.
2. **Instructs the agent to auto-create any missing convention folders as its first action** — a single idempotent `mkdir -p "<ws>/Input" "<ws>/Output" "<ws>/Misc" "<ws>/Artefacts"` (PowerShell `New-Item -ItemType Directory -Force ...` on Windows). `mkdir -p` is safe on existing folders. It is the *only* path the agent has to create `Input/` because the `write`/`edit` tools are blocked by `edit: deny`. For `Misc/` and `Artefacts/` (both `edit: ask`), the `mkdir -p` first-action also avoids triggering a per-file permission prompt on workspace bootstrap. Bash is not gated by the `edit` permission, so this works even when the folders are missing.
3. **Documents all four convention folders** with role + permission summaries aligned with the `rfp-daily` folder-governance model:
   - `Input/` — immutable source-of-truth material (datasets, reference docs, governance, templates), `edit: deny`. Only the user adds or replaces files.
   - `Output/` — agent's working scratchpad, `edit: allow`. The only folder the agent may write to freely. New files must live under a **category subfolder** (never directly in `Output/` root). Disposable — files are regenerated, deleted, or promoted to `Artefacts/` or `Misc/` once stable.
   - `Misc/` — default read-only, `edit: ask`. Holds two related kinds of content: (a) **static user-provided assets** (icons, logos, brand images, fonts) and (b) **curated supporting scripts and prompt experiments** generated by the agent and promoted from `Output/` after human review. The agent never overwrites user-placed static assets.
   - `Artefacts/` — default read-only, `edit: ask`. Holds **governed, versioned deliverables** promoted from `Output/` after human review (BPMN, gap analyses, risks, requirements, scope, solution designs, trackers, UX prototypes, finalized PRDs, ADRs, etc.). These are authoritative — the source of truth the agent actively references and evolves.

   The hard rules are emitted by `buildSessionPermissions` (see [Folder Permission Model](#folder-permission-model)).
4. **Forces new-file creation under a category subfolder of `<workspace>/Output/`** — every write/edit tool call and every file-creating bash command (`touch`, `>`, `tee`, `mkdir`, `cp`, `mv`, etc.) must target a path inside a subfolder of `Output/`, never directly in `Output/` root. The agent picks the subfolder name based on the file's nature, with these common categories suggested in the prompt: `executable/` (scripts), `product/` (PRDs, user stories), `ux-prototype/` (mockups, HTML prototypes), `engineering/` (design docs, ADRs), `testing/` (test cases, scripts), `research/` (notes, summaries), `data/` (datasets, exports), plus `scratch/` (intermediate data) and `logs/` (debug logs) under `Output/` only. The agent is instructed to **reuse existing subfolders first** before creating new ones, so artefacts stay grouped consistently across follow-up tasks in the same workspace.
5. **Describes the dual promotion workflow** — `Output/` content is the agent's working area; the user reviews and decides whether to promote each file. Two promotion targets are documented:
   - **Governed deliverables → `Artefacts/<category>/...`** — `Artefacts/` mirrors the `Output/` category-subfolder layout so promoted files keep their classification (e.g., `Output/product/spec.md` → `Artefacts/product/spec.md`).
   - **Curated utilities → `Misc/<topic>/...`** — supporting scripts go to `Misc/scripts/<name>.py`, prompt experiments to `Misc/prompt-experiments/<name>.md`.

   Triggers include "promote", "publish", "save as artefact", "save as utility", or "finalize". Because both `Artefacts/` and `Misc/` are `edit: ask`, OpenCode prompts the user before each write — the agent never promotes proactively or silently.

This is soft-enforced via the prompt only — the hard rules on `Input/`, `Output/`, `Misc/`, and `Artefacts/` already cover the file-write side, so the categorized convention requires no additional permission-rule changes.

This removes the prior conditional branch that skipped the block when `workspaceDir` was undefined — the section is now always rendered.

### User Prompt Customization

> **Plan:** [User Prompt Customization](plan_user-prompt-customization.md)

Users configure a custom system prompt via a Settings toggle and textarea. When enabled, the custom prompt is appended to the agent's system prompt in a `<user-instructions>` XML block, written into the session's `cowork-z` instructions entry before each prompt. Persisted to SQLite (`app_settings` table) and applied on every `startTask` and `resumeSession` call through the sidecar IPC protocol.

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

> **Plan:** [Server Isolation](plan_server-isolation.md)

- Server binds to `127.0.0.1` on a **random available port** (not a fixed port)
- A **random password** is generated on each app launch
- The password is set via `OPENCODE_SERVER_PASSWORD` environment variable when spawning the OpenCode server
- All HTTP requests to the server require HTTP basic auth (`opencode` username + generated password)
- The sidecar handles authentication automatically
- On Windows, excluded/reserved port ranges (Hyper-V / WinNAT) are queried and avoided

### Folder Permission Model

> **Plan:** [Folder Permission Model](plan_folder-permission-model.md)
> **Plan:** [Convention-Based Workspace Permission Model](plan_convention-based-workspace-permission-model.md)

- **Convention-based defaults:** Workspace exposes four convention folders with hard edit rules emitted by `buildSessionPermissions` (`config-builder.ts`) — an ordered v2 rule list where the last matching rule wins and workspace patterns are location-relative (`Input/*`), sent when the session is created and again on resume: `Input/` (immutable source-of-truth material, `edit: deny`), `Output/` (scratchpad with category subfolders, `edit: allow`), `Misc/` (default read-only — static assets like icons/logos/images/fonts plus curated supporting scripts and prompt experiments promoted from `Output/`, `edit: ask` so the user approves each save), `Artefacts/` (governed, versioned deliverables typically promoted from `Output/`, `edit: ask` so the user approves each save). v2 allows `external_directory` by default, so the list always opens with an `external_directory * ask` rule; without it the sandbox would be open. This aligns with the four-tier governance model used in the `rfp-daily` skill (see `~/dev/ai-sdlc/zapac-agent-skills/rfp-daily/assets/folder_governance.md`). Workspace root allows read/list for everything; the four folders are auto-created on workspace entry by an agent-issued `mkdir -p` (see [Workspace Conventions in System Prompt](#workspace-conventions-in-system-prompt))
- **Workspace-scoped persistence:** Permissions are stored in the `workspace_permissions` table (replaced task-scoped `folder_permissions`). Adhoc approvals carry across all tasks in the same workspace.
- **Bash soft enforcement:** System prompt instructs the agent not to modify `Input/` via bash commands. Hard enforcement is via `edit: deny` rules in the session's permissions, which are re-sent on resume so a revoked grant also applies to an existing session.
- **Architecture flow:** User approves permission → saved to `workspace_permissions` → loaded for all future tasks in the workspace
- All paths outside the workspace require explicit user approval via runtime permission dialogs
- Two access levels: `read` and `read-write`
- Three sources: `user` (explicit), `adhoc` (from runtime approval), `workspace` (auto-granted)

### Database Encryption (Optional)

- SQLite database can optionally be encrypted at rest
- Encryption key derived from OS keychain
- Disabled by default (plaintext SQLite)

---

## Session Management

### Session Lifecycle

The `SessionManager` class (`session-manager.ts`) maintains two in-memory maps:
- `sessions`: `Map<taskId, ManagedSession>` — tracks active sessions
- `sessionToTask`: `Map<sessionId, taskId>` — routes incoming SSE events to the correct task

Sessions transition through states: `idle` → `busy` (executing) → `idle` (complete) or `error`. The `handleSessionIdle` method finalizes the session when it returns to idle, emitting accumulated text and cleanup events.

### Fire-and-Forget Message Sending

The `sendMessage` HTTP call is fire-and-forget — the response is not awaited. All session lifecycle events (messages, completion, errors) arrive via SSE. This prevents false task failures when agent turns exceed HTTP timeout limits.

Previously, `sendMessage` was awaited with a 10-minute timeout. For complex tasks exceeding this limit, the `AbortController` would fire, propagating an error to the frontend as `task_error` even though the SSE stream continued delivering events (the OpenCode session was still running).

### Question & Permission Handling

**Question reply format:** OpenCode 2.x delivers agent questions as forms (`form.created`). `form-mapper.ts` turns each form field into one UI question: a `string` field with options is single-select, a `string` field without options is free text, `multiselect` is multi-select, `boolean` becomes Yes/No, and `number`/`integer` are free text parsed into a number. Hidden fields and fields with `when` conditions are skipped. A form with an `external` field can't be shown, so the sidecar cancels it with `DELETE /api/session/{sid}/form/{fid}`. The answer goes out as `POST /api/session/{sid}/form/{fid}/reply` with `{ answer: { [field.key]: value } }`: the sidecar maps option labels back to option values, sends an array for multi-select, and adds the custom text when the field allows it. If the server refuses an answer (`FormInvalidAnswerError`), the same questions are shown again with the reason.

**Multi-select questions:** A `multiselect` form field becomes `multiSelect: true` on the question the sidecar emits to the frontend. The QuestionDialog renders checkbox indicators and count badges when multi-select is enabled.

**Always-on free-text fallback:** The frontend `QuestionDialog` injects a synthetic `Others` option (description "Type your own response") whenever the agent's `options` array contains at least one entry but no case-insensitive `Other`/`Others` variant, unless the question's `custom` flag is `false` (the sidecar copies it from the form field, default `true`). Selecting it surfaces a free-text input whose contents become the answer's `customText`; in multi-select mode the input is rendered inline so it can coexist with checkbox selections. The `buildFormAnswer` mapping (`labels` + `customText` → the field's value) means OpenCode receives the typed text as the answer itself, or added to the array for multi-select, without any protocol change. When the agent supplies no options at all, the dialog continues to render the free-text-only path instead of injecting the synthetic option.

**Permission replies:** `replyToPermission` finds the session the ask belongs to (the task's session, or the one recorded when the ask was shown) and calls `POST /api/session/{sid}/permission/{rid}/reply` with `{ decision, message? }`. Rust sends only `once` (allow) or `reject`: an `always` reply on an edit ask would allow every edit in the project. The `permission.asked` payload reaches the UI with the v2 `action` as `permission` (`shell` shown as `bash`) and `resources` as `patterns`. Neither reply passes a `directory`: the session already carries its location.

---

## Session Cleanup & Cross-Task Isolation

A critical invariant is that sessions from one task must never leak messages or state into another task. This is enforced at two layers:

### Sidecar Layer

Three cleanup triggers in `SessionManager`:

1. **`handleSessionIdle`** — Calls `cleanup(taskId)` after emitting `task_complete`, removing completed sessions from both maps.
2. **`session.error` handler** — Calls `cleanup(taskId)` after emitting `task_error`, removing errored sessions from both maps.
3. **`startTask`** — Proactively cleans up all stale sessions before registering the new one, catching sessions abandoned due to unanswered questions, permissions, or any other reason.

### Frontend Layer

The Zustand store's `partialMessages` Map (holding streaming/in-progress assistant messages) is cleared on every task switch:
- `startTask` resets `partialMessages: new Map()`
- `loadTaskById` resets `partialMessages: new Map()`

Without these resets, stale partial messages from a previous task would appear in the new task's `MessageList` component, which merges completed messages with partials from the global store.

---

## MCP Server Support

> **Plan:** [MCP Server Support](plan_mcp-server-support.md)

MCP (Model Context Protocol) server configuration allows users to extend the agent with additional tools via local commands or remote URLs. Configurations are managed in the Settings UI, persisted to the database, and applied to the OpenCode server at runtime: a fresh server receives them through `OPENCODE_CONFIG_CONTENT`, and `update_mcp_config` adds, replaces or removes servers on a running server with `PUT` and `DELETE /api/experimental/mcp/{name}`, without a restart. Supports both local (command-based) and remote (URL-based) MCP servers with per-server enable/disable toggles.

### Tool Listing API Limitation

OpenCode 2.x has no route that lists tools, so the sidecar can't list MCP server tools. `get_mcp_tools` answers with an empty `toolIds` list. `GET /api/mcp` (scoped with `?location[directory]=<workspace>`) returns only per-server connection status, `{ name, status: { status, error? } }`, which `mcp-runtime.ts` converts into the `name → { status, error? }` record the UI expects (v2 `pending` shows as `initializing`).

The frontend's `groupToolsByServer` utility (`useMcpRuntime.ts`) is implemented and tested, ready to parse `{serverName}_{toolName}` prefixed IDs if a tool list becomes available. Until then, the `McpServerCard` displays connection status as the primary indicator of server health.

---

## OpenCode Server API Skill

> **Plan:** [OpenCode Server API Skill](plan_opencode-server-skill.md)

A bundled `SKILL.md` gives the agent self-introspection capabilities — the ability to check its own health, session state, message history, todos, config, skills, and MCP status via the OpenCode server REST API. Deployed to `~/.config/opencode/skills/opencode-server-api/SKILL.md` on every app launch.

---

## Provider Support

### Provider Categories

| Category | Providers |
|----------|-----------|
| **Direct API** | Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, Z.AI |
| **Cloud Platforms** | AWS Bedrock, Azure AI Foundry |
| **Local** | Ollama |
| **Proxy** | LiteLLM, OpenRouter |
| **OAuth** | GitHub Copilot |

### OpenRouter Integration

> **Plan:** [OpenRouter Provider Support](plan_openrouter-provider-support.md)

When a user connects with an OpenRouter API key (`sk-or-` prefix), the app fetches the available model catalog from the OpenRouter API. Model IDs are prefixed with `openrouter/` for delivery to the OpenCode server. Small-model pinning ensures small-model calls are routed through the same OpenRouter provider.

### GitHub Copilot Integration

> **Plan:** [GitHub Copilot Provider Support](plan_github-copilot-provider-support.md)

GitHub Copilot uses the OAuth device flow via the OpenCode server's provider auth API. The sidecar manages the device code exchange, polling for authorization completion, and fetching available models after authentication.

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

## Key Source Locations

| Path | Purpose |
|------|---------|
| `src-tauri/src/sidecar.rs` | Sidecar process lifecycle, IPC serialization, event routing |
| `src-tauri/sidecar-opencode/src/types.ts` | IPC protocol type definitions (single source of truth) |
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | OpenCode REST client |
| `src-tauri/sidecar-opencode/src/event-stream.ts` | OpenCode SSE client |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Session lifecycle management |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | OpenCode config and system prompt builder |
| `src-tauri/sidecar-opencode/src/index.ts` | Sidecar entry point, IPC command routing |
| `src-tauri/src/secure_storage.rs` | OS Keychain wrapper (keyring crate) |
| `src-tauri/src/commands/api_keys.rs` | API key Tauri commands |
| `src-tauri/src/commands/providers.rs` | Provider configuration commands |
| `src-tauri/src/commands/copilot.rs` | GitHub Copilot OAuth commands |

---

## Resolved Issues

### Resolved: System Prompt Not Applied {#resolved-system-prompt-not-applied}

**Problem:** The custom "accomplish" agent's system prompt was not being applied because OpenCode 1.1.48 ignores custom agent names set via `PATCH /config`.

**Root Cause:**

1. `PATCH /config` sends `default_agent: "accomplish"` with the full agent config including the system prompt. The server returns 200 with the config echoed back.
2. Despite accepting the config, the server falls back to the built-in `build` agent. Log evidence: messages show `"agent": "build"`, `"mode": "build"`. The `default_agent` API spec says: *"Falls back to 'build' if not set or if the specified agent is invalid"* — OpenCode treats the custom agent as invalid at runtime.
3. The `agent` parameter on `sendMessage` also doesn't work — OpenCode 1.1.48's `sendMessage` API fails to resolve custom agent names, causing `TypeError: undefined is not an object (evaluating 'agent.name')`.

**Fix:** Use the `system` field on `POST /session/{id}/message`, which provides a direct system prompt override bypassing agent resolution entirely.

- `config-builder.ts` — Exports `SYSTEM_PROMPT` constant; removed `agent`/`default_agent` from config sent via `PATCH /config`
- `session-manager.ts` — Passes `system: SYSTEM_PROMPT` in both `sendMessage` calls (`startTask` and `resumeSession`)
- `opencode-client.ts` — Added `system?: string` parameter to `sendMessage()` and includes it in the request body

---

### Resolved: Cross-Task Message Leakage (GitHub #22)

**Problem:** Messages from failed or stuck sessions appeared in newly started tasks. Two scenarios:

1. **Failed session leakage** — A task errors out, and messages from the failed task appear in the new conversation.
2. **Stuck-after-question leakage** — A task asks a question, the user answers, but the task never resumes. Starting a new task shows messages from the stuck conversation.

**Root Cause (two independent causes):**

**Cause 1: Sidecar session map not cleaned up.** The `SessionManager` maps (`sessions` and `sessionToTask`) were never cleaned up when a session completed or errored — the `cleanup()` method was only called from `abortSession()`. Late-arriving SSE events for stale sessions would be routed to the old task's `taskId`, persisting messages to the wrong task.

**Cause 2: Partial messages not cleared on task switch.** The Zustand store's `partialMessages` Map was never cleared when switching between tasks — only on workspace switch. Stale streaming messages from a stuck task would appear in the new task's `MessageList` because the merge logic operates on a global (not per-task) Map.

**Fix:**

Sidecar (`session-manager.ts`):
1. `handleSessionIdle` — Added `this.cleanup(managed.taskId)` after emitting the `complete` event
2. `session.error` handler — Added `this.cleanup(taskId)` after emitting the `error` event
3. `startTask` — Added proactive cleanup of all stale sessions before registering the new one:

```typescript
const staleTaskIds = Array.from(this.sessions.keys()).filter((id) => id !== taskId);
for (const oldTaskId of staleTaskIds) {
    this.cleanup(oldTaskId);
}
```

Frontend (`taskStore.ts`):
1. `startTask` — Added `partialMessages: new Map()` to clear stale partials
2. `loadTaskById` — Added `partialMessages: new Map()` to clear stale partials

**Debugging methodology:** Required systematic runtime instrumentation across three layers (sidecar session lifecycle, frontend event routing, frontend state transitions). The sidecar cause was identified first; the frontend cause required two additional rounds because the `partialMessages` leak operated through a separate path invisible to event-level instrumentation.

---

### Resolved: Question Reply Payload Format Mismatch

**Problem:** After answering a question prompt from the agent, the task gets permanently stuck — no further responses from OpenCode.

**Root Cause:** The OpenCode server's `POST /question/{id}/reply` expects `answers` as `string[][]` (array of arrays), but the sidecar was sending `answers` as an array of objects with a `labels` property:

```json
// Expected by server:
{ "answers": [["Selected Label A"]] }
// Sent by sidecar:
{ "answers": [{ "labels": ["Selected Label A"] }] }
```

This caused a 400 Bad Request: `"Invalid input: expected array, received object" at path ["answers", 0]`. The error was caught and logged but never propagated to the frontend as a `task_error` event, leaving the UI stuck.

**Fix:**

- `session-manager.ts` — `replyToQuestion` now transforms `{labels, customText}` objects into flat `string[]` arrays:
  ```typescript
  const flatAnswers: string[][] = answers.map((a) => {
    if (a.customText) return [...a.labels, a.customText];
    return a.labels;
  });
  ```
- `opencode-client.ts` — Changed `replyToQuestion` signature from `QuestionAnswer[]` to `string[][]`
- `index.ts` — `handleQuestionReply` now sends a `task_error` event when the reply fails

---

### Resolved: Multi-Select Question Dialog

**Problem:** When the agent sends a question with `multiple: true`, the QuestionDialog always behaved as single-select.

**Root Cause:** The OpenCode server sends `multiple: true` on each question object in the `question.asked` SSE event. The sidecar's `QuestionInfo` type defined the field as `multiSelect`, and passed `props.questions` through without mapping. Since `multiple` is not in the type definition, it was silently dropped, and `multiSelect` was always `undefined` on the frontend.

**Fix:**

- `types.ts` — Added `multiple?: boolean` to `QuestionInfo`
- `session-manager.ts` — Maps each question's fields before emitting: `multiSelect: q.multiSelect ?? q.multiple ?? false`
- `QuestionDialog.tsx` — When `multiSelect` is true: shows checkbox indicators, "Select one or more options" helper text, and a count badge on submit when 2+ options are selected

---

### Resolved: SSE Stream Closes Immediately on OpenCode 1.14.x {#resolved-sse-stream-closes-immediately}

**Problem:** After upgrading to OpenCode 1.14.48, no SSE events reached the frontend — tasks would launch but the UI never received `session.created`, `message.updated`, or any other event. Both the OpenCode server log and the sidecar's `*_TS.log` showed the same pattern repeating every ~1 second:

```
SSE stream connected
OpenCode Server Event {"type":"server.connected", ...}
Event stream error (will reconnect)
```

No `session.*`, `message.*`, or heartbeat events ever arrived between cycles.

**Root Cause:** OpenCode 1.14.x rebuilt the bus on top of Effect's `PubSub` + `InstanceState`, and the per-instance `/event` route subscribes through it. The bus state is created inside the request's Effect scope and registers a finalizer that **publishes `server.instance.disposed` and shuts down the wildcard `PubSub`** the moment the scope ends — which it always does immediately because `Instance.provide()` returns as soon as the handler's outer function resolves (well before the async SSE writer is finished streaming). The route handler in `packages/opencode/src/server/routes/event.ts` listens for `Bus.InstanceDisposed.type` and calls `stop()`, which closes the chunked response after writing the single `server.connected` frame.

Verified directly against the running server with raw curl:

```
HTTP/1.1 200 OK
Transfer-Encoding: chunked
...
data: {"id":"evt_...","type":"server.connected","properties":{}}
0          ← chunked-end marker, server-initiated, <1 ms after connect
```

**Fix:** Switch the sidecar's `EventStream` from the per-instance `/event` route to the workspace-agnostic `/global/event` route, which is backed by `GlobalBus` (a plain Node.js `EventEmitter` decoupled from instance lifecycle). The stream stays open across instance disposal, `PATCH /config`, and workspace switches.

- `event-stream.ts` — Now connects to `/global/event` (no `?directory=` query param). Defines `GlobalEventEnvelope = { directory?, project?, payload }`, unwraps `envelope.payload` to the existing `OpenCodeEvent` shape so all downstream emitters (`session.status`, `message.part.updated`, `permission.asked`, etc.) and `SessionManager` listeners are unchanged. Workspace scoping moved from the URL to an in-process filter: events whose `envelope.directory` is set and doesn't match `this.directory` are dropped; server-only frames (no `directory`) always pass through.
- The earlier "PATCH /config terminates the SSE connection, eventsource auto-reconnects in ~1 s" note no longer applies — `GlobalBus` is not torn down by config updates.

**Debugging methodology:** Bug was diagnosed entirely from runtime evidence: OpenCode server log (`~/.local/share/opencode/log/<timestamp>.log`) showed `subscribing → connected → unsubscribing → disconnected` within 1–2 ms; sidecar TS log showed the matching `server.connected` → `error` loop; direct raw-TCP probe of the running server with `curl` confirmed the server itself terminated the chunked response (received `0\r\n\r\n` end-marker), proving it was server-side, not the `eventsource` library. A second curl against `/global/event` returned a stable stream with `server.connected` → `session.created` → `server.heartbeat`, locking in the workaround.

---

### Resolved: OpenCode 2.x migration (1.0.0) {#resolved-opencode-2x-migration}

**Problem:** OpenCode 2.x replaced the whole server API, so every task failed on a 2.x install.

**Fix:** The sidecar now speaks the 2.x API, and Cowork-Z 1.0.0 supports OpenCode 2.x only; a 1.x install is rejected at startup with an upgrade hint. The IPC protocol keeps its shape. The resolved issues above were fixed against 1.x, and the routes and events they name no longer exist on 2.x, so read them as history. For the v1 → v2 contract map and the spike findings, see [OpenCode v2 Migration](../plan_opencode-v2-migration.md).
