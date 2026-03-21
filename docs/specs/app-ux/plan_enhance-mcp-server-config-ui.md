# Enhanced MCP Server Configuration UI

## Context

The current MCP Server settings UI is a raw JSON textarea where users paste a complete MCP config object. There is no per-server visibility, no runtime status, no tool listing, and no per-server enable/disable. The OpenCode server exposes REST endpoints (`GET /mcp`, `POST /mcp/{name}/connect`, `GET /experimental/tool/ids`) and an SSE event (`mcp.tools.changed`) for runtime information.

This plan transforms the MCP section in Settings into a card-based UI (inspired by Cursor's MCP management panel) where each server is a distinct item with status, tools, and controls.

> **Known API limitation (confirmed via runtime investigation):** The OpenCode server's tool endpoints (`GET /experimental/tool/ids` and `GET /experimental/tool?provider=X&model=Y`) return **only built-in tools** — MCP server tools are not included. The `GET /mcp` endpoint returns per-server connection status but no tool names or counts. The `mcp.tools.changed` SSE event does not fire during normal MCP initialization. As a result, per-server tool listing is implemented but non-functional until the upstream OpenCode API exposes MCP tool names. Connection status (`GET /mcp`) works correctly and is the primary server health indicator.

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
- Add methods to the `OpenCodeClient` class, following the existing pattern (e.g. `getConfig`, `listSessions`):

Endpoint mapping:
- `getMcpStatus` → `GET /mcp`
- `connectMcpServer` → `POST /mcp/{name}/connect`
- `disconnectMcpServer` → `POST /mcp/{name}/disconnect`
- `getToolIds` → `GET /experimental/tool/ids` (**Note:** this endpoint currently returns only built-in tools, not MCP server tools — see Known API limitation above)

### Step 2 — Sidecar: IPC types

**File:** `src-tauri/sidecar-opencode/src/types.ts`
- Add to `SidecarCommand` union
- Add to `SidecarEvent` union

### Step 3 — Sidecar: IPC handlers + SSE forwarding

**File:** `src-tauri/sidecar-opencode/src/index.ts`
- Add handler functions (`handleGetMcpStatus`, `handleGetMcpTools`, `handleConnectMcpServer`, `handleDisconnectMcpServer`) following the existing Copilot handler pattern (fire-and-forget with event response)
- Add `mcp.tools.changed` SSE listener in the `initialize()` function after setting up `eventStream`
- Add switch cases in `handleMessage()`

### Step 4 — Sidecar: Tests

**File:** `src-tauri/sidecar-opencode/__tests__/opencode-client.test.ts`
- Add tests for the new client methods with mocked fetch responses.

### Step 5 — Rust: Sidecar command variants + event forwarding

**File:** `src-tauri/src/sidecar.rs`

### Step 6 — Rust: Tauri commands

**File:** `src-tauri/src/commands/mcp.rs` (new)
**File:** `src-tauri/src/commands/mod.rs` — add `pub mod mcp;`
**File:** `src-tauri/src/lib.rs` — register commands in `invoke_handler`

### Step 7 — Frontend: Types

**File:** `src/shared/types/mcpSettings.ts`

### Step 8 — Frontend: API layer

**File:** `src/lib/tauri-api.ts`
- Add invoke wrappers
- Add event listeners

**File:** `src/lib/tauri-api-interface.ts` — extend `TauriAPI` interface with above.

### Step 9 — Frontend: `useMcpRuntime` hook

**File:** `src/hooks/useMcpRuntime.ts` (new)

Custom hook managing:
- `serverStatuses: Record<string, { status, error }>` — from `mcp:status` events
- `allToolIds: string[]` — from `mcp:tools` events
- `loading: boolean`
- `refresh()` — sends both `getMcpStatus` + `getMcpTools`

Tool-to-server grouping: MCP tool IDs follow `{serverName}_{toolName}` convention. The `groupToolsByServer` utility uses the configured server name list as anchors for correct prefix parsing (longest-first matching handles server names with underscores). This function is implemented, exported, and tested — it will populate tool lists automatically when the upstream OpenCode API begins including MCP tools in its responses.

> **Current state:** Due to the known API limitation, `groupToolsByServer` receives only built-in tool IDs (e.g. `bash`, `read`, `glob`) which don't match any server name prefix, so per-server tool arrays remain empty. Connection status from `GET /mcp` works correctly and is the primary indicator.

Auto-refreshes on mount and when `mcp:tools_changed` fires.

### Step 10 — Frontend: `McpServerCard` component

**File:** `src/components/settings/McpServerCard.tsx` (new)

Visual:
- **Letter avatar**: Colored rounded square (8 deterministic colors from name hash) with first letter of server name
- **Status dot**: Inline with command/URL subtitle — green (`connected`), red (`failed`), gray (`disabled`), amber (`needs_auth`), blue pulse (`initializing`)
- **Title row**: server name (bold) + type badge pill ("local" / "remote") + status label for all states (e.g. "Connected", "Failed", "Initializing")
- **Subtitle**: command string or URL, preceded by status dot
- **Toggle**: enable/disable (right-aligned, same style as existing Settings toggles)
- **Tool list**: When tool IDs are available, auto-expanded as chips for connected servers; collapsed by default for others. "Show less" / "Show N tools" toggle for user control. Currently non-functional due to the known API limitation — the card gracefully degrades to showing connection status only
- **Unknown state hint**: When status is `unknown` and no tools are available, shows "Start a task to see server status and tools"
- **Error**: shown as red text below subtitle when `status === 'failed'`
- **Actions**: edit (pencil icon) + delete (trash icon) buttons

**Refinement note (v2):** Race condition fix — `refresh()` moved to a separate effect that fires only after config loads (prevents empty tool lists on mount). Loading timeout of 5s added to handle sidecar-not-running gracefully.

**Refinement note (v3):** Status label for `connected` changed from empty string to "Connected" to provide clear positive feedback when MCP servers are healthy but tool names are unavailable from the API.

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

## Stretch: Tool Discovery & Invocation

### Tool Name Discovery

The OpenCode API does not currently expose MCP tool names. Potential approaches for a future iteration:

- **A:** Wait for OpenCode to include MCP tools in `GET /experimental/tool/ids` or add a dedicated `GET /mcp/{name}/tools` endpoint (upstream feature request)
- **B:** Connect to each MCP server directly using the MCP protocol to list tools (requires implementing an MCP client in the sidecar, significant effort)
- **C:** Parse MCP tool names from OpenCode server log files (fragile, not recommended)

The `groupToolsByServer` utility and `McpServerCard` tool chip UI are already implemented and will activate automatically when tool IDs become available through any of these approaches.

### Tool Invocation

Tool invocation via UI is deferred. OpenCode has no direct "call MCP tool" endpoint — invoking a tool requires sending a message through a session. Options for a future iteration:

- **A:** "Test Tool" button that creates a lightweight test session, sends a prompt like "Use the `{toolName}` tool with: {userInput}", displays raw response
- **B:** Wait for OpenCode to add a `POST /mcp/{name}/tool/{id}` endpoint (upstream feature request)

---

## Verification

1. `pnpm typecheck` — all frontend types pass
2. `cd src-tauri && cargo check` — Rust compiles
3. `cd src-tauri/sidecar-opencode && pnpm build && pnpm test` — sidecar builds and tests pass
4. `pnpm test --run` — all frontend tests pass
5. Manual: Open Settings → MCP Servers → verify cards render for configured servers, status dots update with "Connected" label for healthy servers, toggle enable/disable, add/edit/remove servers, JSON fallback mode works. Note: per-server tool lists will remain empty until the upstream OpenCode API includes MCP tools in its responses

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
