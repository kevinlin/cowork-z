# Plan: GitHub Copilot Provider Support

## Context

Cowork-Z currently supports 11 AI providers but not GitHub Copilot. The TODO in `requirements.md` lists "Copilot Provider Support" as a planned feature. OpenCode already has native Copilot support with two provider IDs (`github-copilot` and `github-copilot-enterprise`), using GitHub's OAuth device flow for authentication. Unlike all existing providers that use API keys stored in the OS keychain, Copilot credentials are managed by OpenCode's `auth.json` via an OAuth device flow that requires the OpenCode server to be running.

This plan adds Copilot as the 12th provider with a new OAuth-based settings UI, sidecar IPC commands for the auth flow, and the necessary Rust/frontend plumbing.

---

## Key Architectural Decisions

1. **New `ProviderCategory = 'copilot'`** — Routes to a dedicated `CopilotProviderForm` in `ProviderSettingsPanel`. Unlike `'classic'` (API key input), this form has a "Sign in with GitHub" button and device code display.

2. **Single `ProviderId = 'github-copilot'`** — The UI presents one provider card. An optional "Enterprise URL" field switches the internal OpenCode provider ID to `github-copilot-enterprise`. The user doesn't need to think about two separate providers.

3. **Sidecar-mediated OAuth** — The OAuth device flow is a two-step process using OpenCode server's provider auth API, which requires the server to be running. When the user clicks "Sign in", the Rust backend ensures the sidecar/server is started (reusing the existing `SidecarManager.spawn()` pattern from `start_task`), then forwards the OAuth command. Step 1 (`POST /provider/{id}/oauth/authorize`) returns the device code immediately. Step 2 (`POST /provider/{id}/oauth/callback`) is a blocking call that waits until the user completes the GitHub device flow, then exchanges the code for a token and persists it to `auth.json`.

4. **Event-driven results** — Consistent with the existing architecture, sidecar commands are fire-and-forget via stdin. Results come back as sidecar events (stdout JSON lines) forwarded as Tauri events. The frontend listens for `copilot:oauth_result` and `copilot:oauth_complete` events.

5. **No keychain storage for Copilot** — Unlike other providers, Copilot credentials live in OpenCode's `auth.json`. Cowork-Z's `ConnectedProvider` record in SQLite tracks connection status and selected model only, using a new `CopilotCredentials` type that holds no secrets.

---

## Changes

### 1. Requirements (`docs/specs/requirements.md`)

Add `##### 1.1.6 GitHub Copilot Provider Support` under `#### 1.1 Multi-Provider Support`:

```
##### 1.1.6 GitHub Copilot Provider Support
> **Plan:** [GitHub Copilot Provider Support](../opencode-integration/plan_copilot-provider-support.md)
1. THE SYSTEM SHALL support GitHub Copilot as a provider, allowing users to access models available through their GitHub Copilot subscription
2. WHEN a user clicks "Sign in with GitHub", THE SYSTEM SHALL initiate the GitHub OAuth device flow via the OpenCode server's provider auth API
3. THE SYSTEM SHALL display the device code and a link to github.com/login/device, and open the link in the default browser
4. THE SYSTEM SHALL wait for authorization completion via the OAuth callback endpoint and update the provider status when the user completes the GitHub device flow
5. AFTER successful authentication, THE SYSTEM SHALL fetch available models from the OpenCode server's provider list and display them in a selectable list
6. THE SYSTEM SHALL support an optional GitHub Enterprise URL for enterprise Copilot deployments
7. THE SYSTEM SHALL allow disconnecting from GitHub Copilot, which removes the stored OAuth credentials from the OpenCode auth store
```

Remove the `Copilot Provider Support` item from the TODO section at the bottom.

Add to the Implementation Plans Index table under "opencode-integration":
```
| Copilot Provider Support | [`opencode-integration/plan_copilot-provider-support.md`](../opencode-integration/plan_copilot-provider-support.md) | 1.1.6 |
```

### 2. Implementation Plan Doc (`docs/specs/opencode-integration/plan_copilot-provider-support.md`) (Done)

Create the plan file (content is essentially this plan document).

### 3. Frontend Types (`src/shared/types/providerSettings.ts`)

