# MCP Server Support — Implementation Plan

## Context

Cowork-Z needs MCP (Model Context Protocol) server management so users can extend the AI agent with additional tools via local commands or remote URLs. The `McpConfig` type already existed in the sidecar's `types.ts` but was unused — no database storage, no UI, no runtime integration existed.

Key requirements:
- JSON-based configuration with **validation in the UI** before saving
- On save: **persist to database AND apply to OpenCode** immediately via `PATCH /config`
- Follow the [OpenCode MCP spec](https://opencode.ai/docs/mcp-servers/) schema

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Single JSON TEXT column (`mcp_servers_config`) on `app_settings` | Matches existing pattern (ollama_config, litellm_config). Collection is small, always loaded/saved as whole |
| UI | JSON textarea with validation | Simpler than structured forms, supports full schema flexibility |
| Runtime apply | New `update_mcp_config` sidecar IPC command | Clean separation — doesn't require full startTask flow |
| Pre-start config | Write `opencode.json` + `OPENCODE_CONFIG_CONTENT` env var before spawning `opencode serve` | OpenCode only initializes MCP server processes at startup; `PATCH /config` updates stored config but does **not** spawn MCP connections at runtime |
| UI placement | New section in SettingsDialog, after Skills Folder | Follows existing animation stagger pattern |

## Files Modified

### Sidecar (Node.js)
- `src-tauri/sidecar-opencode/src/types.ts` — Extended `McpConfig` with `headers`/`oauth`, added `mcpServers` to payloads, added `update_mcp_config` command
- `src-tauri/sidecar-opencode/src/config-builder.ts` — Added `mcpServers` to `ConfigBuilderOptions` and `buildSessionConfig()`
- `src-tauri/sidecar-opencode/src/session-manager.ts` — Pass `mcpServers` through `startTask()` and `resumeSession()`
- `src-tauri/sidecar-opencode/src/index.ts` — Added `handleUpdateMcpConfig()` handler and router case; passes `mcpServers` through `initialize()` to `ensureServerRunning()` so MCP config is available before the OpenCode server starts
- `src-tauri/sidecar-opencode/src/process-manager.ts` — Added `writePreStartConfig()` to write MCP config to `opencode.json` (primary) and `config.json` (legacy) before spawning; sets `OPENCODE_CONFIG_CONTENT` env var as highest-priority config source; added `updateMcpConfig()` for runtime disk updates; `ensureServerRunning()` now accepts `ServerStartOptions` with `mcpServers`

### Rust Backend
- `src-tauri/src/db/migrations.rs` — Migration v7: `mcp_servers_config TEXT` column
- `src-tauri/src/db/settings.rs` — `McpServerConfig` struct, getter/setter, updated `AppSettings`
- `src-tauri/src/sidecar.rs` — `UpdateMcpConfig` command variant, `mcp_servers` on payloads
- `src-tauri/src/lib.rs` — `get_mcp_servers_config`/`set_mcp_servers_config` Tauri commands, MCP loading in `start_task()`/`resume_session()`

### Frontend
- `src/shared/types/mcpSettings.ts` — `McpServerConfig`, `McpServersConfig` types
- `src/shared/types/index.ts` — Re-export
- `src/lib/tauri-api.ts` — `getMcpServersConfig()`/`setMcpServersConfig()` API functions
- `src/lib/tauri-api-interface.ts` — Added to `TauriAPI` interface
- `src/components/settings/McpServersSettings.tsx` — New UI component with JSON validation
- `src/components/layout/SettingsDialog.tsx` — Integrated MCP section

## Data Flow

```
On Save (sidecar already running):
  UI validates JSON → setMcpServersConfig(parsed) → Rust writes DB
                                                   → Rust sends UpdateMcpConfig to sidecar
                                                   → Sidecar writes opencode.json + config.json to disk
                                                   → Sidecar calls PATCH /config { mcp: {...} }
  Note: PATCH /config updates stored config but does NOT initialize MCP server
  processes. Changes take effect on next server restart (next task after sidecar recycle).

On Task Start (first task — server not yet running):
  Rust start_task() → loads MCP from DB → StartTaskPayload.mcpServers
                    → Sidecar initialize(apiKeys, mcpServers)
                    → ProcessManager.ensureServerRunning({ apiKeys, mcpServers })
                    → writePreStartConfig() writes opencode.json + config.json
                    → Sets OPENCODE_CONFIG_CONTENT env var
                    → Spawns `opencode serve` (reads MCP config at startup, initializes connections)
                    → buildSessionConfig() includes config.mcp
                    → PATCH /config (reinforces config in running server)

On Task Start (subsequent tasks — server already running):
  Rust start_task() → loads MCP from DB → StartTaskPayload.mcpServers
                    → Sidecar initialize() returns early (processManager exists)
                    → buildSessionConfig() includes config.mcp
                    → PATCH /config (full config with mcp)
```

### Why pre-start config is required

OpenCode's `PATCH /config` endpoint updates the stored configuration but does **not** trigger MCP server process initialization at runtime. MCP server connections (spawning local commands, connecting to remote URLs) only happen when the `opencode serve` process starts and reads its config. This was confirmed via runtime instrumentation: the PATCH response included the MCP config, but the agent had no MCP tools available.

The fix ensures MCP config reaches OpenCode through three channels before startup:
1. **`opencode.json`** (primary config file) written to the data directory
2. **`config.json`** (legacy config file) written for backwards compatibility
3. **`OPENCODE_CONFIG_CONTENT`** env var set on the spawned process (highest-priority config source)

## OpenCode MCP Schema Reference

```json
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["npx", "-y", "server-package"],
      "enabled": true,
      "environment": { "KEY": "value" },
      "timeout": 5000
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp-server.com",
      "enabled": true,
      "headers": { "Authorization": "Bearer TOKEN" },
      "oauth": { "clientId": "...", "clientSecret": "...", "scope": "..." },
      "timeout": 5000
    }
  }
}
```
