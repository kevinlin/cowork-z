# Feature Requirements: Cowork-Z

## Product Vision

**Cowork-Z is a local-first AI workspace that keeps your work private, organized, and ready to run.**

Most AI tools force you to choose between capability and privacy — and leave you rebuilding context from scratch every time. Cowork-Z takes a different approach: your data stays on your machine, each project gets its own focused workspace with files and sessions co-located, and a built-in library of skills and starter packs means you're productive in minutes, not hours.

**Private by design** — Your files never leave your machine. The agent reads and writes locally; nothing is uploaded to cloud servers. API keys live in the OS keychain and never touch the frontend. Choose from 13+ providers — Anthropic, OpenAI, Ollama, and more — based on the task, not the privacy policy.

**One project at a time** — Work is organized around workspaces: one folder, one focus. Each workspace holds its own files, chat sessions, permissions, and agent history in one place. Switch workspaces to switch projects — nothing bleeds between them.

**Ready in minutes** — No configuration marathons. A built-in Skills Catalog provides reusable AI behaviors you can install with one click. Starter Packs bundle files, prompts, and step-by-step guidance for real-world tasks — writing, research, security audits, legal review, and more.

---

## Implementation Plans Index

The following implementation plans document how specific requirements were designed and built:

### cowork-z — Platform & Security

| Plan | Location | Requirements |
|------|----------|--------------|
| Windows Support (Phase 1) | [`cowork-z/plan_windows-support-phase1.md`](plan_windows-support-phase1.md) | 5.1.1–5.1.3 |

### opencode-integration — OpenCode Sidecar Integration

| Plan | Location | Requirements |
|------|----------|--------------|
| Sidecar OpenCode Rewrite | [`opencode-integration/plan_sidecar-opencode-rewrite.md`](../opencode-integration/plan_sidecar-opencode-rewrite.md) | 1.2.1, 1.2.2 |
| Folder Permission Model | [`opencode-integration/plan_folder-permission-model.md`](../opencode-integration/plan_folder-permission-model.md) | 1.3.1–1.3.4 |
| Fix System Prompt Injection | [`opencode-integration/plan_fix_system_prompt_injection.md`](../opencode-integration/plan_fix_system_prompt_injection.md) | 2.1 |
| User Prompt Customization | [`opencode-integration/plan_user-prompt-customization.md`](../opencode-integration/plan_user-prompt-customization.md) | 2.1 |
| MCP Server Support | [`opencode-integration/plan_mcp-server-support.md`](../opencode-integration/plan_mcp-server-support.md) | 2.3 |
| OpenCode Server API Skill | [`opencode-integration/plan_opencode-server-skill.md`](../opencode-integration/plan_opencode-server-skill.md) | 2.4 |
| Server Isolation | [`opencode-integration/plan_server-isolation.md`](../opencode-integration/plan_server-isolation.md) | 5.2.1 |
| OpenRouter Provider Support | [`opencode-integration/plan_openrouter-provider-support.md`](../opencode-integration/plan_openrouter-provider-support.md) | 1.1.3 |

### chat-ux — Chat Experience

| Plan | Location | Requirements |
|------|----------|--------------|
| Chat UI Rewrite | [`chat-ux/plan_chat_ui_rewrite.md`](../chat-ux/plan_chat_ui_rewrite.md) | 3.7 |
| Drag-and-Drop in Chat | [`chat-ux/plan_drag-and-drop-support.md`](../chat-ux/plan_drag-and-drop-support.md) | 3.5 |
| Rich File & URL Display | [`chat-ux/plan_rich-file-url-display-in-chat.md`](../chat-ux/plan_rich-file-url-display-in-chat.md) | 3.1, 3.2 |

### app-ux — App Experience

| Plan | Location | Requirements |
|------|----------|--------------|
| Theme Support | [`app-ux/plan_theme-support.md`](../app-ux/plan_theme-support.md) | 4.2 |
| Keyboard Shortcuts | [`app-ux/plan_keyboard-shortcuts.md`](../app-ux/plan_keyboard-shortcuts.md) | 4.3.1, 4.3.2 |
| About Panel | [`app-ux/plan_about_panel.md`](../app-ux/plan_about_panel.md) | 4.4 |
| User Feedback | [`app-ux/plan_user-feedback.md`](../app-ux/plan_user-feedback.md) | 4.5 |
| Todo Panel in Sidebar | [`app-ux/plan_todo-panel-in-sidebard.md`](../app-ux/plan_todo-panel-in-sidebard.md) | 3.3 |
| Artefacts Panel | [`app-ux/plan_artefacts-panel.md`](../app-ux/plan_artefacts-panel.md) | 3.4 |
| Dynamic Model Discovery | [`app-ux/plan_dynamic-model-discovery-for-direct-api-providers.md`](../app-ux/plan_dynamic-model-discovery-for-direct-api-providers.md) | 1.1.4 |
| Missing OpenCode CLI Detection | [`app-ux/plan_missing-opencode-cli-detection.md`](../app-ux/plan_missing-opencode-cli-detection.md) | 5.3.3 |

