# UPDATE LOG

## v0.4.0

- 

## v0.3.1

- Fix: Assign right entitlement to Tauri macOS build to fix sidecar binary crashing on start

## v0.3.0

- **1.3 Permission System** — Granular folder-level access controls (read / read-write), runtime permission prompts when the agent requests access outside approved directories, per-session ad-hoc grants that persist on session resume
- **2.1 User Prompt Customization** — Settings panel with enable toggle and textarea to define a custom system prompt, injected as a `<user-instructions>` block on every message sent to the agent
- **2.2 Agent Skill Support** — Auto-discovery of SKILL.md files from `~/.config/opencode/skills/`, `.claude/skills/`, and `.agents/skills/` directories; clickable skills folder link in Settings
- **2.3 MCP Server Support** — Configure local (command-based) and remote (URL-based) MCP servers via the Settings UI; configurations persisted to database and pushed to OpenCode via `PATCH /config`; per-server enable/disable toggle
- **3.1 Rich File Display** — File paths in agent messages rendered as clickable links with extension-based icons; image and video thumbnails with in-app modal preview
- **3.2 Rich URL Display** — URLs in agent messages rendered as clickable links that open in the OS default browser
- **3.3 Task Todos Panel** — Collapsible sidebar panel showing the agent's task progress with status icons (pending, in-progress, completed, cancelled), progress bar, and auto-expand on new items
- **3.4 Artefacts Panel** — Sidebar panel tracking all files the agent creates or modifies during a session; click to open with OS default app; restored on session resume
- **3.5 Drag-and-Drop Support in Chat** — Drag files or folders from Finder/Explorer into the chat input to insert `@path/to/file` references; supports multiple files and paths with spaces
- **3.6 Multi-Line Text Input** — Auto-resizing textarea for chat input with `Shift+Enter` for newlines and `Enter` to submit
- **4.2 Theme Support** — Multiple predefined themes including dark mode; runtime switching without restart; defaults to dark theme when OS reports dark-mode preference
- **4.3 Keyboard Shortcuts** — `Cmd+N` / `Ctrl+N` new task, `Cmd+,` / `Ctrl+,` settings, `Cmd+Enter` / `Ctrl+Enter` send message, `Escape` cancel task; platform-aware modifier keys
- **4.4 About Panel** — App info panel with version and changelog accessible via Help > About menu
- **4.5 User Feedback** — In-app bug report and feature request buttons that open pre-filled GitHub Issues with environment metadata (app version, OS, architecture)
- **5.1 Cross-Platform Support** — macOS (ARM64 + x64), Windows (x64), and Linux (x64 + ARM64) builds; platform-appropriate data directories, keyboard modifiers, and installer formats; PATH resolution for GUI-launched contexts with login shell sourcing and well-known directory fallbacks
- **5.2 Security Hardening** — OpenCode server bound to random port on 127.0.0.1 with per-launch random password; HTTP basic auth between sidecar and server; all API keys stored in OS Keychain
- **5.3.3 Missing OpenCode CLI Detection** — Pre-flight CLI check before task execution with user-facing dialog showing install instructions; app remains usable for configuration while CLI is missing
- **5.4 App Update** — Signed update bundles via GitHub Releases; automatic check on app startup; update dialog with version info, release notes, and "Update Now" / "Later" options

## v0.2.0

- **OpenCode Sidecar Rewrite** — Replaced PTY-based OpenCode integration with HTTP/SSE client communicating via the OpenCode Server API; JSON-line IPC protocol between Rust and Node.js sidecar
- **1.1 Multi-Provider Support** — 13+ AI providers across direct API (Anthropic, OpenAI, Gemini, xAI, DeepSeek, Z.AI), cloud platforms (AWS Bedrock, Azure AI Foundry), local (Ollama), and proxy services (OpenRouter, LiteLLM); credentials stored in OS Keychain
- **1.2 Session Management** — Task creation, session persistence (messages, permissions, metadata) to SQLite, session resumption with restored conversation context and ad-hoc permissions, task history in sidebar
- **4.1 Settings** — Persistent settings in SQLite with immediate apply; configurable provider/model selection, per-provider API keys, folder permissions, skills folder path, and debug mode
- **5.3 Error Handling** — User-friendly API error messages, inline tool execution errors with actionable context, session restart on unrecoverable errors, platform-appropriate debug logging

## v0.1.0

- Migrate from Electron to Tauri with OpenCode sidecar