- Add `'github-copilot'` to `ProviderId` union
- Add `'copilot'` to `ProviderCategory` union
- Add `CopilotCredentials` interface:
  ```typescript
  export interface CopilotCredentials {
    type: 'copilot';
    enterpriseUrl?: string;
  }
  ```
- Add `CopilotCredentials` to `ProviderCredentials` union
- Add `'github-copilot'` entry to `PROVIDER_META`:
  ```typescript
  'github-copilot': {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: 'copilot',
    label: 'Service',
    logoKey: 'github-copilot',
    helpUrl: 'https://github.com/features/copilot',
  },
  ```

### 4. Logo Asset (`public/assets/ai-logos/`)

Add a GitHub Copilot SVG logo. Source the standard Copilot icon.

### 5. Provider Card (`src/components/settings/ProviderCard.tsx`)

Import Copilot logo and add to `PROVIDER_LOGOS` mapping.

### 6. Provider Grid (`src/components/settings/ProviderGrid.tsx`)

Add `'github-copilot'` to `PROVIDER_ORDER` array (position after `google`, before `bedrock`).

### 7. Provider Settings Panel (`src/components/settings/ProviderSettingsPanel.tsx`)

Add `case 'copilot':` that renders `<CopilotProviderForm>` with the same props pattern as other forms.

### 8. Copilot Provider Form (`src/components/settings/providers/CopilotProviderForm.tsx`) — **NEW FILE**

Three-state form component:

**State: Disconnected**
- Optional "Enterprise URL" text input
- "Sign in with GitHub" primary button
- Explanation text about Copilot subscription requirements

**State: Authorizing (device flow in progress)**
- Device code display with copy button
- "Open github.com/login/device" button (calls `openExternal`)
- Instructions text from the OAuth authorize response
- Spinner with "Waiting for authorization..."
- Cancel button

**State: Connected**
- "Connected" status badge
- Model selector dropdown (populated from `copilot:models_result` event)
- Disconnect button

**Event flow:**
1. Click "Sign in" → `invoke('copilot_oauth_authorize', { enterpriseUrl })`
2. Listen for `copilot:oauth_result` → display device code + URL
3. Listen for `copilot:oauth_complete` → on success, invoke `copilot_get_models`
4. Listen for `copilot:models_result` → populate model selector
5. User selects model → call `onConnect()` with `ConnectedProvider`

### 9. Provider Forms Index (`src/components/settings/providers/index.ts`)

Export `CopilotProviderForm`.

### 10. Tauri API (`src/lib/tauri-api.ts` + `src/lib/tauri-api-interface.ts`)

Add four new invoke wrappers:
- `copilotOAuthAuthorize(enterpriseUrl?: string): Promise<void>` — fire-and-forget, results via events
- `copilotGetModels(): Promise<void>` — fire-and-forget, results via events
- `copilotDisconnect(): Promise<void>` — fire-and-forget, results via events

Add three new event listeners:
- `onCopilotOAuthResult(cb)` — receives `{ url, method, instructions }`
- `onCopilotOAuthComplete(cb)` — receives `{ connected, error? }`
- `onCopilotModelsResult(cb)` — receives `{ success, models?, error? }`

Add to `TauriAPI` interface and `getTauriApi()` return object.

### 11. Sidecar IPC Types (`src-tauri/sidecar-opencode/src/types.ts`)

Add to `SidecarCommand` union:
```typescript
| { type: 'copilot_oauth_authorize'; enterpriseUrl?: string }
| { type: 'copilot_get_models' }
| { type: 'copilot_disconnect' }
```

Add to `SidecarEvent` union:
```typescript
| { type: 'copilot_oauth_result'; payload: CopilotOAuthResultPayload }
| { type: 'copilot_oauth_complete'; payload: CopilotOAuthCompletePayload }
| { type: 'copilot_models_result'; payload: CopilotModelsResultPayload }
```

Add payload interfaces:
```typescript
export interface CopilotOAuthResultPayload {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
}
export interface CopilotOAuthCompletePayload {
  connected: boolean;
  error?: string;
}
export interface CopilotModelsResultPayload {
  success: boolean;
  models?: Array<{ id: string; name: string }>;
  error?: string;
}
```

### 12. OpenCode Client (`src-tauri/sidecar-opencode/src/opencode-client.ts`)