### workspace-as-folder — Workspace-per-Folder Model

| Plan | Location | Requirements |
|------|----------|--------------|
| Workspace Phase 1 | [`workspace-as-folder/plan_phase1.md`](../workspace-as-folder/plan_phase1.md) | 6.1–6.3 |
| Workspace Phase 2 | [`workspace-as-folder/plan_phase2.md`](../workspace-as-folder/plan_phase2.md) | 6.4 |

### workspace-packs — Workspace Starter Packs

| Plan | Location | Requirements |
|------|----------|--------------|
| Workspace Starter Packs | [`workspace-packs/plan.md`](../workspace-packs/plan.md) | 7.1–7.3 |

### app-ux — Starter Skills

| Plan | Location | Requirements |
|------|----------|--------------|
| Skills Catalog | [`app-ux/plan_skills-catalog.md`](../app-ux/plan_skills-catalog.md) | 8.1–8.2 |

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
   - **Proxy**: LiteLLM
2. WHEN a provider is configured, THE SYSTEM SHALL display its connection status (disconnected, connecting, connected, error)
3. WHERE multiple providers are configured, THE SYSTEM SHALL allow the user to switch the active provider and model at any time

##### 1.1.2 Credential Storage
1. THE SYSTEM SHALL store all API keys and credentials in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
2. THE SYSTEM SHALL never expose full API keys to the frontend — only masked prefixes
3. WHERE provider-specific auth is needed (e.g., Bedrock access keys, Azure Entra ID), THE SYSTEM SHALL provide dedicated configuration forms

##### 1.1.3 OpenRouter Provider Support

> **Plan:** [OpenRouter Provider Support](plan_openrouter-provider-support.md)
1. THE SYSTEM SHALL support OpenRouter as a proxy provider, allowing users to access models from multiple upstream providers (Anthropic, OpenAI, Google, Meta, etc.) through a single API key
2. WHEN a user connects with an OpenRouter API key (`sk-or-` prefix), THE SYSTEM SHALL fetch the available model catalog from the OpenRouter API (`GET https://openrouter.ai/api/v1/models`)
3. THE SYSTEM SHALL display fetched models in a selectable list, showing model name, upstream provider, and context length
4. WHEN a model is selected, THE SYSTEM SHALL prefix the model ID with `openrouter/` (e.g., `openrouter/anthropic/claude-3.5-sonnet`) for delivery to the OpenCode server
5. THE SYSTEM SHALL pass the `OPENROUTER_API_KEY` environment variable to the OpenCode server process
6. THE SYSTEM SHALL send `HTTP-Referer` and `X-Title` headers to identify the application in OpenRouter API requests

##### 1.1.4 Dynamic Model Discovery

> **Plan:** [Dynamic Model Discovery](plan_dynamic-model-discovery-for-direct-api-providers.md)
1. WHEN a user connects to Anthropic, OpenAI, Google AI, xAI, or DeepSeek with a valid API key, THE SYSTEM SHALL fetch the available model catalog from the provider's models API endpoint
2. THE SYSTEM SHALL persist the fetched model list in the database alongside provider credentials
3. WHEN the Settings dialog is reopened, THE SYSTEM SHALL restore the persisted model list without requiring a re-fetch
4. WHERE the model fetch fails (network error, API error), THE SYSTEM SHALL fall back to a static default model list without blocking the connection
5. THE SYSTEM SHALL prefix fetched model IDs with the provider identifier (e.g., `anthropic/claude-sonnet-4-5`) for delivery to the OpenCode server

###### 1.1.5 OpenRouter Small-Model Pinning

1. WHEN the selected model uses the OpenRouter provider (model ID starts with `openrouter/`), THE SYSTEM SHALL explicitly set `small_model` to `openrouter/openai/gpt-5-nano` in the OpenCode configuration
2. THE SYSTEM SHALL disable the built-in `opencode` provider (`disabled_providers: ["opencode"]`) to prevent it from silently routing small-model calls through OpenCode's own servers
3. THE SYSTEM SHALL register the small model (`openai/gpt-5-nano`) in the OpenRouter provider's model config so that OpenCode's model resolver can find it
4. THE SYSTEM SHALL write these settings to the pre-start `opencode.json` config file AND the `OPENCODE_CONFIG_CONTENT` environment variable (highest-priority config source) to ensure they survive OpenCode instance disposal and recreation
5. THE SYSTEM SHALL update the on-disk config when the model changes between tasks (server already running) so that subsequent instance reloads pick up the correct settings

