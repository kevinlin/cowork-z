---
date: 2026-02-05T17:30:00-08:00
researcher: Claude
git_commit: 78adce3c2e574a825205fe53bbdc2affc9a156e4
branch: main
repository: kevinlin/open-cowork
topic: "Tauri-Sidecar-OpenCode Integration with MCP Servers"
tags: [research, codebase, tauri, sidecar, opencode, mcp, integration]
status: complete
last_updated: 2026-02-05
last_updated_by: Claude
---

# Research: Tauri-Sidecar-OpenCode Integration with MCP Servers

**Date**: 2026-02-05T17:30:00-08:00
**Researcher**: Claude
**Git Commit**: 78adce3c2e574a825205fe53bbdc2affc9a156e4
**Branch**: main
**Repository**: kevinlin/open-cowork

## Research Question

Document the current integration between the Tauri app (`src-tauri/src/`) and Sidecar process (`src-tauri/sidecar/`) which spawns OpenCode processes via `opencode run`. Pay attention to the bundled MCP servers and how they are intended to support interaction between the OpenCode process and the Tauri app.

## Summary

The Cowork-Z application uses a multi-process architecture where:
1. **Tauri App (Rust)** manages the frontend and spawns a sidecar process
2. **Sidecar (Node.js)** manages OpenCode CLI processes via PTY
3. **OpenCode CLI** executes AI agent tasks with MCP server support

Four MCP servers are bundled with the application:
- `file-permission` - Requests user permission for file operations
- `ask-user-question` - Enables the agent to ask users questions
- `complete-task` - Signals task completion status
- `dev-browser-mcp` - Browser automation tools

The `file-permission` and `ask-user-question` MCP servers are designed to communicate with the host application via HTTP endpoints. However, these HTTP endpoints are not implemented in the Tauri app, which causes these MCP servers to fail when attempting to communicate with the desktop application.

## Detailed Findings

### 1. Tauri Backend Architecture

The Rust backend is located in `src-tauri/src/` and consists of:

#### sidecar.rs ([src-tauri/src/sidecar.rs](src-tauri/src/sidecar.rs))

- **SidecarManager** (line 166-384): Manages the Node.js sidecar process lifecycle
  - Spawns sidecar via `tauri-plugin-shell` using `shell.sidecar("cowork-sidecar")`
  - Communicates via stdin/stdout using JSON-line protocol
  - Handles events: `ready`, `task_started`, `task_message`, `task_progress`, `permission_request`, `task_complete`, `task_error`

- **SidecarCommand enum** (line 49-75): Commands sent to sidecar
  - `StartTask`: Initiates a new task with prompt, API keys, model ID, folders
  - `CancelTask`: Hard kills a running task
  - `InterruptTask`: Sends Ctrl+C to gracefully stop
  - `SendResponse`: Responds to permission/question requests
  - `Ping`: Health check
  - `CheckCli`: Verifies OpenCode CLI availability

- **SidecarEvent struct** (line 102-111): Events received from sidecar
  - `event_type`: Type of event (task_message, task_progress, etc.)
  - `task_id`: Associated task identifier
  - `payload`: Event-specific JSON data

#### lib.rs ([src-tauri/src/lib.rs](src-tauri/src/lib.rs))

- **start_task** (line 302-409): Main task execution entry point
  - Resolves model ID from provider settings
  - Creates task record in SQLite database
  - Retrieves API keys from secure storage
  - Spawns sidecar if not running
  - Sends `StartTask` command to sidecar

- **respond_to_permission** (line 634-660): Handles permission responses
  - Retrieves folders from task database
  - Sends `SendResponse` command to sidecar with "yes"/"no"

### 2. Sidecar Architecture

The Node.js sidecar is located in `src-tauri/sidecar/src/`:

#### index.ts ([src-tauri/sidecar/src/index.ts](src-tauri/sidecar/src/index.ts))

- **IPC Protocol** (line 1-26): JSON-line messages over stdin/stdout
  - Input: `start_task`, `cancel_task`, `interrupt_task`, `send_response`, `ping`, `check_cli`
  - Output: `task_started`, `task_message`, `task_message_partial`, `task_message_complete`, `task_progress`, `permission_request`, `task_complete`, `task_error`, `log`

- **Message Handling** (line 51-107): Routes incoming commands to TaskManager

#### task-manager.ts ([src-tauri/sidecar/src/task-manager.ts](src-tauri/sidecar/src/task-manager.ts))

