# Feature Requirements: Cowork Z

## Introduction

Cowork Z is a macOS desktop application that enables users to interact with autonomous AI agents powered by OpenAI models (GPT-5 series). The application provides a sandboxed execution environment where AI-generated code can be safely executed. Built with Tauri (Rust + React/TypeScript) and powered by the GitHub Copilot SDK for agent orchestration.

This is a personal project focused on delivering a functional MVP. Complex features like advanced network isolation, session persistence, and multi-language runtime support are deferred to future enhancements.

### Tech Stack

| Component | Technology |
|-----------|------------|
| Desktop Framework | Tauri 2.x (Rust backend + Web frontend) |
| Frontend | React + TypeScript |
| Agent Orchestration | GitHub Copilot SDK (`@github/copilot-sdk`) |
| Sandbox | macOS App Sandbox |
| Build/Package | Cargo + pnpm |

### Reference Architecture

This project draws inspiration from Claude Cowork's architecture (see [sandbox research](../../../research/claude-cowork-sandbox.md) and [UI integration research](../../../research/claude-cowork-desktop-ui-integration.md)), adapted for:
- macOS-native sandboxing instead of Linux namespaces/bubblewrap
- Copilot SDK instead of custom Anthropic API integration
- Simplified single-user local deployment

## Requirements

### 1. Desktop Application Shell

**User Story:** As an end user, I want a native macOS application to interact with AI agents, so that I have a seamless desktop experience.

**Acceptance Criteria:**

#### 1.1 Application Lifecycle
1. WHEN the application launches, THE SYSTEM SHALL display the main window with a chat interface
2. WHEN the application is closed, THE SYSTEM SHALL gracefully terminate all running agent sessions and sandbox processes
3. WHERE the application crashes, THE SYSTEM SHALL attempt to cleanup sandbox resources on next launch

#### 1.2 Window Management
1. WHEN the main window is displayed, THE SYSTEM SHALL provide a two-panel layout: chat area and sidebar
2. WHERE the sidebar is displayed, THE SYSTEM SHALL show session information and task progress
3. IF the window is resized, THE SYSTEM SHALL responsively adjust the layout

### 2. Copilot SDK Integration

**User Story:** As an end user, I want to interact with AI agents powered by OpenAI models, so that I can leverage GPT-5's capabilities for autonomous task execution.

**Acceptance Criteria:**

#### 2.1 SDK Initialization
1. WHEN the application starts, THE SYSTEM SHALL initialize the Copilot SDK client
2. WHERE API credentials are needed, THE SYSTEM SHALL load them from environment variables or a local config file (`~/.open-cowork/config.json`)
3. WHEN SDK initialization fails, THE SYSTEM SHALL display a clear error message to the user

#### 2.2 Session Management
1. WHEN a user starts a new conversation, THE SYSTEM SHALL create a new Copilot SDK session with appropriate model configuration
2. WHERE a session is active, THE SYSTEM SHALL maintain conversation context across messages
3. WHEN a session ends, THE SYSTEM SHALL properly destroy the session and release resources

#### 2.3 Model Configuration
1. WHEN creating a session, THE SYSTEM SHALL use the configured OpenAI model (default: GPT-5)
2. WHERE model selection is needed, THE SYSTEM SHALL allow users to choose from available models in settings

### 3. Tool System

**User Story:** As an end user, I want AI agents to execute various tools and commands safely, so that they can perform tasks like file operations, code execution, and data processing.

**Acceptance Criteria:**

#### 3.1 Tool Definition
1. WHEN the SDK session is created, THE SYSTEM SHALL register tools using Copilot SDK's `defineTool` with Zod schemas for type-safe parameters
2. WHERE tools are defined, THE SYSTEM SHALL include: file read, file write, file edit, bash command execution, and glob/grep search

#### 3.2 Tool Execution
1. WHEN the AI agent requests a tool call, THE SYSTEM SHALL execute the tool within the sandboxed environment
2. WHEN tool execution completes, THE SYSTEM SHALL return results to the SDK for further processing
3. IF tool execution fails, THE SYSTEM SHALL capture the error and provide it to the AI agent

#### 3.3 Core Tools
1. WHERE file operations are requested, THE SYSTEM SHALL provide read, write, and edit tools restricted to the session working directory
2. WHEN bash commands are executed, THE SYSTEM SHALL run them in an isolated process with controlled environment
3. WHERE code search is needed, THE SYSTEM SHALL provide glob pattern matching and grep-like content search

### 4. Sandboxed Execution Environment

**User Story:** As an end user, I want AI-generated code to execute in an isolated environment, so that my system remains protected from potentially harmful operations.

**Acceptance Criteria:**

#### 4.1 macOS App Sandbox
1. WHEN the application is built for distribution, THE SYSTEM SHALL use macOS App Sandbox entitlements
2. WHERE sandbox entitlements are configured, THE SYSTEM SHALL request only necessary permissions (user-selected files, network for API)

#### 4.2 Filesystem Restrictions
1. WHEN AI-generated code attempts to access the filesystem, THE SYSTEM SHALL limit access to the session working directory
2. WHERE the session directory is created, THE SYSTEM SHALL use a subdirectory within the app's container (`~/Library/Application Support/Cowork Z/sessions/`)
3. IF a sandboxed process attempts to access paths outside allowed directories, THE SYSTEM SHALL block the access

