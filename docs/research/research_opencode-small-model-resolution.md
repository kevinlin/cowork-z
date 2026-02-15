# Research: OpenCode Automatic Small-Model Resolution & Provider Value Flow

**Date**: 2026-02-15
**Status**: Resolved
**Requirement**: 1.1.5 OpenRouter Small-Model Pinning
**Repository**: cowork-z

## Research Question

How does OpenCode's automatic small-model resolution work, and how does it get the value from configured providers (e.g., OpenRouter)?

## Summary

OpenCode uses a `small_model` config field for lightweight tasks like title generation. When not explicitly set, OpenCode auto-resolves a small model internally — but this resolution relies on its **curated model database** and **loaded providers**. For OpenRouter models (which aren't in OpenCode's DB), the auto-resolution picks the wrong model. Cowork-Z works around this by writing an explicit override to the pre-start config files and the `OPENCODE_CONFIG_CONTENT` environment variable.

## Detailed Findings

### How `small_model` Works in OpenCode

Per the OpenCode API spec (`docs/specs/opencode-sidecar/opencode-api.json`, line 9776):

> `small_model`: "Small model to use for tasks like title generation in the format of provider/model"

It's an optional `string` field on the `Config` object, in the same `provider/model` format as the main `model` field (e.g., `"anthropic/claude-haiku-4-5"`).

**When omitted**, OpenCode performs automatic resolution via `getSmallModel()` in `provider.ts`. The priority list is:

1. If `cfg.small_model` is explicitly set, use it (calls `getModel(providerID, modelID)`)
2. Otherwise, search the current provider's models for known small models: `claude-haiku-4-5`, `gemini-3-flash`, `gpt-5-nano`, etc.
3. The built-in `"opencode"` provider (which uses `apiKey: "public"`) is loaded by default and offers `gpt-5-nano` as a candidate

### The Problem with OpenRouter

When the user selects an OpenRouter model (e.g., `openrouter/minimax/minimax-m2.5`):

1. OpenCode doesn't have OpenRouter models in its curated models.dev database
2. The `"opencode"` built-in provider auto-loads (it has free models with `apiKey: "public"`)
3. Auto small-model resolution falls through to the `"opencode"` provider
4. It picks **Claude Haiku 4.5 via the opencode provider** — routing session data through OpenCode's servers without the user's knowledge

### Why PATCH /config Alone Doesn't Work

OpenCode's `PATCH /config` endpoint has a critical bug: it writes merged config to `Instance.directory/config.json`, but OpenCode's config loader only reads from `opencode.json` and `opencode.jsonc` — **not** `config.json`. After PATCH /config triggers instance disposal and recreation, the new instance re-reads config from the standard sources, and the PATCH changes are lost.

Additionally, `OPENCODE_CONFIG_CONTENT` (highest-priority config source, set as env var) overrides any conflicting keys from file-based config. If it only contains `{ mcp: ... }`, it won't include the small_model settings.

Config loading priority (low to high):
1. Remote `.well-known/opencode`
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json` / `opencode.jsonc`)
5. `.opencode` directories
6. Inline config (`OPENCODE_CONFIG_CONTENT` env var) — **highest priority**

### The Working Solution (3-Layer Fix)

The fix writes OpenRouter-specific config to three places to ensure it survives all of OpenCode's config resolution paths:

#### Layer 1: Pre-start `opencode.json` file

`ProcessManager.writePreStartConfig()` writes the config overlay to `~/.local/share/opencode/log/opencode.json` before spawning the server. This is the file OpenCode actually reads at startup and after instance reload.

#### Layer 2: `OPENCODE_CONFIG_CONTENT` environment variable

`ProcessManager.startServer()` merges the overlay into the `OPENCODE_CONFIG_CONTENT` env var alongside MCP config. This is the highest-priority config source and ensures settings survive instance disposal even if file-based config is somehow not read.

#### Layer 3: PATCH /config (belt-and-suspenders)

`buildSessionConfig()` still sends the overlay via PATCH /config as reinforcement for the initial request before any instance disposal occurs.

#### The Config Overlay

When the selected `modelId` starts with `openrouter/`, `ProcessManager.buildOpenRouterOverlay()` produces:

```json
{
  "small_model": "openrouter/openai/gpt-5-nano",
  "disabled_providers": ["opencode"],
  "provider": {
    "openrouter": {
      "models": {
        "openai/gpt-5-nano": {
          "name": "GPT-5 Nano",
          "tool_call": true
        }
      }
    }
  }
}
```

The three fields work together:

1. **`small_model`**: Bypasses auto-resolution entirely — `getSmallModel()` checks this first
2. **`disabled_providers`**: Prevents the built-in `opencode` provider from auto-loading
3. **`provider.openrouter.models`**: Registers `openai/gpt-5-nano` so `getModel("openrouter", "openai/gpt-5-nano")` finds a valid model definition

#### Handling Model Changes Between Tasks

When the server is already running and the user switches models (e.g., from Anthropic to OpenRouter), `ProcessManager.updateModelConfig()` re-writes `opencode.json` on disk so that when PATCH /config triggers an instance disposal, the new instance picks up the settings from the file OpenCode actually reads.

### How Provider Values Flow to OpenCode

The full data flow from user configuration to OpenCode:

#### 1. API Key Flow (environment variables)

```
OS Keychain -> Rust secure_storage -> SidecarCommand::StartTask { apiKeys }
  -> Sidecar ProcessManager -> env vars on `opencode serve` spawn