- **TaskManager class** (line 40-259): Manages concurrent OpenCode CLI executions
  - Creates one `OpenCodeAdapter` instance per task
  - Maximum 10 concurrent tasks (default)
  - Wires up event listeners for messages, progress, permissions, completion

#### adapter.ts ([src-tauri/sidecar/src/adapter.ts](src-tauri/sidecar/src/adapter.ts))

- **OpenCodeAdapter class** (line 49-843): Core adapter for OpenCode CLI
  - Spawns OpenCode CLI via PTY (`node-pty`)
  - Command: `opencode run <prompt> --format json --agent accomplish`
  - Handles streaming messages with throttled partial updates
  - Parses NDJSON output via StreamParser

- **startTask** (line 77-268): Task initialization
  - Generates OpenCode config file
  - Sets environment variables with API keys
  - Sets `OPENCODE_CONFIG_CONTENT` for folder permissions
  - Spawns PTY process with shell wrapper

- **Message Handling** (line 565-672): Processes OpenCode CLI output
  - `step_start`: Captures session ID
  - `text`: Accumulates text chunks for streaming
  - `tool_call`/`tool_use`: Emits tool usage events
  - `step_finish`: Finalizes message accumulators
  - Handles `AskUserQuestion` tool specially for permission requests

#### config-generator.ts ([src-tauri/sidecar/src/config-generator.ts](src-tauri/sidecar/src/config-generator.ts))

- **generateOpenCodeConfig** (line 312-415): Creates OpenCode configuration
  - Writes config to `~/Library/Application Support/cowork-z/opencode/opencode.json`
  - Defines the "accomplish" agent with custom system prompt
  - Configures MCP servers with paths and environment variables

- **MCP Server Configuration** (line 341-392):
  ```typescript
  // File permission MCP server
  mcpConfig['file-permission'] = {
    type: 'local',
    command: ['npx', 'tsx', filePermissionPath],
    enabled: true,
    environment: {
      PERMISSION_API_PORT: String(options.permissionApiPort || 3100),
    },
    timeout: 10_000,
  };

  // Ask user question MCP server
  mcpConfig['ask-user-question'] = {
    type: 'local',
    command: ['npx', 'tsx', askUserQuestionPath],
    enabled: true,
    environment: {
      QUESTION_API_PORT: String(options.questionApiPort || 3101),
    },
    timeout: 10_000,
  };
  ```

#### stream-parser.ts ([src-tauri/sidecar/src/stream-parser.ts](src-tauri/sidecar/src/stream-parser.ts))

- **StreamParser class** (line 18-180): Parses NDJSON from OpenCode CLI
  - Handles Windows PTY buffering issues where JSON lines may be fragmented
  - Maximum buffer size: 10MB
  - Filters terminal UI decorations (box-drawing characters)

### 3. MCP Servers

The MCP servers are bundled in the `skills/` directory:

#### file-permission/src/index.ts ([skills/file-permission/src/index.ts](skills/file-permission/src/index.ts))

- **Purpose**: Request user permission before file operations
- **Tool**: `request_file_permission`
- **Operations**: create, delete, rename, move, modify, overwrite
- **Communication**: HTTP POST to `http://localhost:${PERMISSION_API_PORT}/permission` (default port 9226, configured to 3100)

```typescript
const PERMISSION_API_PORT = process.env.PERMISSION_API_PORT || '9226';
const PERMISSION_API_URL = `http://localhost:${PERMISSION_API_PORT}/permission`;
// ...
const response = await fetch(PERMISSION_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation, filePath, ... }),
});
```

#### ask-user-question/src/index.ts ([skills/ask-user-question/src/index.ts](skills/ask-user-question/src/index.ts))

- **Purpose**: Ask users questions via UI modals
- **Tool**: `AskUserQuestion`
- **Input**: questions array with options, multi-select support
- **Communication**: HTTP POST to `http://localhost:${QUESTION_API_PORT}/question` (default port 9227, configured to 3101)

