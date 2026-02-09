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
| UI placement | New section in SettingsDialog, after Skills Folder | Follows existing animation stagger pattern |

## Files Modified

### Sidecar (Node.js)
- `src-tauri/sidecar-opencode/src/types.ts` — Extended `McpConfig` with `headers`/`oauth`, added `mcpServers` to payloads, added `update_mcp_config` command
- `src-tauri/sidecar-opencode/src/config-builder.ts` — Added `mcpServers` to `ConfigBuilderOptions` and `buildSessionConfig()`
- `src-tauri/sidecar-opencode/src/session-manager.ts` — Pass `mcpServers` through `startTask()` and `resumeSession()`
- `src-tauri/sidecar-opencode/src/index.ts` — Added `handleUpdateMcpConfig()` handler and router case

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
On Save:
  UI validates JSON → setMcpServersConfig(parsed) → Rust writes DB
                                                   → Rust sends UpdateMcpConfig to sidecar
                                                   → Sidecar calls PATCH /config { mcp: {...} }

On Task Start:
  Rust start_task() → loads MCP from DB → StartTaskPayload.mcpServers
                    → Sidecar buildSessionConfig() includes config.mcp
                    → PATCH /config (full config with mcp)
```

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
