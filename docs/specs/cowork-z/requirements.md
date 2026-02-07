# Feature Requirements: Cowork Z

## Introduction

Cowork Z is a cross-platform desktop application that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK via a sidecar process to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

Built with Tauri 2.x (Rust backend + React/TypeScript frontend), the application supports 13+ AI providers and runs on macOS, Windows, and Linux.

### Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop Framework | Tauri 2.x (Rust backend + Web frontend) |
| Frontend | React 19 + TypeScript 5.8, Radix UI + shadcn/ui, Tailwind CSS, Zustand |
| Build | Vite 7 + Cargo, pnpm workspaces |
| Database | SQLite (rusqlite) |
| Secure Storage | OS Keychain (keyring crate) |
| Sidecar | Node.js + pkg binary (CommonJS) |

---

## Requirements

### 1. Multi-Provider Support

**User Story:** As a user, I want to connect to multiple AI providers, so that I can use whichever model best suits my task.

**Acceptance Criteria:**

#### 1.1 Provider Management ✅
1. THE SYSTEM SHALL support the following provider categories:
   - **Direct API**: Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, Z.AI
   - **Cloud Platforms**: AWS Bedrock, Azure AI Foundry
   - **Local**: Ollama
   - **Proxy**: OpenRouter, LiteLLM
2. WHEN a provider is configured, THE SYSTEM SHALL display its connection status (disconnected, connecting, connected, error)
3. WHERE multiple providers are configured, THE SYSTEM SHALL allow the user to switch the active provider and model at any time

#### 1.2 Credential Storage ✅
1. THE SYSTEM SHALL store all API keys and credentials in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
2. THE SYSTEM SHALL never expose full API keys to the frontend — only masked prefixes
3. WHERE provider-specific auth is needed (e.g., Bedrock access keys, Azure Entra ID), THE SYSTEM SHALL provide dedicated configuration forms

### 2. Permission System

**User Story:** As a user, I want to control what files and directories the AI agent can access, so that my system stays protected.

**Acceptance Criteria:**

#### 2.1 Folder Permissions ✅
1. THE SYSTEM SHALL support two access levels: **read** and **read-write**
2. WHEN a task starts, THE SYSTEM SHALL enforce folder permissions for all file operations
3. WHERE permissions are granted, THE SYSTEM SHALL persist them per task in the database

#### 2.2 Default Access ✅
1. THE SYSTEM SHALL grant default access to the user's **Desktop** and **Downloads** folders
2. WHEN the agent requests access to any path outside the default and permitted folders, THE SYSTEM SHALL prompt the user with a permission dialog showing the requested path

#### 2.3 Runtime Permission Requests ✅
1. IF the user approves a permission request, THE SYSTEM SHALL extract the parent folder from the requested path and store it as an ad-hoc grant
2. WHERE ad-hoc grants exist, THE SYSTEM SHALL restore them when a session is resumed

#### 2.4 Permission Sources ✅
1. THE SYSTEM SHALL distinguish between **user** permissions (explicitly configured) and **ad-hoc** permissions (granted from runtime requests)
2. WHERE the user manages permissions in settings, THE SYSTEM SHALL allow adding, editing, and removing folder permissions

### 3. Session Management

**User Story:** As a user, I want to resume previous sessions, so that I can continue work across multiple sittings.

**Acceptance Criteria:**

#### 3.1 Session Lifecycle ✅
1. WHEN a user submits a prompt, THE SYSTEM SHALL create a new task and OpenCode session
2. WHEN a task completes or errors, THE SYSTEM SHALL persist the session ID, messages, and folder permissions to the database
3. WHEN the application closes, THE SYSTEM SHALL gracefully terminate all running sessions and sidecar processes

#### 3.2 Session Resumption ✅
1. THE SYSTEM SHALL allow users to resume a previous session with a new prompt
2. WHEN a session is resumed, THE SYSTEM SHALL restore all ad-hoc folder permissions from the original session
3. WHERE a session is resumed, THE SYSTEM SHALL maintain the original conversation context

#### 3.3 Task History ✅
1. THE SYSTEM SHALL persist task metadata (prompt, status, summary, timestamps) and messages to SQLite
2. THE SYSTEM SHALL display previous tasks in a sidebar for quick access