```typescript
const QUESTION_API_PORT = process.env.QUESTION_API_PORT || '9227';
const QUESTION_API_URL = `http://localhost:${QUESTION_API_PORT}/question`;
// ...
const response = await fetch(QUESTION_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question, header, options, multiSelect }),
});
```

#### complete-task/src/index.ts ([skills/complete-task/src/index.ts](skills/complete-task/src/index.ts))

- **Purpose**: Signal task completion status
- **Tool**: `complete_task`
- **Statuses**: success, blocked, partial
- **Communication**: None (logs to stderr and returns response)

#### dev-browser-mcp/src/index.ts ([skills/dev-browser-mcp/src/index.ts](skills/dev-browser-mcp/src/index.ts))

- **Purpose**: Browser automation tools
- **Tools**: browser_navigate, browser_snapshot, browser_click, browser_type, browser_screenshot, browser_sequence
- **Communication**: Direct Playwright browser control

### 4. Communication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│   Tauri Desktop App                                              │
│   ┌──────────────┐  ┌──────────────────────────────────────────┐│
│   │   React UI   │  │  Rust Backend (lib.rs)                    ││
│   │  (WebView)   │←→│  - 60+ Tauri commands                     ││
│   │              │  │  - SQLite database (rusqlite)             ││
│   │              │  │  - OS Keychain (keyring)                  ││
│   │              │  │  - SidecarManager (sidecar.rs)            ││
│   └──────────────┘  └──────────────────────────────────────────┘│
│          ↑                         │                             │
│          │ Tauri IPC               │ stdin/stdout (JSON-line)   │
│          │ (events)                ↓                             │
└──────────┼─────────────────────────┼────────────────────────────┘
           │                         │
           │                         ↓
           │    ┌────────────────────────────────────────────────┐
           │    │  Node.js Sidecar Process (src-tauri/sidecar/)   │
           │    │  ├── index.ts        # IPC entry point          │
           │    │  ├── task-manager.ts # Multi-task management    │
           │    │  ├── adapter.ts      # OpenCode CLI adapter     │
           │    │  ├── stream-parser.ts# NDJSON parsing           │
           │    │  └── config-generator.ts # OpenCode config      │
           │    └────────────────────────────────────────────────┘
           │                         │ PTY (node-pty)
           │                         ↓
           │    ┌────────────────────────────────────────────────┐
           │    │  OpenCode CLI                                   │
           │    │  opencode run --format json --agent accomplish  │
           │    └────────────────────────────────────────────────┘
           │                         │ stdio (MCP protocol)
           │                         ↓
           │    ┌────────────────────────────────────────────────┐
           │    │  MCP Servers (skills/)                          │
           │    │  ├── file-permission    → HTTP :3100/permission │
           │    │  ├── ask-user-question  → HTTP :3101/question   │
           │    │  ├── complete-task      → (logs only)           │
           │    │  └── dev-browser-mcp    → Playwright            │
           │    └────────────────────────────────────────────────┘
           │                         │
           │                         ↓ HTTP requests (MISSING!)
           │    ┌────────────────────────────────────────────────┐
           │    │  HTTP Endpoints (NOT IMPLEMENTED)               │
           │    │  - localhost:3100/permission                    │
           │    │  - localhost:3101/question                      │
           └────┤  Should connect back to Tauri/Frontend          │
                └────────────────────────────────────────────────┘
```

### 5. MCP Server Issue: Missing HTTP Endpoints

The `file-permission` and `ask-user-question` MCP servers expect to communicate with the host application via HTTP endpoints:

- `http://localhost:3100/permission` for file permission requests
- `http://localhost:3101/question` for user questions

**Current State:**
- No HTTP server is implemented in the Tauri app (`src-tauri/src/`)
- No HTTP server is implemented in the Sidecar (`src-tauri/sidecar/`)
- The MCP servers' HTTP requests fail with connection errors

**Design Origin:**
- The MCP servers have comments referencing "Electron main process via HTTP"
- This suggests the system was originally designed for Electron, which can easily host HTTP servers
- During migration to Tauri, the HTTP server component was not implemented

**Current Workaround:**
- The adapter handles `AskUserQuestion` tool calls specially in `handleAskUserQuestion()` (adapter.ts:674-695)
- It emits a `permission-request` event that the sidecar forwards to Tauri
- However, this bypass only works for the `AskUserQuestion` tool detection, not the actual MCP server HTTP communication

### 6. Tauri Configuration

#### tauri.conf.json ([src-tauri/tauri.conf.json](src-tauri/tauri.conf.json))

```json
{
  "bundle": {
    "externalBin": ["binaries/cowork-sidecar"],
    "resources": ["../skills/"]
  }
}
```

- Bundles the sidecar binary
- Bundles the skills directory containing MCP servers

#### capabilities/default.json ([src-tauri/capabilities/default.json](src-tauri/capabilities/default.json))

```json
{
  "permissions": [
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-kill",
    "shell:allow-open",
    "dialog:default",
    "dialog:allow-open"
  ]
}
```