#### 4.3 Process Isolation
1. WHEN bash commands are executed, THE SYSTEM SHALL spawn child processes with restricted environment variables
2. WHERE child processes are spawned, THE SYSTEM SHALL track them for cleanup on session end
3. WHEN a session terminates, THE SYSTEM SHALL kill all associated child processes

### 5. Session Workspace

**User Story:** As an end user, I want each interaction to have its own workspace, so that files and context are organized per task.

**Acceptance Criteria:**

#### 5.1 Workspace Creation
1. WHEN a new session starts, THE SYSTEM SHALL create a unique session directory with a generated identifier
2. WHERE the session directory is created, THE SYSTEM SHALL establish:
   - `/working/` - for intermediate files (read-write)
   - `/outputs/` - for final deliverables (read-write)

#### 5.2 Workspace Cleanup
1. WHEN a session is explicitly closed by the user, THE SYSTEM SHALL offer to preserve or delete the workspace
2. WHERE workspace preservation is chosen, THE SYSTEM SHALL keep the outputs directory accessible

### 6. Chat Interface

**User Story:** As an end user, I want an intuitive chat interface to interact with AI agents, so that I can easily submit tasks and view results.

**Acceptance Criteria:**

#### 6.1 Message Display
1. WHEN the chat area is rendered, THE SYSTEM SHALL display messages in a conversation thread format
2. WHERE the AI agent responds, THE SYSTEM SHALL render markdown with syntax highlighting for code blocks
3. WHEN the AI agent is processing, THE SYSTEM SHALL show a loading indicator

#### 6.2 Message Input
1. WHEN the input area is displayed, THE SYSTEM SHALL show a text field with placeholder text
2. WHERE the user submits a message, THE SYSTEM SHALL send it to the active Copilot SDK session
3. IF streaming responses are available, THE SYSTEM SHALL display text progressively as tokens arrive

#### 6.3 Tool Call Display
1. WHEN tool executions occur, THE SYSTEM SHALL display them in a visually distinct collapsible format
2. WHERE tool results include code or file content, THE SYSTEM SHALL render them with syntax highlighting
3. IF tool execution fails, THE SYSTEM SHALL display error messages with appropriate styling

### 7. Configuration

**User Story:** As an end user, I want to configure basic application settings, so that I can customize the experience.

**Acceptance Criteria:**

#### 7.1 Settings Storage
1. WHEN the application starts, THE SYSTEM SHALL load configuration from `~/.open-cowork/config.json`
2. WHERE settings are modified, THE SYSTEM SHALL persist them to the config file

#### 7.2 Configurable Options
1. WHERE API configuration is needed, THE SYSTEM SHALL allow setting the OpenAI API key
2. IF model selection is required, THE SYSTEM SHALL allow choosing the default model
3. WHERE appearance settings exist, THE SYSTEM SHALL support light/dark theme toggle

### 8. Error Handling

**User Story:** As an end user, I want the system to handle errors gracefully, so that I receive helpful feedback when things go wrong.

**Acceptance Criteria:**

#### 8.1 Error Display
1. WHEN API errors occur, THE SYSTEM SHALL display user-friendly error messages
2. WHERE tool execution fails, THE SYSTEM SHALL show the error in the chat with actionable context
3. IF the application encounters an unrecoverable error, THE SYSTEM SHALL allow session restart

#### 8.2 Logging
1. WHEN errors occur, THE SYSTEM SHALL log them to `~/Library/Logs/Cowork Z/`
2. WHERE debugging is needed, THE SYSTEM SHALL provide access to logs via a menu option

---

## Future Enhancements

The following features are out of scope for the MVP but may be added in future versions:

### Network Isolation
- HTTP/SOCKS proxy for traffic inspection and filtering
- DNS resolution control
- Allowlist-based network access control

### Advanced Sandbox Security
- Linux-style namespace isolation (if cross-platform support added)
- Seccomp-BPF syscall filtering
- Resource limits (CPU, memory, execution time)

### Session Persistence
- Resume previous sessions with full context
- Session history browsing and search
- Export/import session data

### Multi-Language Runtimes
- Pre-configured Python environment
- Node.js runtime with package management
- Container-based execution environments

### Enhanced UI Features
- Three-panel layout with artifact preview
- File browser for session workspace
- Real-time process monitoring
- Suggested task templates/connectors

### MCP Server Integration
- Support for Model Context Protocol servers
- Custom MCP server configuration per agent

---

## Success Criteria

The Cowork Z MVP will be considered successfully implemented when:

1. Users can launch the application and interact with GPT-5 via the Copilot SDK
2. AI agents can execute basic tools (file read/write, bash commands, search) within the sandbox
3. The macOS App Sandbox prevents unauthorized filesystem access
4. Session workspaces are properly created and cleaned up
5. The chat interface displays messages, tool calls, and results clearly
6. Errors are handled gracefully with helpful user feedback
7. Basic configuration (API key, model, theme) can be customized
