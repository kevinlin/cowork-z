# Sidecar Rewrite: From PTY-Based to OpenCode Server API

## Overview

This plan details a complete rewrite of the sidecar application from the current PTY-based `opencode run` approach to using the `opencode serve` HTTP API. The new sidecar (`sidecar-opencode`) will communicate with OpenCode via REST endpoints and Server-Sent Events (SSE), eliminating the complexity of NDJSON parsing and enabling native permission/question handling.

## Current State Analysis

### Current Architecture
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ PTY (NDJSON) ↔ opencode run
                                           ↓
                                  Bundled MCP Servers
                                  (file-permission, ask-user-question)
                                           ↓
                                  HTTP to localhost:3100/3101
                                  (ENDPOINTS NOT IMPLEMENTED!)
```

### Problems with Current Approach
1. **Complex NDJSON parsing** - Windows PTY fragmentation issues, ANSI escape stripping
2. **Bundled MCP servers broken** - HTTP endpoints for permission/question don't exist in Tauri
3. **Workaround for permissions** - `AskUserQuestion` tool detection in stream (fragile)
4. **Heavy config file generation** - Creates `opencode.json` for each task

### Key Discoveries
- **Current sidecar files**: [src-tauri/sidecar/src/](src-tauri/sidecar/src/) - 8 TypeScript files + tests
- **Bundled MCP servers**: [skills/](skills/) - 8 packages, most expect HTTP endpoints that don't exist
- **Rust manager**: [src-tauri/src/sidecar.rs](src-tauri/src/sidecar.rs) - `SidecarManager` spawns and communicates with Node.js sidecar
- **Custom agent**: "accomplish" agent with system prompt in [config-generator.ts:32-203](src-tauri/sidecar/src/config-generator.ts#L32-L203)

## Desired End State

### New Architecture
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
                                           ↓
                                  - GET /event (SSE stream)
                                  - POST /session/{id}/message
                                  - POST /permission/{id}/reply
                                  - POST /question/{id}/reply
                                  - PATCH /config
```

### Key Benefits
1. **Clean HTTP/JSON protocol** - No NDJSON parsing, no ANSI stripping
2. **Native permission/question handling** - OpenCode's `/permission` and `/question` endpoints
3. **Runtime config updates** - `PATCH /config` for session-specific settings
4. **Proper server lifecycle** - Health checks, graceful shutdown, process management
5. **Comprehensive logging** - All server events logged to `~/.local/share/opencode/log` files

### Verification Criteria
- [ ] `opencode serve` process starts on port 4096 (configurable)
- [ ] Sessions can be created, resumed, and aborted
- [ ] Messages stream correctly via SSE events
- [ ] Permission requests show in UI and responses work
- [ ] Question requests show in UI and responses work
- [ ] All events logged to timestamped log files
- [ ] Old sidecar and skills folders deleted

## What We're NOT Doing

1. **Browser automation MCP** - `dev-browser-mcp` is out of scope; can be added later via PATCH /config
2. **Multiple concurrent servers** - Single `opencode serve` instance per app
3. **Custom agent migration** - The "accomplish" agent prompt moves to PATCH /config, not a separate config file
4. **Backward compatibility layer** - Clean break from old sidecar

## Implementation Approach

The rewrite follows a layered approach:
1. Build the new sidecar as a separate package (`sidecar-opencode`)
2. Implement HTTP client and SSE handling
3. Add process management for `opencode serve`
4. Update Rust backend to use new IPC protocol
5. Remove old sidecar and bundled MCPs

---

## Phase 1: Foundation - Create sidecar-opencode Package

### Overview
Create the new TypeScript package with HTTP client, SSE handling, and IPC protocol definitions.

### Changes Required

#### 1. New Package Structure
**Directory**: `src-tauri/sidecar-opencode/`

```
src-tauri/sidecar-opencode/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # IPC entry point (stdin/stdout JSON-line)
│   ├── types.ts              # TypeScript types for OpenCode API + IPC
│   ├── opencode-client.ts    # HTTP client for OpenCode server
│   ├── event-stream.ts       # SSE event stream handler
│   ├── session-manager.ts    # Session lifecycle management
│   ├── config-builder.ts     # Runtime config generation for PATCH /config
│   ├── process-manager.ts    # Spawn/manage opencode serve process
│   └── logger.ts             # File logging to ~/.local/share/opencode/log/
└── __tests__/
    ├── opencode-client.test.ts
    └── session-manager.test.ts
```

#### 2. Package Configuration
**File**: `src-tauri/sidecar-opencode/package.json`
> **Important**: Do NOT use `"type": "module"` (ESM). The `pkg` bundler has limited ESM support and will fail with `Cannot find module '/snapshot/dist/index.js'` errors. Use CommonJS instead.

