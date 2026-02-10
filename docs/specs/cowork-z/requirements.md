# Feature Requirements: Cowork-Z

## Product Vision

**Cowork-Z is a local-first desktop agent that brings AI assistance to your files and workflows without compromising privacy.**

Most AI tools force an uncomfortable choice: upload your sensitive work to cloud services, or forgo AI assistance entirely. Cowork-Z eliminates this tradeoff by running entirely on your machine. The agent accesses your local files, executes commands in your environment, and integrates with your tools—all while keeping your data under your control.

**Built for privacy-conscious power users and security-minded teams**, Cowork-Z provides a sandboxed environment where AI agents can work autonomously with granular permission controls. You decide exactly what folders the agent can access and what actions it can take.

**Key capabilities:**
- **Local-first architecture** — All agent execution happens on your machine; no cloud uploads required
- **Multi-provider flexibility** — Switch between 13+ AI providers (Anthropic, OpenAI, Ollama, etc.) based on task requirements
- **Extensible workflows** — Add custom skills and MCP server integrations to tailor the agent to your specific needs
- **Parallel task execution** — Run multiple independent tasks simultaneously to accelerate complex workflows
- **Transparent & auditable** — Full visibility into agent actions, tool calls, and file access with session history

Whether you're a developer protecting proprietary code, a researcher working with sensitive data, or an organization that needs auditability and control, Cowork-Z delivers AI-powered productivity without the privacy compromise.

## Introduction

Cowork-Z is a cross-platform desktop application that provides a sandboxed environment for autonomous AI agents. It integrates with the OpenCode SDK via a sidecar process to enable users to interact with AI agents that can execute code, manipulate files, and perform multi-step workflows.

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

## Implementation Plans Index

The following implementation plans document how specific requirements were designed and built:

| Plan | Location | Requirements |
|------|----------|--------------|
| Sidecar OpenCode Rewrite | [`opencode-sidecar/plan_sidecar-opencode-rewrite.md`](../opencode-sidecar/plan_sidecar-opencode-rewrite.md) | 1.2.1, 1.2.2 (HTTP/SSE-based session management) |
| Folder Permission Model | [`opencode-sidecar/plan_folder-permission-model.md`](../opencode-sidecar/plan_folder-permission-model.md) | 1.3.1–1.3.4 (permission system) |
| Fix System Prompt Injection | [`opencode-sidecar/plan_fix_system_prompt_injection.md`](../opencode-sidecar/plan_fix_system_prompt_injection.md) | 2.1 (user prompt / agent configuration) |
| Keyboard Shortcuts | [`cowork-z/plan_keyboard-shortcuts.md`](plan_keyboard-shortcuts.md) | 4.3.1, 4.3.2 (keyboard shortcuts) |
| Server Isolation | [`cowork-z/plan_server-isolation.md`](plan_server-isolation.md) | 5.2.1 (OpenCode server isolation) |
| Todo Panel in Sidebar | [`cowork-z/plan_todo-panel-in-sidebard.md`](plan_todo-panel-in-sidebard.md) | 3.3 (task todos panel) |
| User Prompt Customization | [`cowork-z/plan_user-prompt-customization.md`](plan_user-prompt-customization.md) | 2.1 (user prompt customization) |
| MCP Server Support | [cowork-z/plan_mcp-server-support.md](plan_mcp-server-support.md) | 2.3 (MCP support) |
| Artefacts Panel | [`cowork-z/plan_artefacts-panel.md`](plan_artefacts-panel.md) | 3.4 (artefacts panel) |

---

## Requirements

### 1. Core Engine

#### 1.1 Multi-Provider Support ✅

**User Story:** As a user, I want to connect to multiple AI providers, so that I can use whichever model best suits my task.

**Acceptance Criteria:**

##### 1.1.1 Provider Management
1. THE SYSTEM SHALL support the following provider categories:
   - **Direct API**: Anthropic, OpenAI, Google Gemini, xAI, DeepSeek, Z.AI
   - **Cloud Platforms**: AWS Bedrock, Azure AI Foundry
   - **Local**: Ollama
   - **Proxy**: OpenRouter, LiteLLM
