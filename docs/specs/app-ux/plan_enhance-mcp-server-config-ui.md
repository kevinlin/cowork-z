# Enhanced MCP Server Configuration UI

## Context

The current MCP Server settings UI is a raw JSON textarea where users paste a complete MCP config object. There is no per-server visibility, no runtime status, no tool listing, and no per-server enable/disable. The OpenCode server already exposes REST endpoints (`GET /mcp`, `POST /mcp/{name}/connect`, `GET /experimental/tool/ids`) and an SSE event (`mcp.tools.changed`) that provide exactly the runtime information needed -- but the app doesn't use them yet.

This plan transforms the MCP section in Settings into a card-based UI (inspired by Cursor's MCP management panel) where each server is a distinct item with status, tools, and controls.

## Data Flow

```
Frontend (React)
  useMcpRuntime hook ←—— Tauri events: mcp:status, mcp:tools, mcp:tools_changed
       ↕ invoke()
Rust commands (mcp.rs)
       ↕ SidecarCommand / SidecarEvent
Sidecar (index.ts → opencode-client.ts)
       ↕ HTTP
OpenCode Server: GET /mcp, GET /experimental/tool/ids, POST /mcp/{name}/connect|disconnect
```

## Component Hierarchy

```
SettingsDialog.tsx
  └── McpServersSettings.tsx (redesigned)
        ├── Header (title + "Add Server" button + view toggle + refresh)
        ├── McpServerCard.tsx × N  (one per configured server)
        │     ├── Status dot + label (connected/failed/disabled/needs_auth/initializing)
        │     ├── Server name + type badge (local/remote) + command/url subtitle
        │     ├── Enable/disable toggle
        │     ├── Expandable tool list (tool names as chips)
        │     └── Edit (pencil) / Delete (trash) icon buttons
        ├── McpAddServerDialog.tsx  (add or edit a single server)
        └── McpJsonFallback.tsx  (raw JSON textarea for power users)
```

---

## Implementation Steps

### Step 1 — Sidecar: OpenCode client methods

**File:** `src-tauri/sidecar-opencode/src/opencode-client.ts`

Add methods to the `OpenCodeClient` class, following the existing pattern (e.g. `getConfig`, `listSessions`):

```ts
// MCP Status & Control
async getMcpStatus(directory?: string): Promise<Record<string, { status: string; error?: string }>>
async connectMcpServer(name: string, directory?: string): Promise<boolean>
async disconnectMcpServer(name: string, directory?: string): Promise<void>

// Tool IDs
async getToolIds(directory?: string): Promise<string[]>
```

Endpoint mapping:
- `getMcpStatus` → `GET /mcp`
- `connectMcpServer` → `POST /mcp/{name}/connect`
- `disconnectMcpServer` → `POST /mcp/{name}/disconnect`
- `getToolIds` → `GET /experimental/tool/ids`

### Step 2 — Sidecar: IPC types

**File:** `src-tauri/sidecar-opencode/src/types.ts`

Add to `SidecarCommand` union:
```ts
| { type: 'get_mcp_status' }
| { type: 'get_mcp_tools' }
| { type: 'connect_mcp_server'; payload: { name: string } }
| { type: 'disconnect_mcp_server'; payload: { name: string } }
```

Add to `SidecarEvent` union:
```ts
| { type: 'mcp_status'; payload: { servers: Record<string, { status: string; error?: string }> } }
| { type: 'mcp_tools'; payload: { toolIds: string[] } }
| { type: 'mcp_tools_changed'; payload: { server: string } }
```

### Step 3 — Sidecar: IPC handlers + SSE forwarding

**File:** `src-tauri/sidecar-opencode/src/index.ts`

Add handler functions (`handleGetMcpStatus`, `handleGetMcpTools`, `handleConnectMcpServer`, `handleDisconnectMcpServer`) following the existing Copilot handler pattern (fire-and-forget with event response).

Add `mcp.tools.changed` SSE listener in the `initialize()` function after setting up `eventStream`:
```ts
eventStream.on('mcp.tools.changed', (props: { server: string }) => {
  send({ type: 'mcp_tools_changed', payload: { server: props.server } });
});
```

Add switch cases in `handleMessage()`.

### Step 4 — Sidecar: Tests

**File:** `src-tauri/sidecar-opencode/__tests__/opencode-client.test.ts`

Add tests for the new client methods with mocked fetch responses.

### Step 5 — Rust: Sidecar command variants + event forwarding

**File:** `src-tauri/src/sidecar.rs`

Add to `SidecarCommand` enum:
```rust
#[serde(rename = "get_mcp_status")]
GetMcpStatus,
#[serde(rename = "get_mcp_tools")]
GetMcpTools,
ConnectMcpServer { payload: ConnectMcpServerPayload },
DisconnectMcpServer { payload: DisconnectMcpServerPayload },
```

Add `ConnectMcpServerPayload` and `DisconnectMcpServerPayload` structs (just `{ name: String }`).

Add to `handle_sidecar_event` string match:
```rust
"mcp_status" => "mcp:status",
"mcp_tools" => "mcp:tools",
"mcp_tools_changed" => "mcp:tools_changed",
```

### Step 6 — Rust: Tauri commands

**File:** `src-tauri/src/commands/mcp.rs` (new)

Create a new command module with fire-and-forget commands that send to sidecar:
- `get_mcp_status` → sends `GetMcpStatus`
- `get_mcp_tools` → sends `GetMcpTools`
- `connect_mcp_server(name)` → sends `ConnectMcpServer`
- `disconnect_mcp_server(name)` → sends `DisconnectMcpServer`

**File:** `src-tauri/src/commands/mod.rs` — add `pub mod mcp;`
**File:** `src-tauri/src/lib.rs` — register commands in `invoke_handler`

### Step 7 — Frontend: Types

**File:** `src/shared/types/mcpSettings.ts`

Add:
```ts
export type McpServerStatus = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration' | 'initializing' | 'unknown';

export interface McpServerRuntime {
  status: McpServerStatus;
  error?: string;
  tools: string[];           // Tool IDs belonging to this server
}
```

### Step 8 — Frontend: API layer

**File:** `src/lib/tauri-api.ts`

Add invoke wrappers:
```ts
getMcpStatus(): Promise<void>
getMcpTools(): Promise<void>
connectMcpServer(name: string): Promise<void>
disconnectMcpServer(name: string): Promise<void>
```

Add event listeners:
```ts
onMcpStatus(cb): UnlistenFn
onMcpTools(cb): UnlistenFn
onMcpToolsChanged(cb): UnlistenFn
```

**File:** `src/lib/tauri-api-interface.ts` — extend `TauriAPI` interface with above.

### Step 9 — Frontend: `useMcpRuntime` hook

**File:** `src/hooks/useMcpRuntime.ts` (new)

Custom hook managing:
- `serverStatuses: Record<string, { status, error }>` — from `mcp:status` events
- `allToolIds: string[]` — from `mcp:tools` events
- `loading: boolean`
- `refresh()` — sends both `getMcpStatus` + `getMcpTools`

Tool-to-server grouping: MCP tool IDs follow `mcp_{serverName}_{toolName}` convention. Use the configured server name list as anchors for correct prefix parsing (handles server names with underscores).

Utility function (exported, testable independently):
```ts
export function groupToolsByServer(
  toolIds: string[],
  serverNames: string[]
): Record<string, string[]>
```

Auto-refreshes on mount and when `mcp:tools_changed` fires.

### Step 10 — Frontend: `McpServerCard` component

**File:** `src/components/settings/McpServerCard.tsx` (new)

Props:
```ts
interface McpServerCardProps {
  name: string;
  config: McpServerConfig;
  runtime: McpServerRuntime;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (name: string) => void;
  onRemove: (name: string) => void;
}
```

Visual:
- Status indicator: colored dot — green (`connected`), red (`failed`), gray (`disabled`), amber (`needs_auth`), blue pulse (`initializing`)
- Title: server name (bold) + type badge pill ("local" / "remote")
- Subtitle: command string or URL
- Toggle: enable/disable (right-aligned, same style as existing Settings toggles)
- Tool list: collapsible section, tool names shown as small chips. Hidden when no tools.
- Error: shown as red text below subtitle when `status === 'failed'`
- Actions: edit (pencil icon) + delete (trash icon) buttons, visible on hover

### Step 11 — Frontend: `McpAddServerDialog` component

**File:** `src/components/settings/McpAddServerDialog.tsx` (new)

Uses Radix `Dialog` (matching existing dialog patterns in the codebase). Two modes:

**Form mode** (default): Server name, type selector, command/URL input, environment key-value pairs, timeout.

**JSON mode** (toggle): Single textarea for one server's config JSON.

Used for both "Add" (empty form) and "Edit" (pre-populated form).

### Step 12 — Frontend: `McpJsonFallback` component

**File:** `src/components/settings/McpJsonFallback.tsx` (new)

Extract the current raw JSON textarea + validation logic from `McpServersSettings.tsx`. Same `defaultValue` + `useRef` pattern, same debounced save. This preserves the power-user workflow.

### Step 13 — Frontend: Redesign `McpServersSettings`

**File:** `src/components/settings/McpServersSettings.tsx` (rewrite)

New structure:
1. Header: "MCP Servers" title + "Add Server" button (primary) + view toggle (cards/JSON) + refresh button
2. Cards view: `McpServerCard` list from config + runtime data
3. JSON view: `McpJsonFallback`
4. Restart notice: when config is saved while sidecar is running, show info banner — "MCP config saved. Changes take effect on your next task."

Config mutations (toggle, add, edit, remove) all go through a single `handleConfigChange(newConfig)` that:
1. Calls `api.setMcpServersConfig(newConfig)` (persists to DB + sends to sidecar)
2. Schedules a `refresh()` after 1s delay

### Step 14 — Frontend: Tests

**Files:**
- `src/components/settings/__tests__/McpServerCard.test.tsx` — renders status dot, toggle fires callback, shows/hides tools, error display
- `src/components/settings/__tests__/McpServersSettings.test.tsx` — loads config, renders cards, add/remove/toggle flows, view mode switch
- `src/components/settings/__tests__/McpAddServerDialog.test.tsx` — form validation, mode switching, edit pre-population
- `src/hooks/__tests__/useMcpRuntime.test.ts` — event subscription/cleanup, refresh, `groupToolsByServer` edge cases

### Step 15 — Post-completion

- **Update** `docs/specs/app-ux/design_app-ux.md`: Update the MCP Server Configuration section under Settings to describe the new card-based UI, status indicators, and tool listing
- **Update** `docs/specs/opencode-integration/plan_mcp-server-support.md`: Add a "v2 Enhancements" section referencing this plan
- **Update** `UPDATE_LOG.md`: Add entry describing enhanced MCP configuration UI

---

## Stretch: Tool Invocation

Tool invocation via UI is deferred. OpenCode has no direct "call MCP tool" endpoint — invoking a tool requires sending a message through a session. Options for a future iteration:

- **A:** "Test Tool" button that creates a lightweight test session, sends a prompt like "Use the `{toolName}` tool with: {userInput}", displays raw response
- **B:** Wait for OpenCode to add a `POST /mcp/{name}/tool/{id}` endpoint (upstream feature request)

For now, the UI displays tool names as read-only chips.

---

## Verification

1. `pnpm typecheck` — all frontend types pass
2. `cd src-tauri && cargo check` — Rust compiles
3. `cd src-tauri/sidecar-opencode && pnpm build && pnpm test` — sidecar builds and tests pass
4. `pnpm test --run` — all frontend tests pass
5. Manual: Open Settings → MCP Servers → verify cards render for configured servers, status dots update, tools list for connected servers, toggle enable/disable, add/edit/remove servers, JSON fallback mode works

## Key Files

| File | Role |
|------|------|
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | Add MCP API methods |
| `src-tauri/sidecar-opencode/src/types.ts` | Add IPC command/event variants |
| `src-tauri/sidecar-opencode/src/index.ts` | Add IPC handlers + SSE forwarding |
| `src-tauri/src/sidecar.rs` | Add Rust command variants + event forwarding |
| `src-tauri/src/commands/mcp.rs` | New Tauri commands (fire-and-forget) |
| `src/shared/types/mcpSettings.ts` | New frontend types |
| `src/lib/tauri-api.ts` | New API functions + event listeners |
| `src/hooks/useMcpRuntime.ts` | Runtime state management hook |
| `src/components/settings/McpServerCard.tsx` | Per-server card component |
| `src/components/settings/McpAddServerDialog.tsx` | Add/edit server dialog |
| `src/components/settings/McpServersSettings.tsx` | Rewritten settings section |
