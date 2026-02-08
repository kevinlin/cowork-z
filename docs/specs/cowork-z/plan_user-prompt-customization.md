# Implementation Plan: User Prompt Customization (Req 2.1)

## Overview

Adds a user-configurable custom prompt that is appended to the agent's system prompt. Users can enable/disable the feature via a toggle and write their custom instructions in a textarea, both accessible from the Settings dialog.

## Architecture

The feature follows the existing **debug mode** pattern for full-stack persistence:

```
Settings UI (toggle + textarea)
  → AccomplishAPI (getUserPrompt / setUserPrompt)
    → Tauri commands (get_user_prompt / set_user_prompt)
      → SQLite (app_settings.user_prompt_enabled, app_settings.user_prompt_text)
```

At task dispatch time, the Rust layer reads the user prompt from the database and passes it through the sidecar IPC protocol. The sidecar appends it to the system prompt in a `<user-instructions>` XML block.

```
start_task / resume_session (lib.rs)
  → reads user_prompt from DB
    → passes custom_prompt in StartTaskPayload / ResumeSessionPayload
      → session-manager.ts passes to buildSystemPrompt()
        → appended as <user-instructions> block in system prompt
          → sent via `system` field on POST /session/{id}/message
```

## Changes

| Layer | File | Change |
|-------|------|--------|
| DB Migration | `src-tauri/src/db/migrations.rs` | v6: add `user_prompt_enabled` (INTEGER) and `user_prompt_text` (TEXT) to `app_settings` |
| DB Access | `src-tauri/src/db/settings.rs` | Add `get_user_prompt_enabled`, `get_user_prompt_text`, `set_user_prompt`; update `AppSettings` struct |
| Tauri Commands | `src-tauri/src/lib.rs` | Add `get_user_prompt`, `set_user_prompt` commands; wire `custom_prompt` into `start_task` and `resume_session` |
| Sidecar IPC (Rust) | `src-tauri/src/sidecar.rs` | Add `custom_prompt: Option<String>` to `StartTaskPayload` and `ResumeSessionPayload` |
| Sidecar IPC (TS) | `src-tauri/sidecar-opencode/src/types.ts` | Add `customPrompt?: string` to both payload interfaces |
| System Prompt | `src-tauri/sidecar-opencode/src/config-builder.ts` | Accept `customPrompt` param; append `<user-instructions>` block |
| Session Manager | `src-tauri/sidecar-opencode/src/session-manager.ts` | Pass `customPrompt` from payload to `buildSystemPrompt` |
| TS Bridge | `src/lib/tauri-api.ts`, `src/lib/accomplish.ts` | Add `getUserPrompt`, `setUserPrompt` functions |
| UI | `src/components/layout/SettingsDialog.tsx` | Add User Prompt section with toggle + debounced textarea |

## Design Decisions

- **Two DB columns** (`user_prompt_enabled` + `user_prompt_text`) so toggling off preserves the prompt text
- **`<user-instructions>` XML block** keeps the custom prompt cleanly separated from hardcoded agent instructions
- **Debounced textarea save** (300ms) avoids excessive DB writes while typing
- **Read at task dispatch time** (not cached) ensures the latest saved value is always used