#### 1.2 Session Management ✅

> **Plan:** [Sidecar OpenCode Rewrite](../opencode-sidecar/plan_sidecar-opencode-rewrite.md)

**User Story:** As a user, I want to resume previous sessions, so that I can continue work across multiple sittings.

**Acceptance Criteria:**

##### 1.2.1 Session Lifecycle
1. WHEN a user submits a prompt, THE SYSTEM SHALL create a new task and OpenCode session
2. WHEN a task completes or errors, THE SYSTEM SHALL persist the session ID, messages, and folder permissions to the database
3. WHEN the application closes, THE SYSTEM SHALL gracefully terminate all running sessions and sidecar processes
4. THE SYSTEM SHALL use an extended timeout (10 minutes) for the `sendMessage` HTTP request to the OpenCode server, since this is a long-running call that blocks until the full agent turn completes (including permission waits, tool execution, and multi-step reasoning)

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
4. WHEN multiple permission requests arrive concurrently (e.g. from parallel tool calls), THE SYSTEM SHALL queue them and present each to the user in order
5. WHEN the user approves a permission pattern, THE SYSTEM SHALL auto-approve any queued or subsequent requests matching the same pattern

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

#### 2.4 OpenCode Server API Skill ✅

> **Plan:** [OpenCode Server API Skill](plan_opencode-server-skill.md)

**User Story:** As an agent, I want to understand and invoke the OpenCode server's REST APIs, so that I can introspect my own session state, configuration, and runtime environment to work more effectively.

**Acceptance Criteria:**

##### 2.4.1 Skill Content
1. THE SYSTEM SHALL bundle a SKILL.md file documenting the OpenCode server REST API for agent self-introspection
2. THE SKILL SHALL cover these read endpoints: `GET /global/health`, `GET /config`, `GET /session`, `GET /session/{id}`, `GET /session/{id}/message`, `GET /session/{id}/todo`, `GET /skill`, `GET /mcp`, `GET /permission`, `GET /question`
3. THE SKILL SHALL cover this write endpoint: `PATCH /config` (runtime configuration updates)
4. THE SKILL SHALL document request parameters, response shapes, and curl examples for each endpoint
5. THE SKILL SHALL reference server credentials provided in the system prompt rather than hardcoding them

##### 2.4.2 Skill Deployment
1. THE SYSTEM SHALL store the skill source at `src-tauri/resources/skills/opencode-server-api/SKILL.md`
2. THE SYSTEM SHALL copy the bundled SKILL.md to `~/.config/opencode/skills/opencode-server-api/SKILL.md` on every app launch, overwriting any existing copy
3. THE SYSTEM SHALL create the target directory if it does not exist
4. WHERE the copy fails, THE SYSTEM SHALL log a warning without blocking app startup

##### 2.4.3 System Prompt Consolidation
1. THE SYSTEM SHALL replace the existing `skills-discovery` and `mcp-discovery` behavior blocks in the system prompt with a compact `server-access` block containing only the server port, password, and a pointer to the skill
2. THE SYSTEM SHALL continue to inject serverPort and serverPassword into the system prompt at runtime via `buildSystemPrompt()`

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

#### 3.5 Drag-and-Drop Support in Chat ✅

**User Story:** As a user, I want to drag files or folders into the chat input, so that I can quickly reference them in my prompts without typing full paths.

