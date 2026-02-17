# Plan: Dynamic Model Discovery for Direct API Providers

## Context

The model lists for Anthropic, OpenAI, Google, xAI, and DeepSeek are currently hardcoded in `DEFAULT_PROVIDERS` (`src/shared/types/provider.ts`). This means new models from these providers require a code change and app release. The infrastructure for dynamic model fetching, persistence, and restoration already exists (built for OpenRouter in Req 1.1.3) — this plan extends it to the five direct API providers.

**Goal:** When a user connects to one of these providers, fetch available models from the provider's API, persist them to the DB, and restore them on settings reopen. Clean up the static model lists.

## Changes

### 1. Rust: Add `fetch_provider_models` command (`src-tauri/src/lib.rs`)

A single generic Tauri command that dispatches to provider-specific fetch logic. Reuses the existing `OpenRouterModelsResult` return type.

**Command signature:**
```rust
#[tauri::command]
async fn fetch_provider_models(provider: String) -> Result<OpenRouterModelsResult, String>
```

**Internal flow:**
1. Retrieve API key from OS keychain via `secure_storage::get_api_key(&provider)`
2. Match on provider name → dispatch to helper function
3. Each helper makes an HTTP GET to the provider's models endpoint, parses the response, maps to `Vec<OpenRouterModel>`

**Provider-specific helpers:**

| Provider | Helper | Endpoint | Auth | Filtering |
|----------|--------|----------|------|-----------|
| Anthropic | `fetch_anthropic_models` | `GET https://api.anthropic.com/v1/models` | `x-api-key` + `anthropic-version: 2023-06-01` | None (all are chat models) |
| OpenAI | `fetch_openai_models` | `GET https://api.openai.com/v1/models` | `Authorization: Bearer` | Exclude prefixes: `text-embedding`, `tts-`, `whisper`, `dall-e`, `davinci`, `babbage`, `moderation`, etc. |
| Google | `fetch_google_models` | `GET https://generativelanguage.googleapis.com/v1beta/models?key={key}` | Query param | Filter for `supportedGenerationMethods` containing `generateContent`; strip `models/` prefix from name |
| xAI | `fetch_xai_models` | `GET https://api.x.ai/v1/models` | `Authorization: Bearer` | None |
| DeepSeek | `fetch_deepseek_models` | `GET https://api.deepseek.com/models` | `Authorization: Bearer` | None |

xAI and DeepSeek share a `fetch_openai_compatible_models(api_key, url, provider_name)` helper since they use OpenAI-compatible response format.

**Register** `fetch_provider_models` in the `invoke_handler` macro (~line 2343).

**Note:** Z.AI is excluded — it keeps its static model list.

### 2. Frontend API layer: Add `fetchProviderModels`

**`src/lib/tauri-api-interface.ts`** — Add to `TauriAPI` interface:
```typescript
fetchProviderModels(provider: string): Promise<{
  success: boolean;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
  error?: string;
}>;
```

**`src/lib/tauri-api.ts`** — Add exported function + include in the returned API object:
```typescript
export async function fetchProviderModels(provider: string): Promise<...> {
  return invoke('fetch_provider_models', { provider });
}
```

### 3. Clean up static models: `FALLBACK_MODELS` + empty `DEFAULT_PROVIDERS` models (`src/shared/types/provider.ts`)

1. **Empty** the `models` arrays in `DEFAULT_PROVIDERS` for Anthropic, OpenAI, Google, xAI, DeepSeek (set to `[]`). Z.AI keeps its static models.
2. **Add** a new `FALLBACK_MODELS` constant — maps `ProviderType → Array<{ id: string; name: string }>` with the previous static model data (prefixed IDs). Used when API fetch fails.
3. **Add** `DYNAMIC_MODEL_PROVIDERS: ProviderType[]` — lists the 5 providers that support dynamic fetching.

### 4. Update `ClassicProviderForm.tsx` to fetch models dynamically

**Key changes:**