**File**: `src-tauri/sidecar-opencode/tsconfig.json`
> **Important**: Use `"module": "CommonJS"` for `pkg` compatibility. ESM modules (`NodeNext`) will cause the bundled binary to fail.

**File**: `src-tauri/sidecar-opencode/jest.config.cjs`
> **Note on imports**: When using CommonJS, do NOT include `.js` extensions in TypeScript imports. Use `import { foo } from './bar'` instead of `import { foo } from './bar.js'`.

#### 3. TypeScript Types
**File**: `src-tauri/sidecar-opencode/src/types.ts`

#### 4. Logger Module
**File**: `src-tauri/sidecar-opencode/src/logger.ts`

### Success Criteria

#### Automated Verification:
- [x] Package builds without errors: `cd src-tauri/sidecar-opencode && pnpm build`
- [x] TypeScript compilation passes: `pnpm typecheck`
- [x] Package.json has correct dependencies and scripts

#### Manual Verification:
- [x] Directory structure matches specification
- [x] Types accurately reflect OpenCode API spec

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 2: OpenCode HTTP Client & Process Management

### Overview
Implement the HTTP client for OpenCode server API and process management for spawning/terminating `opencode serve`.

### Changes Required

#### 1. OpenCode HTTP Client
**File**: `src-tauri/sidecar-opencode/src/opencode-client.ts`

#### 2. Process Manager
**File**: `src-tauri/sidecar-opencode/src/process-manager.ts`
> **Fix applied during Phase 4 testing**: Added `cwd: OPENCODE_DATA_DIR` (`~/.local/share/opencode/log`) to the `spawn()` call. Without an explicit `cwd`, `opencode serve` inherits the sidecar's working directory (typically `src-tauri/`). When config is pushed via `PATCH /config`, OpenCode persists `config.json` into its CWD — writing `src-tauri/config.json` triggers Tauri's file watcher and causes unnecessary app rebuilds. Setting the CWD to the OpenCode data directory keeps generated files out of the source tree.

#### 3. Update Tauri Configuration
**File**: `src-tauri/tauri.conf.json`
Update the build commands and external binary reference to use the new sidecar-opencode:

#### 4. Update Rust Sidecar Manager
**File**: `src-tauri/src/sidecar.rs`
Update the binary candidate names and sidecar reference:

### Success Criteria

#### Automated Verification:
- [x] HTTP client compiles: `pnpm build`
- [x] Unit tests pass: `pnpm test`
- [x] Rust compiles with new sidecar reference: `cd src-tauri && cargo check`

#### Manual Verification:
- [x] Can detect running OpenCode server via health endpoint
- [x] Can terminate existing server via dispose endpoint
- [x] Can start new `opencode serve` process
- [x] Server stdout/stderr logged correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 3: SSE Event Stream & Session Management

### Overview
Implement Server-Sent Events handling for real-time updates and session lifecycle management.

### Changes Required

#### 1. Event Stream Handler
**File**: `src-tauri/sidecar-opencode/src/event-stream.ts`
> **Fix applied during Phase 4 testing**: Changed `this.emit('error', error)` to `this.emit('stream-error', error)`. In Node.js, `EventEmitter` treats `'error'` as a special event — if emitted with no listener attached, it throws `ERR_UNHANDLED_ERROR` and crashes the process. The SSE connection drops transiently (e.g. when `server.instance.disposed` fires), so this must be non-fatal.

> **Fix applied during Phase 4 manual testing**: Separated JSON parse errors from event handler errors in `onmessage`. Listener exceptions thrown during `this.emit(data.type, data.properties)` were caught by the same try/catch as JSON.parse, resulting in misleading "Failed to parse SSE event" logs when the actual issue was a listener crash. Now uses two separate try/catch blocks. Also fixed double-reconnection: the `eventsource` library auto-reconnects on connection drops (~1s), but the manual `setTimeout` reconnect (5s) would fire later and unnecessarily tear down the already-recovered connection. Now only manually reconnects when `readyState === EventSource.CLOSED` (permanent failure), letting EventSource handle transient drops.

> **Fix applied for OpenCode 1.14.x compatibility**: Switched the SSE endpoint from `/event` to `/global/event`. OpenCode 1.14.x rebuilt the bus on top of Effect `PubSub` + `InstanceState`, and the per-instance `/event` route's wildcard subscription is now bound to per-request Effect scope lifecycle — its finalizer publishes `server.instance.disposed` and shuts down the `PubSub` the moment `Instance.provide()`'s outer scope ends, which severs the stream after the single initial `server.connected` frame (verified with raw curl: server sends chunked-end `0\r\n\r\n` within 1 ms). `/global/event` is backed by `GlobalBus` (a long-lived Node.js `EventEmitter` decoupled from instance lifecycle) and stays open across instance churn, `PATCH /config`, and workspace switches. Frames are wrapped in `{ directory?, project?, payload }`; `EventStream` unwraps `payload` (preserving the existing `OpenCodeEvent` shape so all `SessionManager` listeners are unchanged) and filters events whose envelope `directory` doesn't match the current workspace. Server-only frames (`server.connected`, `server.heartbeat`, `server.instance.disposed`) have no `directory` and always pass through. See [Resolved: SSE Stream Closes Immediately on OpenCode 1.14.x](design_opencode-integration.md#resolved-sse-stream-closes-immediately) for the full diagnosis.