- Allows spawning sidecar processes
- Allows stdin communication with sidecar
- No permissions for hosting HTTP servers

## Code References

- `src-tauri/src/sidecar.rs:166-384` - SidecarManager implementation
- `src-tauri/src/sidecar.rs:49-75` - SidecarCommand enum
- `src-tauri/src/lib.rs:302-409` - start_task command
- `src-tauri/src/lib.rs:634-660` - respond_to_permission command
- `src-tauri/sidecar/src/index.ts:1-264` - Sidecar IPC entry point
- `src-tauri/sidecar/src/task-manager.ts:40-259` - TaskManager class
- `src-tauri/sidecar/src/adapter.ts:49-843` - OpenCodeAdapter class
- `src-tauri/sidecar/src/adapter.ts:77-268` - startTask method
- `src-tauri/sidecar/src/adapter.ts:565-672` - Message handling
- `src-tauri/sidecar/src/adapter.ts:674-695` - AskUserQuestion handling
- `src-tauri/sidecar/src/config-generator.ts:312-415` - generateOpenCodeConfig
- `src-tauri/sidecar/src/config-generator.ts:341-392` - MCP server configuration
- `src-tauri/sidecar/src/stream-parser.ts:18-180` - StreamParser class
- `skills/file-permission/src/index.ts:1-139` - File permission MCP server
- `skills/ask-user-question/src/index.ts:1-197` - Ask user question MCP server
- `skills/complete-task/src/index.ts:1-120` - Complete task MCP server

## Architecture Documentation

### IPC Protocol (Tauri ↔ Sidecar)

**Commands (Tauri → Sidecar via stdin):**
```json
{"type":"start_task","taskId":"task_123","payload":{...}}
{"type":"cancel_task","taskId":"task_123"}
{"type":"interrupt_task","taskId":"task_123"}
{"type":"send_response","taskId":"task_123","payload":{"response":"yes","folders":[...]}}
{"type":"ping"}
{"type":"check_cli"}
```

**Events (Sidecar → Tauri via stdout):**
```json
{"type":"ready","payload":{"version":"0.1.0","cliAvailable":true,"cliVersion":"1.0.0"}}
{"type":"task_started","taskId":"task_123","payload":{"taskId":"task_123"}}
{"type":"task_message","taskId":"task_123","payload":{"message":{...}}}
{"type":"task_message_partial","taskId":"task_123","payload":{"messageId":"...","textSoFar":"...","isStreaming":true}}
{"type":"task_message_complete","taskId":"task_123","payload":{"messageId":"...","text":"..."}}
{"type":"task_progress","taskId":"task_123","payload":{"progress":{"stage":"executing"}}}
{"type":"permission_request","taskId":"task_123","payload":{"request":{...}}}
{"type":"task_complete","taskId":"task_123","payload":{"result":{"status":"success"}}}
{"type":"task_error","taskId":"task_123","payload":{"error":"..."}}
{"type":"log","payload":{"level":"info","message":"..."}}
```

### Environment Variables

The adapter sets the following environment variables for OpenCode CLI:
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. - API keys for providers
- `OPENCODE_CONFIG` - Path to generated config file
- `OPENCODE_CONFIG_DIR` - Directory for OpenCode config
- `OPENCODE_CONFIG_CONTENT` - JSON with folder permissions (when folders provided)

### MCP Server Environment Variables

- `PERMISSION_API_PORT` - Port for file permission HTTP API (default 3100)
- `QUESTION_API_PORT` - Port for question HTTP API (default 3101)

## Historical Context

The MCP servers' comments reference "Electron main process via HTTP", indicating the application was migrated from Electron to Tauri. The HTTP server functionality that existed in Electron was not ported to the Tauri architecture.

## Related Research

No previous research documents found in `thoughts/shared/research/` related to this topic.

## Open Questions

1. **HTTP Server Implementation**: Where should the HTTP endpoints be hosted?
   - Option A: In the Tauri Rust backend (requires `actix-web`, `axum`, or similar)
   - Option B: In the Node.js sidecar (requires `express` or similar)
   - Option C: Replace HTTP with stdio-based MCP communication

2. **MCP Protocol Evolution**: Could the MCP servers be modified to use a different communication mechanism that aligns better with Tauri's architecture?

3. **Permission Flow Verification**: The current adapter has special handling for `AskUserQuestion` in adapter.ts, but does this actually work end-to-end?