- Replace `DEFAULT_PROVIDERS` import with `DYNAMIC_MODEL_PROVIDERS`, `FALLBACK_MODELS`
- Add `isDynamic = DYNAMIC_MODEL_PROVIDERS.includes(providerId)` check
- Add `localAvailableModels` state (same pattern as `OpenRouterProviderForm`)

**`handleConnect` flow (for dynamic providers):**
1. Validate key format (existing)
2. Save API key to keychain (existing)
3. **NEW:** Call `api.fetchProviderModels(providerId)`
4. If successful: map models to `{ id: \`${providerId}/${m.id}\`, name: m.name }`
5. If failed: fall back to `FALLBACK_MODELS[providerId]`
6. Build `ConnectedProvider` with `availableModels` set
7. Auto-select default model only if it exists in the fetched list

**Model display (when connected):**
```
connectedProvider?.availableModels  →  (persisted, primary)
  || localAvailableModels           →  (just-fetched, before parent re-render)
  || FALLBACK_MODELS[providerId]    →  (offline/legacy fallback)
  || DEFAULT_PROVIDERS models       →  (Z.AI only, non-dynamic)
```

**For Z.AI (non-dynamic):** Keep current behavior — use `DEFAULT_PROVIDERS` static models.

### 5. Add requirement to `docs/specs/cowork-z/requirements.md`

Add new requirement **1.1.4 Dynamic Model Discovery** under section 1.1:

```markdown
##### 1.1.4 Dynamic Model Discovery
1. WHEN a user connects to Anthropic, OpenAI, Google AI, xAI, or DeepSeek with a valid API key, THE SYSTEM SHALL fetch the available model catalog from the provider's models API endpoint
2. THE SYSTEM SHALL persist the fetched model list in the database alongside provider credentials
3. WHEN the Settings dialog is reopened, THE SYSTEM SHALL restore the persisted model list without requiring a re-fetch
4. WHERE the model fetch fails (network error, API error), THE SYSTEM SHALL fall back to a static default model list without blocking the connection
5. THE SYSTEM SHALL prefix fetched model IDs with the provider identifier (e.g., `anthropic/claude-sonnet-4-5`) for delivery to the OpenCode server
```

Also:
- Add to "Outstanding Feature TODO" section
- Add to "Implementation Plans Index" table
- Update `UPDATE_LOG.md`

### 6. Post-implementation: docs & plan file

- Create `docs/specs/cowork-z/plan_dynamic-model-discovery.md` (this plan)
- Follow the post-feature completion checklist from CLAUDE.md

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Add `fetch_provider_models` command + 5 provider helpers + `fetch_openai_compatible_models` shared helper; register in `invoke_handler` |
| `src/lib/tauri-api.ts` | Add `fetchProviderModels` function + export in API object |
| `src/lib/tauri-api-interface.ts` | Add `fetchProviderModels` to `TauriAPI` interface |
| `src/shared/types/provider.ts` | Empty models arrays for 5 providers in `DEFAULT_PROVIDERS`; add `FALLBACK_MODELS` and `DYNAMIC_MODEL_PROVIDERS` |
| `src/components/settings/providers/ClassicProviderForm.tsx` | Fetch models on connect; use `availableModels` with fallback chain; handle Z.AI separately |
| `docs/specs/cowork-z/requirements.md` | Add Req 1.1.4, update TODO, update index |
| `UPDATE_LOG.md` | Add feature entry |

## Verification

1. `cd src-tauri && cargo check` — Rust compiles
2. `pnpm typecheck` — TypeScript compiles
3. `pnpm tauri dev` — Manual test:
   - Settings > Anthropic > enter API key > Connect → verify model list populates dynamically
   - Select a model, close Settings, reopen → verify model persists (not "Select model...")
   - Repeat for OpenAI, Google, xAI, DeepSeek
   - Disconnect WiFi → Connect to Anthropic → verify fallback models appear
   - Settings > Z.AI → verify static models still work unchanged