2. WHEN a provider is configured, THE SYSTEM SHALL display its connection status (disconnected, connecting, connected, error)
3. WHERE multiple providers are configured, THE SYSTEM SHALL allow the user to switch the active provider and model at any time

##### 1.1.2 Credential Storage
1. THE SYSTEM SHALL store all API keys and credentials in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
2. THE SYSTEM SHALL never expose full API keys to the frontend — only masked prefixes
3. WHERE provider-specific auth is needed (e.g., Bedrock access keys, Azure Entra ID), THE SYSTEM SHALL provide dedicated configuration forms

#### 1.2 Session Management ✅

> **Plan:** [Sidecar OpenCode Rewrite](../opencode-sidecar/plan_sidecar-opencode-rewrite.md)

**User Story:** As a user, I want to resume previous sessions, so that I can continue work across multiple sittings.

**Acceptance Criteria:**

##### 1.2.1 Session Lifecycle
1. WHEN a user submits a prompt, THE SYSTEM SHALL create a new task and OpenCode session
2. WHEN a task completes or errors, THE SYSTEM SHALL persist the session ID, messages, and folder permissions to the database
3. WHEN the application closes, THE SYSTEM SHALL gracefully terminate all running sessions and sidecar processes

##### 1.2.2 Session Resumption
1. THE SYSTEM SHALL allow users to resume a previous session with a new prompt
2. WHEN a session is resumed, THE SYSTEM SHALL restore all ad-hoc folder permissions from the original session
3. WHERE a session is resumed, THE SYSTEM SHALL maintain the original conversation context

##### 1.2.3 Task History
1. THE SYSTEM SHALL persist task metadata (prompt, status, summary, timestamps) and messages to SQLite
2. THE SYSTEM SHALL display previous tasks in a sidebar for quick access

#### 1.3 Permission System ✅

> **Plan:** [Folder Permission Model](../opencode-sidecar/plan_folder-permission-model.md)

**User Story:** As a user, I want to control what files and directories the AI agent can access, so that my system stays protected.

**Acceptance Criteria:**

##### 1.3.1 Folder Permissions
1. THE SYSTEM SHALL support two access levels: **read** and **read-write**
2. WHEN a task starts, THE SYSTEM SHALL enforce folder permissions for all file operations
3. WHERE permissions are granted, THE SYSTEM SHALL persist them per task in the database

##### 1.3.2 Default Access
1. THE SYSTEM SHALL grant default access to the user's **Desktop** and **Downloads** folders
2. WHEN the agent requests access to any path outside the default and permitted folders, THE SYSTEM SHALL prompt the user with a permission dialog showing the requested path

##### 1.3.3 Runtime Permission Requests
1. IF the user approves a permission request, THE SYSTEM SHALL extract the parent folder from the requested path and store it as an ad-hoc grant
2. WHERE ad-hoc grants exist, THE SYSTEM SHALL restore them when a session is resumed

##### 1.3.4 Permission Sources
1. THE SYSTEM SHALL distinguish between **user** permissions (explicitly configured) and **ad-hoc** permissions (granted from runtime requests)
2. WHERE the user manages permissions in settings, THE SYSTEM SHALL allow adding, editing, and removing folder permissions

---

### 2. Agent Extensions

**User Story:** As a user, I want to extend the agent's capabilities through custom prompts, reusable skills, and external tools, so that I can tailor the agent to my workflows.

#### 2.1 User Prompt Customization ✅

