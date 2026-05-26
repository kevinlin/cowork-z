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

The sidecar communicates with the OpenCode server via HTTP REST and Server-Sent Events.

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/global/event` | GET | SSE event stream for real-time updates (workspace-agnostic; client filters by `directory`) |
| `/session/{id}/message` | POST | Send a message to an active session |
| `/permission/{id}/reply` | POST | Reply to a permission request |
| `/question/{id}/reply` | POST | Reply to an agent question |
| `/config` | PATCH | Update provider config, MCP servers |

### SSE Event Shapes

`/global/event` delivers every frame inside a `GlobalEvent` envelope:

```json
{ "directory": "<workspace path>", "project": "global", "payload": { "id": "...", "type": "...", "properties": { ... } } }
```

Server-only frames (`server.connected`, `server.heartbeat`, `server.instance.disposed`) omit `directory`/`project`. The sidecar's `EventStream` unwraps `payload` and drops frames whose `directory` doesn't match the current workspace — server-only frames always pass through.

| Payload type | Properties |
|--------------|------------|
| `session.status` | `{ sessionID: string, status: SessionStatus }` |
| `message.updated` | `{ info: MessageInfo }` |
| `message.part.updated` | `sessionID` and `messageID` nested inside `part` |
| `server.heartbeat` | Keepalive every 10 s |
| `server.instance.disposed` | Per-instance bus shutdown (informational only on `/global/event`; does NOT close the stream) |

**Why `/global/event` rather than `/event`:** OpenCode 1.14.x binds the per-instance `/event` endpoint to the per-request Effect scope, so the wildcard PubSub publishes `server.instance.disposed` and shuts down as soon as the HTTP request's instance scope finalizes — closing the stream after the first event. `/global/event` is backed by a long-lived Node `EventEmitter` (`GlobalBus`) and survives instance churn, `PATCH /config`, and workspace switches. See [Resolved: SSE Stream Closes Immediately on OpenCode 1.14.x](#resolved-sse-stream-closes-immediately).

---

## System Prompt Injection

The system prompt is injected via the `system` field on each `POST /session/{id}/message` call, bypassing agent resolution entirely. This approach was adopted because OpenCode 1.1.48 ignores custom agent names set via `PATCH /config` — the `default_agent` field falls back to the built-in `build` agent regardless of the custom agent configuration (see [Resolved Issue: System Prompt Not Applied](#resolved-system-prompt-not-applied)).

**Sequence:**

1. Rust sends `start_task(prompt, ...)` to sidecar
2. Sidecar sends `PATCH /config` (model, permission, enabled_providers — no agent/default_agent)
3. Sidecar sends `POST /session` (create)
4. Sidecar sends `POST /session/{id}/message` with `parts` + `system=SYSTEM_PROMPT`

The system prompt includes:
- Server port and password (so the agent can call the OpenCode server API directly)
- **Workspace conventions** (always emitted): the current workspace path, an auto-create `mkdir -p` first action for the four convention folders (`Input/`, `Output/`, `Misc/`, `Artefacts/`), and the soft rules covering read-only folders, category-subfolder layout under `Output/`, and the `Artefacts/` promotion workflow. See [Workspace Conventions in System Prompt](#workspace-conventions-in-system-prompt).
- User custom prompt (when enabled, wrapped in `<user-instructions>` XML block)

### Workspace Conventions in System Prompt

`buildSystemPrompt` requires `workspaceDir: string` as a mandatory parameter — the signature order is `(serverPort, serverPassword, workspaceDir, customPrompt?)`. Callers in `session-manager.ts` pass `workingDirectory ?? ''` (the payload type marks `workingDirectory` optional, but in practice every task runs inside a workspace).

The injected `<workspace-conventions>` block:
1. **Declares the current workspace path** so the agent can resolve relative references.
2. **Instructs the agent to auto-create any missing convention folders as its first action** — a single idempotent `mkdir -p "<ws>/Input" "<ws>/Output" "<ws>/Misc" "<ws>/Artefacts"` (PowerShell `New-Item -ItemType Directory -Force ...` on Windows). `mkdir -p` is safe on existing folders, and it is the *only* path the agent has to create `Input/` and `Misc/` because the `write`/`edit` tools are blocked by the `edit: deny` rules on those folders. Bash is not gated by the `edit` permission, so this works even when the folders are missing.
3. **Documents all four convention folders** with one-line role + permission summaries so the agent doesn't have to guess: `Input/` (read-only source material, `edit: deny`), `Output/` (scratchpad with category subfolders, `edit: allow`), `Misc/` (read-only static assets — icons, logos, images, fonts — `edit: deny`), and `Artefacts/` (curated deliverables, `edit: ask` — the user is prompted before every write). The hard rules are emitted by `buildSessionConfig` (see [Folder Permission Model](#folder-permission-model)).
4. **Forces new-file creation under a category subfolder of `<workspace>/Output/`** — every write/edit tool call and every file-creating bash command (`touch`, `>`, `tee`, `mkdir`, `cp`, `mv`, etc.) must target a path inside a subfolder of `Output/`, never directly in `Output/` root. The agent picks the subfolder name based on the file's nature, with these common categories suggested in the prompt: `executable/` (scripts), `product/` (PRDs, user stories), `ux-prototype/` (mockups, HTML prototypes), `engineering/` (design docs, ADRs), `testing/` (test cases, scripts), `research/` (notes, summaries), `data/` (datasets, exports). The agent is instructed to **reuse existing subfolders first** before creating new ones, so artefacts stay grouped consistently across follow-up tasks in the same workspace.
5. **Describes the `Artefacts/` promotion workflow** — when the user asks to "promote", "publish", "save as artefact", or "finalize" a file, the agent copies or moves the file from `Output/<category>/...` into `Artefacts/<category>/...`. `Artefacts/` mirrors the same category-subfolder layout so promoted files keep their classification. Because `Artefacts/` is `edit: ask`, OpenCode prompts the user before each write — the agent never writes into `Artefacts/` proactively or silently.

This is soft-enforced via the prompt only — the hard rules on `Input/`, `Output/`, `Misc/`, and `Artefacts/` already cover the file-write side, so the categorized convention requires no additional permission-rule changes.

This removes the prior conditional branch that skipped the block when `workspaceDir` was undefined — the section is now always rendered.

### User Prompt Customization

> **Plan:** [User Prompt Customization](plan_user-prompt-customization.md)

Users configure a custom system prompt via a Settings toggle and textarea. When enabled, the custom prompt is appended to the agent's system prompt in a `<user-instructions>` XML block, delivered via the `system` field on each `sendMessage` call. Persisted to SQLite (`app_settings` table) and applied on every `startTask` and `resumeSession` call through the sidecar IPC protocol.

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

- **Convention-based defaults:** Workspace exposes four convention folders with hard edit rules emitted by `buildSessionConfig`: `Input/` (read-only source material, `edit: deny`), `Output/` (scratchpad with category subfolders, `edit: allow`), `Misc/` (read-only static assets, `edit: deny`), `Artefacts/` (curated deliverables typically promoted from `Output/`, `edit: ask` so the user approves each save). Workspace root allows read/list for everything; the four folders are auto-created on workspace entry by an agent-issued `mkdir -p` (see [Workspace Conventions in System Prompt](#workspace-conventions-in-system-prompt))
- **Workspace-scoped persistence:** Permissions are stored in the `workspace_permissions` table (replaced task-scoped `folder_permissions`). Adhoc approvals carry across all tasks in the same workspace.
- **Bash soft enforcement:** System prompt instructs the agent not to modify `Input/` via bash commands. Hard enforcement is via `edit: deny` permission rules in the OpenCode config.
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

**Question reply format:** The OpenCode server's `POST /question/{id}/reply` expects `answers` as `string[][]` (array of arrays). The sidecar transforms the `{labels, customText}` objects from Rust into flat arrays before calling the API. When `customText` is provided, it's appended to the labels array.

**Multi-select questions:** The OpenCode server sends `multiple: true` on question objects. The sidecar normalizes this to `multiSelect: boolean` for the frontend. The QuestionDialog renders checkbox indicators and count badges when multi-select is enabled.

**Always-on free-text fallback:** The frontend `QuestionDialog` injects a synthetic `Others` option (description "Type your own response") whenever the agent's `options` array contains at least one entry but no case-insensitive `Other`/`Others` variant. Selecting it surfaces a free-text input whose contents become the answer's `customText`; in multi-select mode the input is rendered inline so it can coexist with checkbox selections. The existing `replyToQuestion` flattening (`labels` + `customText` → `string[]`) means OpenCode receives the typed text without any protocol change. When the agent supplies no options at all, the dialog continues to render the free-text-only path instead of injecting the synthetic option.

**Permission replies:** Both `replyToPermission` and `replyToQuestion` extract the session's `directory` and pass it to the OpenCode API to ensure correct routing.

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

MCP (Model Context Protocol) server configuration allows users to extend the agent with additional tools via local commands or remote URLs. Configurations are managed in the Settings UI, persisted to the database, and sent to the OpenCode server via `PATCH /config`. Supports both local (command-based) and remote (URL-based) MCP servers with per-server enable/disable toggles.

### Tool Listing API Limitation

The OpenCode server's tool endpoints do not include MCP server tools — they return only built-in tools (bash, read, glob, grep, etc.). This was confirmed through runtime investigation across multiple API approaches:

- `GET /experimental/tool/ids` — returns built-in tool IDs only
- `GET /experimental/tool?provider=X&model=Y` — returns built-in tools only, even with valid connected providers
- `GET /mcp` — returns per-server connection status but no tool names or counts
- `mcp.tools.changed` SSE event — does not fire during normal MCP server initialization

The frontend's `groupToolsByServer` utility (`useMcpRuntime.ts`) is implemented and tested, ready to parse `{serverName}_{toolName}` prefixed IDs when the upstream API begins including them. Until then, the `McpServerCard` displays connection status as the primary indicator of server health.

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
