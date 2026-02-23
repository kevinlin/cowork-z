# Plan: OpenRouter Provider Support (Req 1.1.3)

## Context

The OpenRouter provider is ~90% wired across all layers (UI form, API bridge, key storage, sidecar env injection). The **only missing piece** is the Rust `fetch_openrouter_models` command in `src-tauri/src/lib.rs:1636-1644`, which is a stub returning `"OpenRouter not yet implemented"`. Completing this stub enables the full connect flow: user enters API key, models are fetched, user selects a model, tasks run through OpenRouter.

## Changes

### 1. Replace `fetch_openrouter_models` stub (`src-tauri/src/lib.rs:1636-1644`)

Replace the stub with a working implementation that:

1. **Retrieves API key** from secure storage via `secure_storage::get_api_key("openrouter")` (returns `Result<Option<String>, String>`)
2. **Makes HTTP GET** to `https://openrouter.ai/api/v1/models` with headers:
   - `Authorization: Bearer {api_key}`
   - `HTTP-Referer: https://cowork-z.app`
   - `X-Title: Cowork-Z`
3. **Deserializes response** using local structs (same pattern as `test_litellm_connection` at lines 1651-1711):
   ```rust
   #[derive(Deserialize)]
   struct OpenRouterApiResponse { data: Vec<OpenRouterApiModel> }

   #[derive(Deserialize)]
   struct OpenRouterApiModel {
       id: String,
       name: String,
       #[serde(default)]
       context_length: Option<u64>,
   }
   ```
4. **Maps to existing `OpenRouterModel`** (line 178): extracts `provider` from model ID prefix (e.g., `"anthropic"` from `"anthropic/claude-3.5-sonnet"`), defaults `context_length` to `0` if null
5. **Returns errors as `success: false`** (not `Err(...)`) — matches existing pattern so frontend shows user-friendly messages

No other code files change. The frontend form (`OpenRouterProviderForm.tsx`) already calls this command, prefixes model IDs with `openrouter/`, and displays the model selector.

### 2. Fix: Per-message model override for OpenCode compatibility

**Problem discovered during testing:** After the model catalog was implemented, the selected OpenRouter model was silently ignored — OpenCode fell back to a default model (e.g., `google/gemini-3-pro-preview`).

**Root cause:** OpenCode's `PATCH /config` accepts a `model` field but treats it as a runtime-only hint — it is **not persisted** to the config file. When OpenCode's `Provider.getModel()` resolves the model at message time, it looks up the model in its internal `models.dev` curated database. Models from the full OpenRouter catalog that aren't in that curated database cause a `ModelNotFoundError` that is silently swallowed, falling back to a default.

**Fix:** Pass the model directly on every `sendMessage` call using the per-message `model: { providerID, modelID }` parameter. This tells OpenCode exactly which provider SDK and model ID to use, bypassing config-based model resolution entirely — the same pattern already used for the `system` prompt override.

**Implementation details:**

1. **`src-tauri/sidecar-opencode/src/session-manager.ts`** — Added `parseModelId()` helper that splits a composite model ID (e.g., `"openrouter/minimax/minimax-m2.5"`) into `{ providerID: "openrouter", modelID: "minimax/minimax-m2.5" }`. Both `startTask()` and `resumeSession()` now pass this on every `sendMessage` call.
2. **`src-tauri/sidecar-opencode/src/config-builder.ts`** — Updated comment clarifying that `config.model` via `PATCH /config` is best-effort; the authoritative model override is per-message.
3. **`src-tauri/sidecar-opencode/src/types.ts`** — Added `provider` field to the `Config` interface.

> **Note:** This fix benefits all providers, not just OpenRouter. Any model selected in Cowork-Z that isn't in OpenCode's `models.dev` database will now work correctly.

### 3. Fix: Persist and restore available models in provider settings

**Problem discovered during testing:** After connecting to OpenRouter and selecting a model, reopening the Settings dialog showed "Select model..." instead of the saved model name — even though `selected_model_id` was correctly stored in the `providers` SQLite table.

**Root cause:** Two bugs in `src-tauri/src/lib.rs`:

1. **Write path** (`set_connected_provider`): The `available_models` field was hardcoded to `None`. The frontend sends the fetched model list inside `provider.config.availableModels`, but the handler never extracted it — so the DB column `available_models` was always NULL.
2. **Read path** (`get_provider_settings` and `get_connected_provider`): The `config` response was set to only the serialized `credentials` object. Even if `available_models` existed in the DB, it was dropped from the response. The frontend's `normalizeConnectedProvider` expects `config.availableModels` to be present to populate the `ModelSelector` options list.

Without the model list, `ModelSelector` has no options to match against the saved `selectedModelId`, so `models.find(m => m.id === value)` returns `undefined` and the placeholder is shown.

**Fix — `src-tauri/src/lib.rs`:**

1. **Write path** — In `set_connected_provider`, extract `availableModels` from the `config` JSON value and deserialize it as `Vec<db::providers::AvailableModel>`
2. **Read path** — In both `get_provider_settings` and `get_connected_provider`, build the `config` response as a JSON object containing both `credentials` and `availableModels`

> **Note:** This fix benefits all providers with dynamic model lists (OpenRouter, Ollama, LiteLLM), not just OpenRouter. The DB layer (`db::providers`) already fully supported `available_models` — it was only the Tauri command handlers that failed to use it.

### 4. Update docs (post-implementation checklist)

- **`docs/specs/requirements.md`**: Add `✅` to `##### 1.1.3 OpenRouter Provider`, add plan reference link, check off in Outstanding TODO, add to Implementation Plans Index
- **`UPDATE_LOG.md`**: Append entry for 1.1.3

## Verification

1. `cd src-tauri && cargo check` — confirms Rust compiles
2. `pnpm typecheck` — confirms frontend still compiles
3. `cd src-tauri/sidecar-opencode && pnpm build` — confirms sidecar compiles
4. Manual test via `pnpm tauri dev`:
   - Settings > OpenRouter > enter `sk-or-*` key > Connect
   - Verify model list populates with names, providers, context lengths
   - Select a model (including one not in OpenCode's curated list, e.g., MiniMax M2.5), start a task, verify the correct model is used
   - Close and reopen Settings dialog — verify the selected model name is displayed (not "Select model...") and the full model list is available in the dropdown

No automated Rust test — the function depends on OS keychain + network; the `test_litellm_connection` reference implementation also has no test.

## Files

| File | Action |
|------|--------|
| `src-tauri/src/lib.rs` | Replace stub at lines 1636-1644; fix `set_connected_provider` to persist `availableModels`; fix `get_provider_settings` and `get_connected_provider` to return `availableModels` in response |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Add `parseModelId()`, pass model on `sendMessage` |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | Update comment on `config.model` |
| `src-tauri/sidecar-opencode/src/types.ts` | Add `provider` field to `Config` interface |
| `docs/specs/opencode-integration/plan_openrouter-provider-support.md` | Create (plan doc) |
| `docs/specs/requirements.md` | Update checkmarks, plan link, TODO, index |
| `UPDATE_LOG.md` | Append feature entry |