> **Plan:** [Drag-and-drop Support](../ts-frontend/plan_drag-and-drop-support.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL support drag-and-drop of files and folders onto the chat input area
2. WHEN a user drags a file or folder into the chat input, THE SYSTEM SHALL insert the path as `@path/to/file` or `@path/to/folder` at the current cursor position
3. WHERE multiple files are dragged simultaneously, THE SYSTEM SHALL insert each path separated by a space
4. THE SYSTEM SHALL support dragging from the OS file manager (Finder on macOS, Explorer on Windows, file managers on Linux)
5. WHEN a path contains spaces, THE SYSTEM SHALL wrap it in quotes: `@"path/to/file with spaces.txt"`
6. THE SYSTEM SHALL display visual feedback (e.g., highlight or border) when a draggable item is hovering over the chat input area

#### 3.6 Multi-Line Text Input ✅

**User Story:** As a user, I want to write multi-line prompts in the chat input, so that I can compose detailed, structured instructions for the AI agent.

**Acceptance Criteria:**
1. THE SYSTEM SHALL use a multi-line textarea for all chat input areas (task launcher and follow-up input)
2. THE SYSTEM SHALL allow users to insert newlines with `Shift+Enter`
3. WHEN the user presses `Enter` (without Shift), THE SYSTEM SHALL submit the message
4. THE SYSTEM SHALL auto-resize the textarea to fit content, up to a maximum height
5. THE SYSTEM SHALL support drag-and-drop file references within the multi-line textarea (see 3.5)

#### 3.7 Chat UI Rewrite ✅

> **Plan:** [Chat UI Rewrite](../ts-frontend/plan_chat_ui_rewrite.md)

**User Story:** As a user, I want a polished chat experience with collapsible tool calls, clear permission/question dialogs, and streaming support, so that I can follow the agent's work without visual noise.

**Acceptance Criteria:**

##### 3.7.1 Message Rendering
1. THE SYSTEM SHALL render user, assistant, tool, and system messages with distinct visual styles
2. THE SYSTEM SHALL support streaming (partial) messages with a cursor indicator
3. THE SYSTEM SHALL render assistant messages as Markdown with syntax-highlighted code blocks, clickable file paths, and media previews

##### 3.7.2 Tool Call Display
1. THE SYSTEM SHALL render tool-use messages as collapsible cards, collapsed by default
2. WHEN collapsed, THE SYSTEM SHALL display the tool name, a one-line input summary (e.g. file path, command, search query), and a status indicator
3. WHEN expanded, THE SYSTEM SHALL display the full tool input and output in monospace font
4. THE SYSTEM SHALL show a spinner for in-progress tool calls and a checkmark for completed ones

##### 3.7.3 Question Handling
1. WHEN the agent sends a question request (`task:question_request`), THE SYSTEM SHALL display a modal dialog with the question text, selectable options, and an optional free-text input
2. THE SYSTEM SHALL support both single-select and multi-select question options
3. THE SYSTEM SHALL allow the user to submit or cancel the question response

##### 3.7.4 Component Decomposition
1. THE SYSTEM SHALL decompose the chat view into focused components: MessageList, MessageBubble, ToolCallCard, PermissionModal, QuestionDialog, ChatInput, and ThinkingIndicator
2. THE SYSTEM SHALL keep all Tauri event subscriptions in the page-level component (Execution.tsx) and pass state to child components via props

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

#### 4.2 Theme Support ✅

> **Plan:** [Theme Support](../ts-frontend/plan_theme-support.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL provide multiple predefined themes aligned with the Zuhlke style guide, including at least one dark theme
2. THE SYSTEM SHALL allow users to switch themes at runtime without requiring an app restart
3. THE SYSTEM SHALL persist the selected theme to the database
4. WHERE the OS reports a dark-mode preference, THE SYSTEM SHALL default to the dark theme on first launch

#### 4.3 Keyboard Shortcuts ✅

> **Plan:** [Keyboard Shortcuts](../ts-frontend/plan_keyboard-shortcuts.md)

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

#### 4.4 About Panel ✅

> **Plan:** [About Panel](../ts-frontend/plan_about_panel.md)

**Acceptance Criteria:**
1. THE SYSTEM SHALL provide an info panel accessible via the app menu (Help > About)
2. THE SYSTEM SHALL display the current app version (from package metadata)
3. THE SYSTEM SHALL display a changelog derived from [UPDATE_LOG.md](../../../UPDATE_LOG.md)

#### 4.5 User Feedback ✅

> **Plan:** [User Feedback](plan_user-feedback.md)

**User Story:** As a user, I want to report bugs and suggest features directly from the app, so that I can provide feedback without leaving my workflow.

**Acceptance Criteria:**

##### 4.5.1 Feedback Entry Point
1. THE SYSTEM SHALL display a feedback icon button in the sidebar bottom bar, positioned between the logo and the settings button
2. WHEN the user clicks the feedback button, THE SYSTEM SHALL show a popover with two options: "Report Bug" and "Suggest Feature"

##### 4.5.2 GitHub Issue Integration
1. WHEN the user selects "Report Bug", THE SYSTEM SHALL open the OS default browser to the GitHub new issue URL (`https://github.com/kevinlin/cowork-z/issues/new`) with the `bug` label, a pre-filled title placeholder, and a structured body template (description, steps to reproduce, expected vs. actual behavior)
2. WHEN the user selects "Suggest Feature", THE SYSTEM SHALL open the OS default browser to the GitHub new issue URL with the `enhancement` label, a pre-filled title placeholder, and a structured body template (description, use case, proposed solution)
3. THE SYSTEM SHALL auto-append an "Environment" section to the issue body containing: app version, OS name, and platform architecture

##### 4.5.3 Environment Metadata
1. THE SYSTEM SHALL read the app version from the Tauri app metadata
2. THE SYSTEM SHALL read OS name and architecture from the Tauri platform APIs
3. THE SYSTEM SHALL NOT include any user-specific configuration (API keys, provider settings, session data) in the issue body

---

### 5. Platform & Security

**User Story:** As a user, I want Cowork-Z to run on my OS and protect its internal services and data from other local users.

#### 5.1 Cross-Platform Support

> **Plan:** [Cross-Platform Fixes](plan_cross-platform-support.md), [Windows Production Readiness](plan_windows-production-readiness.md)


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
4. THE SYSTEM SHALL write sidecar log files (both Rust and TypeScript) to the same platform-appropriate directory: `~/.local/share/opencode/log` on macOS/Linux (intentionally using an XDG-style location on macOS for parity with Linux), `%LOCALAPPDATA%\opencode\log` on Windows

##### 5.1.4 PATH Resolution for External CLI Tools
1. WHEN launched from a GUI context (Finder/Dock on macOS, Start Menu/Explorer on Windows), THE SYSTEM SHALL augment the process PATH so that globally-installed CLI tools (e.g., `opencode`) are discoverable
2. On macOS/Linux, THE SYSTEM SHALL source the user's login shell PATH via `trusted-shell -ilc 'echo $PATH'` and merge it with the current process PATH
3. On macOS/Linux, THE SYSTEM SHALL only execute login shells from an allowlist of absolute paths and SHALL ignore untrusted `$SHELL` values
4. On macOS/Linux, THE SYSTEM SHALL fall back to well-known directories (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.volta/bin`, `~/.nvm/versions/node/*/bin`, `~/.yarn/bin`, `~/.local/share/pnpm`, `~/.local/share/fnm`) when the login shell approach fails
5. On Windows, THE SYSTEM SHALL include well-known directories (`%APPDATA%\npm`, `%ProgramFiles%\nodejs`, `%LOCALAPPDATA%\Volta\bin`, `~\scoop\shims`, `C:\ProgramData\chocolatey\bin`, `%LOCALAPPDATA%\Yarn\bin`, `%LOCALAPPDATA%\pnpm`, nvm-windows version directories)
6. THE SYSTEM SHALL deduplicate PATH entries (case-insensitively on Windows) and use the platform-appropriate separator (`:` on Unix, `;` on Windows)

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
3. THE SYSTEM SHALL ensure all sidecar log sources (Rust process logger and TypeScript sidecar logger) write to the same directory so logs are co-located for debugging

##### 5.3.3 Missing OpenCode CLI Detection

> **Plan:** [Missing OpenCode CLI Detection](plan_missing-opencode-cli-detection.md)

1. WHEN the `opencode` CLI cannot be found on the augmented PATH, THE SYSTEM SHALL display an error dialog informing the user that OpenCode is required but not installed
2. THE SYSTEM SHALL include a brief installation instruction in the dialog
3. THE SYSTEM SHALL NOT attempt to start a task or launch the OpenCode server when the CLI is missing
4. WHEN the user dismisses the dialog, THE SYSTEM SHALL remain usable for configuration (e.g., setting API keys, provider settings) but SHALL block task execution until OpenCode is detected

#### 5.4 App Update ✅

**User Story:** As a user, I want the app to automatically check for updates and allow me to install them, so that I always have the latest features and fixes without manually downloading new versions.

**Acceptance Criteria:**

##### 5.4.1 Update Check
1. THE SYSTEM SHALL automatically check for updates on app startup (silently, after a short delay)
2. THE SYSTEM SHALL provide a "Check for Updates…" menu item under Help for manual update checks
3. THE SYSTEM SHALL use the Tauri updater plugin with signed update bundles to verify update authenticity
4. THE SYSTEM SHALL check for updates from GitHub Releases (static JSON endpoint)

##### 5.4.2 Update Dialog
1. WHEN an update is available, THE SYSTEM SHALL display a dialog showing the new version number, current version, and release notes (if any)
2. THE SYSTEM SHALL allow the user to choose "Update Now" or "Later"
3. WHEN the user chooses "Update Now", THE SYSTEM SHALL download and install the update, then restart the app automatically
4. WHEN no update is available (manual check), THE SYSTEM SHALL display a "You're up to date" confirmation
5. WHEN the update check fails, THE SYSTEM SHALL display an error message with a "Retry" option

##### 5.4.3 Update Signing
1. THE SYSTEM SHALL sign all update bundles with a private key during the CI build process
2. THE SYSTEM SHALL verify update signatures using the embedded public key before installation
3. THE SYSTEM SHALL NOT install unsigned or tampered update bundles

---

### 6. Workspace & File Browser

> **Full specification:** [Workspace-as-Folder Requirements](../workspace-as-folder/requirements.md)
> **Design:** [Workspace-as-Folder Design (Phase 1)](../workspace-as-folder/design_phase1.md), [Workspace-as-Folder Design (Phase 2)](../workspace-as-folder/design_phase2.md)

**User Story:** As a user, I want each project folder to be its own workspace with a file browser, file preview, and scoped session history, so that I can keep my AI interactions organized by project and browse files the agent creates or modifies.

#### 6.1 Workspace Lifecycle ✅

**Acceptance Criteria:**

##### 6.1.1 Workspace Management
1. THE SYSTEM SHALL model each workspace as a unique directory on the local filesystem, stored in a `workspaces` database table
2. THE SYSTEM SHALL provide a workspace switcher dropdown at the top of the sidebar, listing all workspaces ordered by most recently used
3. THE SYSTEM SHALL allow users to add a new workspace by selecting a folder via the native folder picker
4. THE SYSTEM SHALL validate workspace paths against a platform-aware blocklist (system root, system directories, exact home directory, volume mount points) and reject restricted paths with an error message
5. THE SYSTEM SHALL create `~/Downloads` as the default workspace on first launch
6. THE SYSTEM SHALL persist and restore the last-used workspace across app restarts via `last_workspace_id` in app settings

##### 6.1.2 Workspace Switching
1. WHEN the user switches workspaces, THE SYSTEM SHALL reconfigure the sidecar's SSE event stream to scope to the new workspace directory
2. WHEN the user switches workspaces, THE SYSTEM SHALL reload the session list (filtered to the new workspace) and the file tree (rooted at the new folder)
3. WHERE a workspace folder no longer exists on disk, THE SYSTEM SHALL fall back to `~/Downloads` and display an error toast

##### 6.1.3 Session Scoping
1. THE SYSTEM SHALL associate each task/session with a workspace via a `workspace_id` foreign key
2. THE SYSTEM SHALL filter the sidebar session list to show only sessions belonging to the active workspace
3. WHEN a task starts, THE SYSTEM SHALL pass the active workspace folder as the `working_directory` to the sidecar

#### 6.2 File Tree Browser ✅

**Acceptance Criteria:**

##### 6.2.1 Tree Display
1. THE SYSTEM SHALL display a hierarchical file tree in a "Files" tab in the sidebar, alongside the existing "Sessions" tab
2. THE SYSTEM SHALL lazy-load directory contents on demand (when the user expands a folder)
3. THE SYSTEM SHALL display type-specific icons for directories, images, code files, data/config files, and text files
4. THE SYSTEM SHALL sort entries with directories first, then files, both alphabetical

##### 6.2.2 Search and Filter
1. THE SYSTEM SHALL provide a search bar at the top of the file tree for real-time, case-insensitive, name-based filtering
2. THE SYSTEM SHALL include parent directories when a child matches the search query

##### 6.2.3 Filesystem Watching
1. THE SYSTEM SHALL watch the active workspace directory for filesystem changes using the `notify` crate, debounced at 200ms
2. WHEN changes are detected, THE SYSTEM SHALL emit a `workspace:fs_changed` event and refresh only the affected expanded directories, preserving expand/collapse state

##### 6.2.4 Drag-and-Drop from File Tree
1. THE SYSTEM SHALL allow dragging files from the file tree into chat input areas (task launcher and follow-up input)
2. WHEN a file is dropped, THE SYSTEM SHALL insert the path as an `@path/to/file` reference at the cursor position
3. WHERE a path contains spaces, THE SYSTEM SHALL wrap it in quotes: `@"path/to/file with spaces.txt"`
4. THE SYSTEM SHALL display visual feedback (ring highlight) when hovering over the drop target

#### 6.3 Workspace Permissions ✅

**Acceptance Criteria:**

##### 6.3.1 Workspace Trusted Zone
1. THE SYSTEM SHALL automatically grant read-write access to the active workspace folder and all its descendants without prompting the user
2. THE SYSTEM SHALL inject the workspace folder permission with `source: "workspace"` into every task's permission config

##### 6.3.2 External Folders
1. THE SYSTEM SHALL rename the existing "Folders" panel to "External Folders" for granting access to directories outside the workspace
2. THE SYSTEM SHALL remove the implicit default permissions for `~/Downloads` and `~/Desktop` (the workspace folder replaces this concept)

#### 6.4 File Preview Panel ✅

**User Story:** As a user, I want to preview files from the file tree or chat messages without leaving the app, so that I can quickly inspect content the agent references or creates.

**Acceptance Criteria:**

##### 6.4.1 Preview Opening
1. WHEN the user clicks a file in the file tree, THE SYSTEM SHALL open the file preview in a right-side panel
2. WHEN the user clicks a media thumbnail (image/video) in a chat message, THE SYSTEM SHALL open the file preview panel for that file
3. THE SYSTEM SHALL display a close button (X) in the preview header to dismiss the panel

##### 6.4.2 Resizable Panel
1. THE SYSTEM SHALL provide a drag handle on the left edge of the preview panel for horizontal resizing
2. THE SYSTEM SHALL constrain the panel width between a minimum (280px) and maximum (700px), defaulting to 400px
3. THE SYSTEM SHALL display a visual indicator on hover to signal that the handle is interactive

##### 6.4.3 Preview Types
1. THE SYSTEM SHALL detect the preview type from the file extension and render accordingly:
   - **Code** (`ts tsx js jsx rs py java c cpp h hpp go rb php swift kt scala sh bash css scss xml sql r`): Syntax-highlighted with line numbers, dark theme
   - **Markdown** (`md`): Rendered Markdown with GFM support; embedded code blocks are syntax-highlighted with a macOS-style header bar
   - **Image** (`png jpg jpeg gif svg webp bmp ico`): Centered image, scaled to fit, loaded via Tauri asset protocol
   - **Video** (`mp4 webm ogg mov avi mkv m4v`): Native video player with controls, loaded via Tauri asset protocol
   - **PDF** (`pdf`): Embedded native PDF viewer via base64 data URL
   - **HTML** (`html htm`): Sandboxed iframe with scripts allowed but no host app access
   - **Text** (`txt log csv json yaml yml toml ini cfg conf`): Plain monospace text, scrollable
   - **Binary** (everything else): Generic file icon with file name and size; no content preview

##### 6.4.4 Fullscreen Mode
1. THE SYSTEM SHALL provide a maximize/minimize toggle in the preview header
2. IN fullscreen mode, THE SYSTEM SHALL render the preview as a portal overlay covering the entire viewport with backdrop blur
3. WHEN the user presses **Escape**, THE SYSTEM SHALL exit fullscreen mode
4. WHEN the user switches to a different file, THE SYSTEM SHALL reset to docked mode

##### 6.4.5 Loading and Error States
1. THE SYSTEM SHALL display a spinner while file content is being fetched
2. WHERE loading fails, THE SYSTEM SHALL display an error icon and message in the content area

##### 6.4.6 Add to Chat
1. THE SYSTEM SHALL provide an "Add to Chat" button in the preview header
2. WHEN clicked, THE SYSTEM SHALL insert the file path as an `@path` reference into the active chat input (task launcher on the Home page, follow-up input on the Execution page)
3. THE SYSTEM SHALL insert the reference at the current cursor position with appropriate whitespace padding
4. AFTER insertion, THE SYSTEM SHALL focus the chat input and place the cursor after the inserted reference

---

### 7. Workspace Starter Packs ✅

> **Design:** [Workspace Packs Design](../workspace-packs/design.md)
> **Plan:** [Workspace Packs Plan](../workspace-packs/plan.md)

**User Story:** As a user, I want to browse and install pre-built workspace starter packs from the Home screen, so that I can quickly start guided, real-world tasks without setting up files from scratch.

#### 7.1 Pack Catalog ✅

**Acceptance Criteria:**

##### 7.1.1 Built-in Pack Library
1. THE SYSTEM SHALL include a built-in catalog of 6 workspace starter packs covering writing, research, security, legal, and audit domains
2. EACH pack SHALL define metadata: id, title, description, complexity level, time estimate, and tags
3. THE SYSTEM SHALL expose the pack catalog via a `packs_list` Tauri command

##### 7.1.2 Pack Content
1. EACH pack SHALL include template files in `workspace-packs/packs/<pack-id>/` and documentation files in `workspace-packs/pack-docs/<pack-id>/`
2. THE SYSTEM SHALL bundle pack files as Tauri resources for production builds and fall back to the repo-root `workspace-packs/` directory in debug builds
3. DOCUMENTATION files SHALL include `START_HERE.md`, `PACK_INFO.md`, `PROMPTS.md`, and optionally `CONTRIBUTING.md` and `EXPECTED_OUTPUTS.md`

#### 7.2 Home Screen Packs Browser ✅

**Acceptance Criteria:**

##### 7.2.1 Packs Grid
1. THE SYSTEM SHALL display a "Starter Packs" section on the Home screen below the task input bar, replacing the previous "Example prompts" section
2. THE SYSTEM SHALL render packs in a 2-column grid, each card showing title, description, complexity badge, time estimate, tags, and an Install button
3. THE SYSTEM SHALL display a loading state while the pack catalog is being fetched

##### 7.2.2 Search and Filter
1. THE SYSTEM SHALL provide a search input that filters packs by title, description, complexity, or tags in real-time
2. WHERE no packs match the search query, THE SYSTEM SHALL display a "No packs match your search" message

##### 7.2.3 Pack Installation

1. WHEN the user clicks Install on a pack card, THE SYSTEM SHALL open the native folder picker to choose a destination directory
2. THE SYSTEM SHALL recursively copy the pack template and documentation files into a new subdirectory named after the pack id
3. WHERE a directory with the same name already exists, THE SYSTEM SHALL append an incrementing suffix (`-2`, `-3`, … up to `-100`)
4. AFTER successful installation, THE SYSTEM SHALL add the installed directory as a new workspace, switch to it (reconnecting SSE and reloading the file tree), and auto-start an AI task with the prompt "Open `START_HERE.md` and follow it step-by-step."

##### 7.2.4 Error Handling
1. WHERE pack installation fails, THE SYSTEM SHALL display the error message inline on the affected pack card
2. WHILE a pack is being installed, THE SYSTEM SHALL disable the Install button and show "Installing…" text

---

### 8. Starter Skills ✅

> **Design:** [Skills Catalog Design](../app-ux/design_skills-catalog.md)
> **Plan:** [Skills Catalog Plan](../app-ux/plan_skills-catalog.md)

**User Story:** As a user, I want to browse and install bundled AI skill templates from the Home screen, so that I can quickly add reusable skills to my OpenCode global skills directory without manual file management.

#### 8.1 Skills Catalog ✅

**Acceptance Criteria:**

##### 8.1.1 Built-in Skill Library
1. THE SYSTEM SHALL include a built-in catalog of bundled skill templates in `resources/skill-templates/`, each containing a `SKILL.md` with YAML frontmatter (`name`, `description`)
2. THE SYSTEM SHALL derive display categories automatically from folder name prefixes (e.g., `marketing-*` → Marketing, `sales-*` → Sales, `enterprise-*` → Enterprise, etc.)
3. THE SYSTEM SHALL expose the skill catalog via a `skills_list_with_status` Tauri command

##### 8.1.2 Skill Installation
1. THE SYSTEM SHALL install skills to the OpenCode user-level skills folder: `~/.config/opencode/skills/<skill_id>/`
2. WHEN the user clicks Install on a skill card, THE SYSTEM SHALL recursively copy the bundled skill template to the target directory
3. THE SYSTEM SHALL create the target directory if it does not exist
4. AFTER installation, THE SYSTEM SHALL write a `.coworkz-checksum` file containing the SHA256 hash of the bundled source for future update detection

##### 8.1.3 Update Detection
1. THE SYSTEM SHALL compute SHA256 checksums over all files in each bundled skill directory (sorted by relative path, excluding `.coworkz-checksum` and hidden files)
2. THE SYSTEM SHALL compare the bundled checksum with the installed `.coworkz-checksum` to determine if an update is available
3. WHERE the installed checksum differs from the bundled checksum, THE SYSTEM SHALL display a "Re-install" button (amber/warning style)
4. THE SYSTEM SHALL allow re-install even when the skill is up-to-date (overwrites the installed folder)

#### 8.2 Home Screen Skills Browser ✅

**Acceptance Criteria:**

##### 8.2.1 Skills Grid
1. THE SYSTEM SHALL display a "Skills Catalog" section on the Home screen below the Starter Packs section
2. THE SYSTEM SHALL render skills in a 2-column grid, each card showing name, description, and an install/re-install button
3. THE SYSTEM SHALL display a loading state while the skill catalog is being fetched

##### 8.2.2 Category Tabs and Search
1. THE SYSTEM SHALL display horizontally scrollable category tabs ("All" plus dynamically derived categories) for filtering skills
2. THE SYSTEM SHALL provide a search input that filters skills by name, description, or category in real-time
3. WHERE no skills match the filter, THE SYSTEM SHALL display a "No skills match your search" message

##### 8.2.3 Button States
1. FOR uninstalled skills, THE SYSTEM SHALL show a primary "Install" button
2. WHILE a skill is being installed, THE SYSTEM SHALL disable the button and show "Installing…"
3. FOR installed up-to-date skills, THE SYSTEM SHALL show an "Installed" badge with a secondary "Re-install" link
4. FOR installed outdated skills, THE SYSTEM SHALL show an amber "Re-install" button

##### 8.2.4 Error Handling
1. WHERE skill installation fails, THE SYSTEM SHALL display the error message inline on the affected skill card
2. WHERE the skills catalog fails to load, THE SYSTEM SHALL display a "Failed to load skills" message

---

## Outstanding Feature TODO

The following items remain to be implemented:

- [ ] **Database Encryption** — Optional SQLite encryption at rest with keychain-derived key (Req 5.2.2)