Add four new methods using the existing `request()` pattern:
```typescript
async oauthAuthorize(providerID: string, method: number = 0) {
  return this.request('POST', `/provider/${providerID}/oauth/authorize`, { method });
}

async oauthCallback(providerID: string, method: number = 0, code?: string) {
  // Blocks until the user completes the device flow (up to 10 min timeout)
  return this.request('POST', `/provider/${providerID}/oauth/callback`,
    { method, code }, undefined, { timeout: 10 * 60 * 1000 });
}

async listProviders(directory?: string) {
  const params = directory ? { directory } : undefined;
  return this.request('GET', '/provider', undefined, params);
}

async deleteAuth(providerID: string) {
  return this.request('DELETE', `/auth/${providerID}`);
}
```

> **Important:** The OAuth device flow is a two-step API. `oauthAuthorize` starts the flow and returns the device code immediately (storing a pending auth in server memory). `oauthCallback` must be called afterwards — with `method: "auto"`, it blocks until the user authorizes on GitHub, then exchanges the device code for a token and persists it to `~/.local/share/opencode/auth.json`. Without calling `callback`, the token exchange never happens and the provider never becomes connected.

### 13. Sidecar Command Handlers (`src-tauri/sidecar-opencode/src/index.ts`)

Add three new command cases in `handleMessage()`:

**`copilot_oauth_authorize`**:
1. Call `initialize()` to ensure server is running (no task needed)
2. Determine `providerID` based on `enterpriseUrl` presence
3. If enterprise, send `PATCH /config` with enterprise URL in provider config
4. Call `client.oauthAuthorize(providerID, 0)` — returns device code immediately
5. Emit `copilot_oauth_result` with `{ url, method, instructions }`
6. Call `client.oauthCallback(providerID, 0)` asynchronously — this blocks until the user completes the GitHub device flow, then exchanges the code for a token and persists it
7. On callback success, emit `copilot_oauth_complete { connected: true }`
8. On callback error, emit `copilot_oauth_complete { connected: false, error }`

> **Note on the two-step OAuth API:** The OpenCode server's `POST /provider/{id}/oauth/authorize` stores a pending auth in memory and returns the device code. `POST /provider/{id}/oauth/callback` is the blocking call that waits for the user to authorize on GitHub, performs the token exchange, and writes credentials to `auth.json`. The `connected` array in `GET /provider` and the `GET /provider/auth` endpoint are **not** suitable for detecting OAuth completion — `connected` only tracks providers with environment-variable-based keys, and `provider/auth` lists available auth methods (not completed auths). The callback endpoint is the only reliable completion signal.

**`copilot_get_models`**:
1. Call `client.listProviders()`
2. Find `github-copilot` or `github-copilot-enterprise` in `all` array
3. Map `models` object to `{ id: 'github-copilot/modelId', name }` array
4. Emit `copilot_models_result`

**`copilot_disconnect`**:
1. Call `client.deleteAuth('github-copilot')` and `client.deleteAuth('github-copilot-enterprise')`
2. Emit `copilot_oauth_complete { connected: false }`

### 14. Rust — Sidecar Command Enum (`src-tauri/src/sidecar.rs`)

Add three new variants to `SidecarCommand` with **explicit `#[serde(rename)]` attributes**:
```rust
#[serde(rename = "copilot_oauth_authorize")]
CopilotOAuthAuthorize {
    #[serde(rename = "enterpriseUrl")]
    enterprise_url: Option<String>,
},
#[serde(rename = "copilot_get_models")]
CopilotGetModels,
#[serde(rename = "copilot_disconnect")]
CopilotDisconnect,
```

> **Important:** The `#[serde(rename)]` attributes are required because `serde`'s `rename_all = "snake_case"` splits `OAuth` into `o_auth`, producing `copilot_o_auth_authorize` instead of the expected `copilot_oauth_authorize`. The explicit renames ensure correct IPC serialization.

Add event routing in `handle_sidecar_event`:
```rust
"copilot_oauth_result" => "copilot:oauth_result",
"copilot_oauth_complete" => "copilot:oauth_complete",
"copilot_models_result" => "copilot:models_result",
```

### 15. Rust — Tauri Commands (`src-tauri/src/commands/copilot.rs`) — **NEW FILE**

Three commands, all following the same pattern:
1. Lock `sidecar_state.manager`
2. If not running, call `manager.spawn(&app)`
3. Send the corresponding `SidecarCommand`
4. Return `Ok(())` (results come back async via events)