```

Mapping at `src-tauri/sidecar-opencode/src/process-manager.ts`:

| Cowork-Z key | Environment variable |
|---|---|
| `apiKeys.openrouter` | `OPENROUTER_API_KEY` |
| `apiKeys.anthropic` | `ANTHROPIC_API_KEY` |
| `apiKeys.openai` | `OPENAI_API_KEY` |
| `apiKeys.google` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `apiKeys.xai` | `XAI_API_KEY` |
| `apiKeys.deepseek` | `DEEPSEEK_API_KEY` |
| `apiKeys.litellm` | `LITELLM_API_KEY` |
| `apiKeys.bedrock.*` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` |

#### 2. Model Selection Flow (pre-start config + PATCH /config + per-message)

```
Frontend (user picks model) -> SQLite (persisted) -> Rust start_task command
  -> SidecarCommand::StartTask { modelId: "openrouter/minimax/minimax-m2.5" }
  -> Sidecar index.ts handleStartTask()
    -> initialize(apiKeys, mcpServers, modelId)
      -> ProcessManager.ensureServerRunning({ modelId })
        -> writePreStartConfig(mcpServers, openRouterOverlay)  [opencode.json]
        -> OPENCODE_CONFIG_CONTENT = { mcp, ...openRouterOverlay }  [env var]
        -> spawn('opencode serve')
    -> processManager.updateModelConfig(modelId)  [re-writes opencode.json]
    -> sessionManager.startTask(payload)
      -> buildSessionConfig({ modelId })
        -> PATCH /config  (belt-and-suspenders)
      -> parseModelId(modelId)
        -> { providerID: "openrouter", modelID: "minimax/minimax-m2.5" }
      -> POST /session/:id/message { model: { providerID, modelID } }
```

#### 3. Two-Layer Model Override

The model is sent in **two places**:

1. **`PATCH /config`** — sets `config.model` as a global default (best-effort; the authoritative model override is passed per-message)
2. **`POST /session/:id/message`** — the `model` field on each message is the **authoritative** override that bypasses OpenCode's config-based model resolution

#### 4. `parseModelId()` Splitting Logic

The function at `session-manager.ts` splits on the **first** `/`:

- `"openrouter/minimax/minimax-m2.5"` -> `{ providerID: "openrouter", modelID: "minimax/minimax-m2.5" }`
- `"anthropic/claude-sonnet-4-5"` -> `{ providerID: "anthropic", modelID: "claude-sonnet-4-5" }`

### Where OpenRouter Models Come From

When the user connects OpenRouter in settings:

1. **Frontend** calls `fetchProviderModels('openrouter')` -> Tauri command
2. **Rust** (`providers.rs`) calls `https://openrouter.ai/api/v1/models` with the user's API key and required headers (`HTTP-Referer`, `X-Title`)
3. Response contains `{ data: [{ id, name, context_length }] }` where `id` is like `"anthropic/claude-3.5-sonnet"`
4. **Frontend** prefixes each model with `"openrouter/"`, producing composite IDs like `"openrouter/anthropic/claude-3.5-sonnet"`
5. These are stored on the `ConnectedProvider.availableModels` array in SQLite

### OpenRouter vs. Classic Providers

OpenRouter is **not** in `DYNAMIC_MODEL_PROVIDERS` (which includes anthropic, openai, google, xai, deepseek). Key differences:

| Aspect | Classic Providers | OpenRouter |
|---|---|---|
| In `DYNAMIC_MODEL_PROVIDERS` | Yes | No |
| Fallback models | `FALLBACK_MODELS[providerId]` | None — always fetches live |
| Model ID prefix | `${providerId}/` | `openrouter/` |
| `small_model` handling | OpenCode auto-resolves | Explicit pre-start config override |
| Category in `PROVIDER_META` | `'classic'` | `'proxy'` |

## Code References

| File | What |
|---|---|
| `src-tauri/sidecar-opencode/src/process-manager.ts` | `buildOpenRouterOverlay()` — centralized overlay definition |
| `src-tauri/sidecar-opencode/src/process-manager.ts` | `writePreStartConfig()` — writes overlay to opencode.json |
| `src-tauri/sidecar-opencode/src/process-manager.ts` | `updateModelConfig()` — re-writes config on model change |
| `src-tauri/sidecar-opencode/src/process-manager.ts` | `startServer()` — merges overlay into OPENCODE_CONFIG_CONTENT |
| `src-tauri/sidecar-opencode/src/index.ts` | `initialize()` / `handleStartTask()` — passes modelId through |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | `buildSessionConfig()` — PATCH /config belt-and-suspenders |
| `src-tauri/sidecar-opencode/src/types.ts` | `Config` interface with `small_model`, `disabled_providers` |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | `parseModelId()` — splits composite model ID |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | `startTask()` — sends config + message |
| `src-tauri/src/commands/providers.rs` | `fetch_openrouter_models()` — calls OpenRouter API |
| `src/shared/types/provider.ts` | `DYNAMIC_MODEL_PROVIDERS` and `FALLBACK_MODELS` |

## Related Issues

- [OpenCode #8609](https://github.com/anomalyco/opencode/issues/8609) — Misleading documentation about `small_model` default behavior; OpenCode silently uses its own provider for small model calls
- [OpenCode #8724](https://github.com/anomalyco/opencode/pull/8724) — PR to remove opencode fallback in `getSmallModel`