> **Plan:** [User Prompt Customization](plan_user-prompt-customization.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL provide a settings panel with an enable toggle and textarea for users to define a custom system prompt
2. WHEN enabled, THE SYSTEM SHALL append the custom prompt to the agent's system prompt in a `<user-instructions>` XML block, delivered via the `system` field on each `sendMessage` call to the OpenCode server
3. THE SYSTEM SHALL persist the user prompt (enabled flag and text) to the `app_settings` table in SQLite
4. THE SYSTEM SHALL pass the user prompt through the sidecar IPC protocol and apply it on every `startTask` and `resumeSession` call

#### 2.2 Agent Skill Support ✅

> **Plan:** [Fix System Prompt Injection](../opencode-sidecar/plan_fix_system_prompt_injection.md) (system prompt delivery for agent configuration)

Skills follow the [OpenCode Skills specification](https://opencode.ai/docs/skills/). OpenCode natively discovers and loads skills from convention directories — no additional app-level implementation is required beyond ensuring the OpenCode server has access to the skill directories.

**Acceptance Criteria:**
1. THE SYSTEM SHALL rely on the OpenCode server's built-in skill discovery, which searches:
   - Global: `~/.config/opencode/skills/<name>/SKILL.md`
   - Claude-compatible: `.claude/skills/<name>/SKILL.md` (project and global)
   - Agent-compatible: `.agents/skills/<name>/SKILL.md` (project and global)
2. THE SYSTEM SHALL expose discovered skills to the agent via the OpenCode `skill` tool, which lists available skills and loads their content on demand
3. WHERE skill files are added or modified in any discovery path, OpenCode SHALL pick them up without requiring an app restart
4. THE SYSTEM SHALL display the skills folder path in the Settings panel as a clickable link that opens the directory in the OS file manager (Finder on macOS, Explorer on Windows)

#### 2.3 MCP Server Support ✅

MCP server configuration follows the [OpenCode MCP specification](https://opencode.ai/docs/mcp-servers/). The app must support configuring MCP servers via the UI and passing the configuration to OpenCode via `PATCH /config`.

> **Plan:** [MCP Server Support](plan_mcp-server-support.md)

**Acceptance Criteria:**

##### 2.3.1 MCP Server Configuration
1. THE SYSTEM SHALL support both **local** and **remote** MCP server types
2. WHERE a local MCP server is defined, THE SYSTEM SHALL support `command` (array), `environment` (object), `enabled` (boolean), and `timeout` (number) fields
3. WHERE a remote MCP server is defined, THE SYSTEM SHALL support `url`, `headers`, `oauth`, `enabled`, and `timeout` fields
4. THE SYSTEM SHALL persist MCP server configurations to the database
5. THE SYSTEM SHALL pass MCP server configuration to the OpenCode server via `PATCH /config`

##### 2.3.2 MCP Lifecycle
1. WHEN the application starts, THE SYSTEM SHALL load persisted MCP configurations and send them to OpenCode
2. WHERE an MCP server fails to connect, THE SYSTEM SHALL report the error to the user without blocking other servers
3. THE SYSTEM SHALL allow enabling/disabling individual MCP servers at runtime via the UI

##### 2.3.3 MCP Management UI
1. THE SYSTEM SHALL provide a settings panel for managing MCP servers (add, edit, remove)
2. FOR local MCP servers, THE SYSTEM SHALL provide a form with fields for: name, command, environment variables, timeout, and enabled toggle
3. FOR remote MCP servers, THE SYSTEM SHALL provide a form with fields for: name, URL, headers, OAuth configuration, timeout, and enabled toggle
4. THE SYSTEM SHALL display the connection status of each configured MCP server

---

### 3. Chat Experience

**User Story:** As a user, I want agent responses and session context presented in a rich, interactive way so that I can quickly access and preview relevant content.

#### 3.1 Rich File Display ✅

**Acceptance Criteria:**
1. THE SYSTEM SHALL render file paths in agent messages as clickable links with a mini icon based on the file extension
2. WHEN a user clicks a file link, THE SYSTEM SHALL open the file with the OS default application for that extension
3. WHERE the file is an image or video, THE SYSTEM SHALL display a thumbnail preview at the bottom of the message bubble
4. WHEN a user clicks an image or video thumbnail, THE SYSTEM SHALL open a modal preview within the app

#### 3.2 Rich URL Display ✅

**Acceptance Criteria:**
1. THE SYSTEM SHALL render URLs in agent messages as clickable links with an icon
2. WHEN a user clicks a URL, THE SYSTEM SHALL open it in the OS default browser

#### 3.3 Task Todos Panel ✅

> **Plan:** [Todo Panel in Sidebar](plan_todo-panel-in-sidebard.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL display the active task's todo items in a collapsible sidebar panel (positioned after Folders)
2. THE SYSTEM SHALL show each todo's status (pending, in progress, completed, cancelled) with a distinct icon
3. THE SYSTEM SHALL display a progress bar showing completed vs. total items
4. THE SYSTEM SHALL sort todos by status: in-progress first, then pending, completed, cancelled
5. THE SYSTEM SHALL auto-expand the panel when new todos arrive during a task

#### 3.4 Artefacts Panel ✅

> **Plan:** [Artefacts Panel](plan_artefacts-panel.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL collect all files the agent creates or modifies during a session
2. THE SYSTEM SHALL display artefacts in the sidebar, positioned after Folders and Todos, before task history
3. WHEN a user clicks an artefact, THE SYSTEM SHALL open the file with the OS default application for its extension
4. WHERE a session is resumed, THE SYSTEM SHALL restore the artefact list from the previous session

#### 3.5 Drag-and-Drop File References

**User Story:** As a user, I want to drag files or folders into the chat input, so that I can quickly reference them in my prompts without typing full paths.

**Acceptance Criteria:**
1. THE SYSTEM SHALL support drag-and-drop of files and folders onto the chat input area
2. WHEN a user drags a file or folder into the chat input, THE SYSTEM SHALL insert the path as `@path/to/file` or `@path/to/folder` at the current cursor position
3. WHERE multiple files are dragged simultaneously, THE SYSTEM SHALL insert each path separated by a space
4. THE SYSTEM SHALL support dragging from the OS file manager (Finder on macOS, Explorer on Windows, file managers on Linux)
5. WHEN a path contains spaces, THE SYSTEM SHALL wrap it in quotes: `@"path/to/file with spaces.txt"`
6. THE SYSTEM SHALL display visual feedback (e.g., highlight or border) when a draggable item is hovering over the chat input area

---

### 4. App Experience

**User Story:** As a user, I want to personalize the app appearance and navigate efficiently through keyboard shortcuts and settings.

#### 4.1 Settings ✅

**Acceptance Criteria:**

##### 4.1.1 Settings Storage
1. THE SYSTEM SHALL persist settings to the SQLite database
2. WHEN settings are modified, THE SYSTEM SHALL apply them immediately without requiring an app restart

##### 4.1.2 Configurable Options
1. THE SYSTEM SHALL allow configuring:
   - Active provider and model selection
   - Per-provider API keys and connection settings
   - Folder permissions
   - Skills folder path (read-only, clickable link to open in OS file manager)
   - Debug mode toggle

#### 4.2 Theme Support

**Acceptance Criteria:**
1. THE SYSTEM SHALL provide multiple predefined themes aligned with the Zuhlke style guide, including at least one dark theme
2. THE SYSTEM SHALL allow users to switch themes at runtime without requiring an app restart
3. THE SYSTEM SHALL persist the selected theme to the database
4. WHERE the OS reports a dark-mode preference, THE SYSTEM SHALL default to the dark theme on first launch

#### 4.3 Keyboard Shortcuts ✅

> **Plan:** [Keyboard Shortcuts](plan_keyboard-shortcuts.md)

**Acceptance Criteria:**

##### 4.3.1 App-Level Shortcuts
1. THE SYSTEM SHALL support the following default shortcuts (macOS / Windows):
   - `Cmd+,` / `Ctrl+,` — Open settings
   - `Cmd+N` / `Ctrl+N` — New task
2. THE SYSTEM SHALL map modifier keys to platform conventions (`Cmd` on macOS, `Ctrl` on Windows/Linux)

##### 4.3.2 Chat Shortcuts
1. THE SYSTEM SHALL support the following shortcuts within the chat view:
   - `Cmd+Enter` / `Ctrl+Enter` — Send message
   - `Escape` — Cancel running task
2. WHERE the input field is focused, THE SYSTEM SHALL not intercept shortcuts that conflict with standard text editing (`Cmd+A`, `Cmd+C`, etc.)

#### 4.4 About Panel

**Acceptance Criteria:**
1. THE SYSTEM SHALL provide an info panel accessible via the app menu (Help > About)
2. THE SYSTEM SHALL display the current app version (from package metadata)
3. THE SYSTEM SHALL display a changelog derived from the source repository

---

### 5. Platform & Security

**User Story:** As a user, I want Cowork-Z to run on my OS and protect its internal services and data from other local users.

#### 5.1 Cross-Platform Support

**Acceptance Criteria:**

##### 5.1.1 Platform Targets
1. THE SYSTEM SHALL support macOS (ARM64, x64) and Windows (x64) as primary platforms
2. THE SYSTEM SHALL support Linux (x64, ARM64) as a secondary platform

##### 5.1.2 Platform Parity
1. THE SYSTEM SHALL provide the same feature set across all primary platforms
2. WHERE platform-specific APIs differ (keychain, file paths, process management), THE SYSTEM SHALL abstract them behind a common interface
3. THE SYSTEM SHALL build the sidecar binary for each target platform

##### 5.1.3 Platform Conventions
1. THE SYSTEM SHALL use platform-appropriate data directories (e.g., `~/Library/Application Support/` on macOS, `%APPDATA%` on Windows)
2. THE SYSTEM SHALL use platform-appropriate keyboard modifiers (`Cmd` on macOS, `Ctrl` on Windows/Linux)
3. THE SYSTEM SHALL provide platform-appropriate installer formats (`.dmg` for macOS, `.msi`/`.exe` for Windows)

#### 5.2 Security Hardening

> **Plan:** [Server Isolation](plan_server-isolation.md) (Req 5.2.1)

**Acceptance Criteria:**

##### 5.2.1 OpenCode Server Isolation ✅
1. THE SYSTEM SHALL bind the OpenCode server to a random available port on `127.0.0.1` instead of a fixed port
2. THE SYSTEM SHALL generate a random password on each app launch and set it via `OPENCODE_SERVER_PASSWORD` environment variable
3. THE SYSTEM SHALL configure the sidecar to authenticate with the OpenCode server using HTTP basic auth (`opencode` username + generated password)

##### 5.2.2 Database Protection
1. THE SYSTEM SHALL offer an option to encrypt the SQLite database at rest
2. WHERE encryption is enabled, THE SYSTEM SHALL derive the encryption key from the OS keychain
3. WHERE encryption is disabled, THE SYSTEM SHALL store data in plaintext SQLite (default)

##### 5.2.3 Credential Security ✅
1. THE SYSTEM SHALL store all API keys and secrets in the OS keychain — never in the database or config files
2. THE SYSTEM SHALL never log or display full API keys

#### 5.3 Error Handling ✅

**Acceptance Criteria:**

##### 5.3.1 Error Display
1. WHEN API errors occur, THE SYSTEM SHALL display user-friendly error messages
2. WHERE tool execution fails, THE SYSTEM SHALL show the error inline with actionable context
3. IF the application encounters an unrecoverable error, THE SYSTEM SHALL allow session restart

##### 5.3.2 Logging
1. WHEN errors occur, THE SYSTEM SHALL log them to the platform-appropriate log directory
2. WHERE debugging is needed, THE SYSTEM SHALL provide a debug mode with verbose logging

---

## Outstanding Feature TODO

The following items remain to be implemented:

- [ ] **Theme Support** — Multiple predefined themes with dark mode, runtime switching, OS preference detection (Req 4.2)
- [ ] **About Panel** — App info panel with version and changelog (Req 4.4)
- [ ] **Cross-Platform Testing & Installers** — Test on Windows/Linux, build `.msi`/`.exe`/`.deb` installers (Req 5.1.1, 5.1.3)
- [ ] **Database Encryption** — Optional SQLite encryption at rest with keychain-derived key (Req 5.2.2)