```rust
#[tauri::command]
pub async fn copilot_oauth_authorize(
    enterprise_url: Option<String>,
    app: tauri::AppHandle,
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> { ... }

#[tauri::command]
pub async fn copilot_get_models(
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> { ... }

#[tauri::command]
pub async fn copilot_disconnect(
    sidecar_state: State<'_, SidecarState>,
) -> Result<(), String> { ... }
```

### 16. Rust — Command Registration (`src-tauri/src/commands/mod.rs` + `src-tauri/src/lib.rs`)

- Add `pub mod copilot;` to `commands/mod.rs`
- Add all three commands to `invoke_handler` in `lib.rs`

### 17. Config Builder (`src-tauri/sidecar-opencode/src/config-builder.ts`)

In `buildSessionConfig`, add Copilot handling after the OpenRouter block:
```typescript
if (options.modelId?.startsWith('github-copilot-enterprise/')) {
  config.enabled_providers = [
    ...(config.enabled_providers ?? []),
    'github-copilot-enterprise',
  ];
} else if (options.modelId?.startsWith('github-copilot/')) {
  config.enabled_providers = [
    ...(config.enabled_providers ?? []),
    'github-copilot',
  ];
}
```

No small_model pinning needed — Copilot models are in OpenCode's model database, unlike OpenRouter.

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `docs/specs/requirements.md` | Modify | Add req 1.1.6, update index, remove TODO |
| `docs/specs/opencode-integration/plan_copilot-provider-support.md` | New | Implementation plan document |
| `src/shared/types/providerSettings.ts` | Modify | Add ProviderId, ProviderCategory, CopilotCredentials, PROVIDER_META |
| `public/assets/ai-logos/github-copilot.svg` | New | Copilot logo |
| `src/components/settings/ProviderCard.tsx` | Modify | Add logo import + mapping |
| `src/components/settings/ProviderGrid.tsx` | Modify | Add to PROVIDER_ORDER |
| `src/components/settings/ProviderSettingsPanel.tsx` | Modify | Add 'copilot' case |
| `src/components/settings/providers/CopilotProviderForm.tsx` | New | OAuth device flow UI |
| `src/components/settings/providers/index.ts` | Modify | Export CopilotProviderForm |
| `src/lib/tauri-api.ts` | Modify | Add 3 invoke wrappers + 3 event listeners |
| `src/lib/tauri-api-interface.ts` | Modify | Add to TauriAPI interface |
| `src-tauri/sidecar-opencode/src/types.ts` | Modify | Add IPC command/event types |
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | Modify | Add oauthAuthorize, oauthCallback, listProviders, deleteAuth |
| `src-tauri/sidecar-opencode/src/index.ts` | Modify | Add 3 command handlers + callback-based auth completion |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | Modify | Handle github-copilot model prefix |
| `src-tauri/src/sidecar.rs` | Modify | Add SidecarCommand variants + event routing |
| `src-tauri/src/commands/copilot.rs` | New | Rust Tauri command handlers |
| `src-tauri/src/commands/mod.rs` | Modify | Add `pub mod copilot` |
| `src-tauri/src/lib.rs` | Modify | Register commands in invoke_handler |

---

## Verification

1. **Compilation checks:**
   - `pnpm typecheck` — TypeScript frontend
   - `cd src-tauri && cargo check` — Rust backend
   - `cd src-tauri/sidecar-opencode && pnpm build` — Sidecar

2. **Manual test via `pnpm tauri dev`:**
   - Settings → Provider grid shows GitHub Copilot card
   - Click Copilot card → shows "Sign in with GitHub" button
   - Click "Sign in" → sidecar starts, device code appears, browser opens
   - Complete device flow on GitHub → status changes to "Connected"
   - Model selector populates with available models
   - Select a model → provider becomes active
   - Start a task → correct model is used (check sidecar logs)
   - Close/reopen Settings → selected model is preserved
   - Disconnect → provider returns to disconnected state
   - Enterprise URL field → uses `github-copilot-enterprise` provider ID

3. **Post-completion checklist:**
   - Update `requirements.md` with ✅ on 1.1.6
   - Add to `UPDATE_LOG.md`
   - Verify `pnpm typecheck` and `cargo check` pass