#### 2. Config Builder
**File**: `src-tauri/sidecar-opencode/src/config-builder.ts`

#### 3. Session Manager
**File**: `src-tauri/sidecar-opencode/src/session-manager.ts`
> **Fix applied during Phase 4 testing**: Removed `agent: 'accomplish'` from both `sendMessage` calls. OpenCode 1.1.48's `sendMessage` API fails to resolve custom agent names passed via the `agent` parameter — the internal agent lookup returns `undefined`, causing `TypeError: undefined is not an object (evaluating 'agent.name')` in `createUserMessage`. Since we already set `default_agent: 'accomplish'` via `PATCH /config`, the server uses the correct agent automatically without needing the explicit parameter.

> **Fix applied during Phase 4 manual testing**: Fixed three SSE event shape mismatches between the `OpenCodeEvent` types and the actual OpenCode 1.1.48 server payloads, which caused all message streaming and session completion detection to silently fail:
> 1. **`session.status`**: Server sends `{ sessionID: string, status: SessionStatus }` — the listener was accessing `props.session.id` (a non-existent `session` object), which threw `TypeError: Cannot read properties of undefined`. Fixed to use `props.sessionID`. This broke task completion detection (session idle → task complete).
> 2. **`message.updated`**: Server sends `{ info: MessageInfo }` — the listener expected `props.message` and `props.sessionID`. Fixed to use `props.info` (which contains `sessionID`, `id`, `role`, etc.). This broke `currentMessageId` tracking for message-complete events.
> 3. **`message.part.updated`**: Server nests `sessionID` and `messageID` inside the `part` object itself (`props.part.sessionID`, `props.part.messageID`) — the listener was reading them from the top level (`props.sessionID`, `props.messageID`), which returned `undefined` and caused every event to hit the `if (!taskId) return` guard. Fixed to read from `props.part`. This broke ALL streaming text forwarding to the frontend.
>
> Also added missing SSE event types to `OpenCodeEvent` union: `server.instance.disposed`, `server.heartbeat`, `session.diff`. Added `PartUpdate` and `MessageInfo` interfaces to model the actual server-side shapes.

### Success Criteria

#### Automated Verification:
- [x] All modules compile: `pnpm build`
- [x] Unit tests pass: `pnpm test`

#### Manual Verification:
- [x] SSE events received and parsed correctly
- [x] Session can be created and messages sent
- [x] Config pushed via PATCH /config before session start
- [x] Permission/question events forwarded correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 4: IPC Entry Point & Integration

### Overview
Implement the main entry point that handles Tauri ↔ Sidecar communication and wires everything together.

### Changes Required

#### 1. Main Entry Point
**File**: `src-tauri/sidecar-opencode/src/index.ts`

### Success Criteria

#### Automated Verification:
- [x] Full package builds: `cd src-tauri/sidecar-opencode && pnpm build`
- [x] Can create binary: `pnpm build:binary`
- [x] Unit tests pass: `pnpm test`

#### Manual Verification:
- [x] Sidecar starts and sends `ready` event
- [x] Can handle `start_task` command
- [x] Events stream correctly from server to Tauri
- [x] Permission/question replies work
- [x] Logs written to `~/.local/share/opencode/log/` directory

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 5: Update Rust Backend

### Overview
Modify the Rust sidecar manager to work with the new sidecar-opencode IPC protocol.

### Changes Required

#### 1. Update SidecarCommand Enum
**File**: `src-tauri/src/sidecar.rs`
Update the command enum to match new protocol:

#### 2. Update Event Handling
**File**: `src-tauri/src/sidecar.rs`
Add new event types:

#### 3. Update Tauri Commands
**File**: `src-tauri/src/lib.rs`
Add new commands for session management:

#### 4. Update tauri.conf.json
**File**: `src-tauri/tauri.conf.json`
Change the sidecar binary reference:

### Success Criteria

#### Automated Verification:
- [x] Rust compiles: `cd src-tauri && cargo check`
- [x] Rust tests pass: `cargo test`
- [x] Tauri builds: `pnpm tauri build`