### 4. Skills Support

**User Story:** As a user, I want the agent to discover and use reusable skill definitions, so that I can extend the agent's behavior for common workflows.

Skills follow the [OpenCode Skills specification](https://opencode.ai/docs/skills/). OpenCode natively discovers and loads skills from convention directories — no additional app-level implementation is required beyond ensuring the OpenCode server has access to the skill directories.

**Acceptance Criteria:**

#### 4.1 Skill Discovery (via OpenCode) ✅
1. THE SYSTEM SHALL rely on the OpenCode server's built-in skill discovery, which searches:
   - Project-local: `.opencode/skills/<name>/SKILL.md`
   - Global: `~/.config/opencode/skills/<name>/SKILL.md`
   - Claude-compatible: `.claude/skills/<name>/SKILL.md` (project and global)
   - Agent-compatible: `.agents/skills/<name>/SKILL.md` (project and global)
2. THE SYSTEM SHALL expose discovered skills to the agent via the OpenCode `skill` tool, which lists available skills and loads their content on demand
3. WHERE skill files are added or modified in any discovery path, OpenCode SHALL pick them up without requiring an app restart


### 5. MCP Server Support

**User Story:** As a user, I want to connect external tools via MCP servers, so that the agent can interact with third-party services and APIs.

MCP server configuration follows the [OpenCode MCP specification](https://opencode.ai/docs/mcp-servers/). The app must support configuring MCP servers via the UI and passing the configuration to OpenCode via `PATCH /config`.

**Acceptance Criteria:**

#### 5.1 MCP Server Configuration
1. THE SYSTEM SHALL support both **local** and **remote** MCP server types
2. WHERE a local MCP server is defined, THE SYSTEM SHALL support `command` (array), `environment` (object), `enabled` (boolean), and `timeout` (number) fields
3. WHERE a remote MCP server is defined, THE SYSTEM SHALL support `url`, `headers`, `oauth`, `enabled`, and `timeout` fields
4. THE SYSTEM SHALL persist MCP server configurations to the database
5. THE SYSTEM SHALL pass MCP server configuration to the OpenCode server via `PATCH /config`

#### 5.2 MCP Lifecycle
1. WHEN the application starts, THE SYSTEM SHALL load persisted MCP configurations and send them to OpenCode
2. WHERE an MCP server fails to connect, THE SYSTEM SHALL report the error to the user without blocking other servers
3. THE SYSTEM SHALL allow enabling/disabling individual MCP servers at runtime via the UI

#### 5.3 MCP Management UI
1. THE SYSTEM SHALL provide a settings panel for managing MCP servers (add, edit, remove)
2. FOR local MCP servers, THE SYSTEM SHALL provide a form with fields for: name, command, environment variables, timeout, and enabled toggle
3. FOR remote MCP servers, THE SYSTEM SHALL provide a form with fields for: name, URL, headers, OAuth configuration, timeout, and enabled toggle
4. THE SYSTEM SHALL display the connection status of each configured MCP server

### 6. Keyboard Shortcuts

**User Story:** As a user, I want keyboard shortcuts for common actions, so that I can navigate the app efficiently without reaching for the mouse.

**Acceptance Criteria:**

#### 6.1 App-Level Shortcuts
1. THE SYSTEM SHALL support the following default shortcuts (macOS / Windows):
   - `Cmd+,` / `Ctrl+,` — Open settings
   - `Cmd+N` / `Ctrl+N` — New task
2. THE SYSTEM SHALL map modifier keys to platform conventions (`Cmd` on macOS, `Ctrl` on Windows/Linux)

#### 6.2 Chat Shortcuts
1. THE SYSTEM SHALL support the following shortcuts within the chat view:
   - `Cmd+Enter` / `Ctrl+Enter` — Send message
   - `Escape` — Cancel running task
2. WHERE the input field is focused, THE SYSTEM SHALL not intercept shortcuts that conflict with standard text editing (`Cmd+A`, `Cmd+C`, etc.)

### 7. Cross-Platform Support

**User Story:** As a user, I want Cowork Z to work on Windows, so that I'm not limited to macOS.

**Acceptance Criteria:**

#### 7.1 Platform Targets
1. THE SYSTEM SHALL support macOS (ARM64, x64) and Windows (x64) as primary platforms
2. THE SYSTEM SHALL support Linux (x64, ARM64) as a secondary platform

#### 7.2 Platform Parity
1. THE SYSTEM SHALL provide the same feature set across all primary platforms
2. WHERE platform-specific APIs differ (keychain, file paths, process management), THE SYSTEM SHALL abstract them behind a common interface
3. THE SYSTEM SHALL build the sidecar binary for each target platform

#### 7.3 Platform Conventions
1. THE SYSTEM SHALL use platform-appropriate data directories (e.g., `~/Library/Application Support/` on macOS, `%APPDATA%` on Windows)
2. THE SYSTEM SHALL use platform-appropriate keyboard modifiers (`Cmd` on macOS, `Ctrl` on Windows/Linux)
3. THE SYSTEM SHALL provide platform-appropriate installer formats (`.dmg` for macOS, `.msi`/`.exe` for Windows)

### 8. Security Hardening

**User Story:** As a user on a shared machine, I want the application to protect its internal services and data from other local users.

**Acceptance Criteria:**

#### 8.1 OpenCode Server Isolation
1. THE SYSTEM SHALL bind the OpenCode server to a random available port on `127.0.0.1` instead of a fixed port
2. THE SYSTEM SHALL generate a random password on each app launch and set it via `OPENCODE_SERVER_PASSWORD` environment variable
3. THE SYSTEM SHALL configure the sidecar to authenticate with the OpenCode server using HTTP basic auth (`opencode` username + generated password)

#### 8.2 Database Protection
1. THE SYSTEM SHALL offer an option to encrypt the SQLite database at rest
2. WHERE encryption is enabled, THE SYSTEM SHALL derive the encryption key from the OS keychain
3. WHERE encryption is disabled, THE SYSTEM SHALL store data in plaintext SQLite (default)

#### 8.3 Credential Security ✅
1. THE SYSTEM SHALL store all API keys and secrets in the OS keychain — never in the database or config files
2. THE SYSTEM SHALL never log or display full API keys

### 9. Configuration & Settings

**User Story:** As a user, I want to configure application settings, so that I can customize the experience.

**Acceptance Criteria:**

#### 9.1 Settings Storage ✅
1. THE SYSTEM SHALL persist settings to the SQLite database
2. WHEN settings are modified, THE SYSTEM SHALL apply them immediately without requiring an app restart

#### 9.2 Configurable Options
1. THE SYSTEM SHALL allow configuring:
   - Active provider and model selection
   - Per-provider API keys and connection settings
   - Folder permissions
   - Debug mode toggle
   - User prompt customization

### 10. Error Handling

**Acceptance Criteria:**

#### 10.1 Error Display ✅
1. WHEN API errors occur, THE SYSTEM SHALL display user-friendly error messages
2. WHERE tool execution fails, THE SYSTEM SHALL show the error inline with actionable context
3. IF the application encounters an unrecoverable error, THE SYSTEM SHALL allow session restart

#### 10.2 Logging ✅
1. WHEN errors occur, THE SYSTEM SHALL log them to the platform-appropriate log directory
2. WHERE debugging is needed, THE SYSTEM SHALL provide a debug mode with verbose logging

---

## Outstanding Feature TODO

The following items remain to be implemented:

- [ ] **MCP Server Configuration UI** — Settings panel to add, edit, remove, enable/disable local and remote MCP servers. Extend `config-builder.ts` to include MCP config in `buildSessionConfig()` and send to OpenCode via `PATCH /config` (Req 5.1.5, 5.2.1)
- [ ] **MCP Server Persistence** — Persist MCP server configurations to SQLite and load on app startup (Req 5.1.4)
- [ ] **App-Level Keyboard Shortcuts** — Implement `Cmd+,`/`Ctrl+,` for settings and `Cmd+N`/`Ctrl+N` for new task (Req 6.1)
- [ ] **Cross-Platform Testing & Installers** — Test on Windows/Linux, build `.msi`/`.exe`/`.deb` installers (Req 7.1, 7.3)
- [ ] **Database Encryption** — Optional SQLite encryption at rest with keychain-derived key (Req 8.2)
- [ ] **User Prompt Customization** — UI for users to customize the system prompt sent to the agent (Req 9.2)

