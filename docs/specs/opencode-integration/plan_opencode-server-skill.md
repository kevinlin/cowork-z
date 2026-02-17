# Plan: OpenCode Server API Skill

## Overview

Create a bundled SKILL.md that gives the Cowork-Z agent self-introspection capabilities — the ability to check its own health, session state, message history, todos, config, skills, MCP status, and perform lightweight config updates via the OpenCode server REST API.

## Motivation

The system prompt currently hardcodes two `<behavior>` blocks (~30 lines) teaching the agent to `curl /skill` and `curl /mcp`. This is limited (only 2 of 12+ endpoints) and inflexible (changes require modifying TypeScript code). A SKILL.md file is the proper mechanism for giving the agent domain knowledge about available APIs.

## Architecture

```
Before:
  config-builder.ts buildSystemPrompt()
    ├── <behavior name="skills-discovery">    (hardcoded curl /skill)
    └── <behavior name="mcp-discovery">       (hardcoded curl /mcp)

After:
  config-builder.ts buildSystemPrompt()
    └── <server-access> block (port + password + skill pointer, ~4 lines)

  ~/.config/opencode/skills/opencode-server-api/SKILL.md
    └── Complete API reference (all introspection + config endpoints)

  Rust setup hook
    └── Copies bundled SKILL.md → global skills dir on every launch
```

**Key principle:** Dynamic values (port, password) stay in the system prompt. Static knowledge (API shapes, usage patterns) lives in the skill.

## API Scope

### Included (self-introspection + lightweight actions)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/global/health` | GET | Check server health, get version |
| `/config` | GET | Read current config |
| `/config` | PATCH | Update config at runtime (e.g., switch model) |
| `/session` | GET | List all sessions |
| `/session/{id}` | GET | Get specific session details |
| `/session/{id}/message` | GET | Read back message history |
| `/session/{id}/todo` | GET | Get todo items for a session |
| `/skill` | GET | List available skills |
| `/mcp` | GET | Check MCP server connection status |
| `/permission` | GET | List pending permission requests |
| `/question` | GET | List pending question requests |

### Excluded (mutation/orchestration — out of scope)

- `POST /session` (create session)
- `DELETE /session/{id}` (delete session)
- `POST /session/{id}/abort` (abort session)
- `POST /session/{id}/message` (send message)
- `POST /permission/{id}/reply` (reply to permission)
- `POST /question/{id}/reply` (reply to question)
- `POST /global/dispose`, `POST /instance/dispose` (server lifecycle)

## Implementation

### Step 1: Create the SKILL.md

**File:** `src-tauri/resources/skills/opencode-server-api/SKILL.md`

Content structure (~150-200 lines):
- Header with authentication instructions (referencing system prompt credentials)
- Each endpoint section: method, path, query parameters, response shape (abbreviated JSON), concrete `curl` example
- Usage guidance: when to use each endpoint, common patterns

### Step 2: Slim down the system prompt

**File:** `src-tauri/sidecar-opencode/src/config-builder.ts`

Replace the `skills-discovery` and `mcp-discovery` behavior blocks (lines 49-68) with:

```xml
<server-access>
The OpenCode server is running at http://localhost:${serverPort}
Authenticate with: -u opencode:${serverPassword}
Refer to the "opencode-server-api" skill for the full API reference.
To load it: curl -u opencode:${serverPassword} http://localhost:${serverPort}/skill
</server-access>
```

Everything else in `buildSystemPrompt()` stays unchanged.

### Step 3: Bundle the resource

**File:** `src-tauri/tauri.conf.json`

Add to `bundle.resources`:
```json
"resources": ["resources/skills/**/*"]
```

### Step 4: Copy on app launch

**File:** `src-tauri/src/lib.rs`

In the `setup` hook:
1. Resolve `~/.config/opencode/skills/opencode-server-api/`
2. `fs::create_dir_all` the target directory
3. Read bundled SKILL.md from Tauri resource directory
4. Write to target path (overwriting any existing file)
5. On failure: log warning, do not block startup

### Step 5: Update tests

- **`src-tauri/sidecar-opencode/__tests__/session-manager.test.ts`** — Update assertions that check the system prompt content (behavior blocks → server-access block)
- **`src-tauri/src/lib.rs`** — Consider a Rust integration test for the copy logic if feasible

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Skill purpose | Self-introspection | Keeps scope focused and safe; no session orchestration |
| Skill vs system prompt | Replace behaviors with skill | Single source of truth for API docs; leaner system prompt |
| API scope | Read + PATCH /config | Agent can observe and tune config, but can't create/delete sessions |
| Skill location | Bundled in repo, copied on install | Seamless for users; no manual setup |
| Update strategy | Always overwrite on launch | Users always get latest; skill is app-managed, not user-authored |
| Copy mechanism | Rust setup hook | Runs at launch before sidecar; no new IPC needed |