#### Manual Verification:
- [x] Sidecar spawns correctly with new binary
- [x] Commands serialize correctly
- [x] Events deserialize and forward correctly
- [x] New Tauri commands work end-to-end

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 6: Frontend Integration

### Overview
Update frontend event listeners and API calls for the new protocol.

### Changes Required

#### 1. Update Tauri API Bridge
**File**: `src/lib/tauri-api.ts`
Add new functions:

#### 2. Update Permission Store/Handler
**File**: `src/stores/taskStore.ts` (or relevant component)
Update to handle the new permission/question protocol:

#### 3. Display Permission Patterns in Dialog
Pass `patterns` (e.g., requested directory paths) through to the permission dialog UI:
- **`src/shared/types/permission.ts`**: Added `patterns?: string[]` to `PermissionRequest` interface
- **`src/lib/tauri-api.ts`**: Included `patterns: payload.patterns` in the `onPermissionRequest` callback
- **`src/pages/Execution.tsx`**: Updated tool permission UI to display paths from `patterns` in a styled block, with human-readable permission names (underscores replaced with spaces), falling back to the existing tool input display when patterns are absent

### Success Criteria

#### Automated Verification:
- [x] Frontend compiles: `pnpm build`
- [x] TypeScript checks pass: `pnpm typecheck`
- [x] Frontend tests pass: `pnpm test --run`

#### Manual Verification:
- [x] Task execution works end-to-end
- [x] Streaming messages display correctly
- [x] Permission modals appear and responses work
- [x] Question modals appear and responses work

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 7: Cleanup - Remove Old Sidecar and MCPs

### Overview
Remove the old sidecar and bundled MCP servers now that the new implementation is complete.

### Changes Required

#### 1. Delete Old Sidecar Directory
```bash
rm -rf src-tauri/sidecar/
```

#### 2. Delete Bundled MCP Servers
```bash
rm -rf skills/
```

#### 3. Update Root package.json
**File**: `package.json`

Remove sidecar-related scripts if any, update workspace references.

#### 4. Update .gitignore
**File**: `.gitignore`

Remove any sidecar-specific ignores, add new ones if needed:
```
# Sidecar build artifacts
src-tauri/sidecar-opencode/dist/
src-tauri/binaries/sidecar-opencode-*
```

#### 5. Update Documentation
**File**: `CLAUDE.md`

Update the architecture section:
- Remove references to `src-tauri/sidecar/`
- Remove references to `skills/` directory
- Update the architecture diagram
- Update sidecar build commands to reference `sidecar-opencode`

#### 6. Clean Up Old Binaries
```bash
rm src-tauri/binaries/cowork-sidecar-*
```

### Success Criteria

#### Automated Verification:
- [x] Full build succeeds: `pnpm tauri build`
- [x] No references to old sidecar: `grep -r "cowork-sidecar" --include="*.json" --include="*.rs" --include="*.ts"`
- [x] No references to skills directory: `grep -r "skills/" --include="*.json" --include="*.rs" --include="*.ts"`

#### Manual Verification:
- [x] App launches and runs correctly
- [x] All task functionality works
- [x] No orphaned files or configurations

**Implementation Note**: This is the final phase. After verification, the migration is complete.

---

## Testing Strategy

### Unit Tests
- OpenCode HTTP client (mock HTTP responses)
- SSE event parsing
- Config builder
- Session manager (mock client and events)

### Integration Tests
- Sidecar IPC protocol (stdin/stdout)
- Full task lifecycle with mock OpenCode server

### Manual Testing Steps
1. Start app and verify sidecar spawns
2. Create a new task with a simple prompt
3. Verify streaming text appears in UI
4. Verify task completes successfully
5. Test permission request flow
6. Test question request flow
7. Test session resume
8. Test session abort
9. Check log files in `~/.local/share/opencode/log/`

## Performance Considerations

1. **SSE Reconnection** - Automatic reconnection with configurable interval
2. **Event Throttling** - Consider throttling partial message updates if too frequent
3. **Memory** - Clean up session data after completion
4. **Process Lifecycle** - Single `opencode serve` instance per app lifetime

## Migration Notes

- Old task history in SQLite remains compatible
- Session IDs from old runs cannot be resumed (different protocol)
- API keys continue to work (same secure storage)

## References

- Research document: [docs/specs/sidecar-opencode-rewrite/research_tauri-sidecar-mcp-integration.md](docs/specs/sidecar-opencode-rewrite/research_tauri-sidecar-mcp-integration.md)
- OpenCode API spec: [docs/specs/sidecar-opencode-rewrite/opencode-api.json](docs/specs/sidecar-opencode-rewrite/opencode-api.json)
- OpenCode server docs: https://opencode.ai/docs/server
- Current sidecar: [src-tauri/sidecar/](src-tauri/sidecar/)
