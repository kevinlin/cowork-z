# UPDATE LOG

## v0.5.4

- **Rename sidebar "Tasks" section to "Todos"** — The CollapsibleSection in the sidebar that displays the agent's todo items is now labeled "Todos" instead of "Tasks" to avoid confusion with the task/session concept; empty state updated to "No active todos"
- **Synchronize skill catalog** — `scripts/sync-skills.mjs` synchronizes local skill templates from the upstream `anthropics/knowledge-work-plugins` repo

## v0.5.3 (2026-02-19)

- **3.1/6.4.1 Unified file click behavior** — File path links in chat messages and artefact clicks now open the in-app preview panel instead of Finder; added "Open Externally" button to the preview panel header for opening files with the OS default application
- **3.8 Slash Command Skill Invocation** — Typing `/` at the start of the task input or chat follow-up input opens an autocomplete popover of installed skills; selecting a skill renders it as a visual pill above the textarea, and on submit the prompt is prefixed with `/<skill-id>` for the agent to invoke the skill
- **4.2 New Themes: Nordic Light & Deep Space** — Added two new themes: Nordic Light (Scandinavian-inspired light theme and Deep Space (dark theme with blue-shifted backgrounds
- **Fix: CodePreview dark highlighting on light themes** — Code preview panel now uses `oneLight` syntax theme for light app themes and `oneDark` for dark themes, reacting to theme switches in real time via `useSyncExternalStore`
- **Fix: CodePrvidew file mapping** - Map file extensions ('json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf') as code instead of text files

## v0.5.2 (2026-02-18)

- **3.1 Rich File Display — Enhanced media path detection** — `extractMediaPaths` now auto-detects bare file paths for macOS/Linux (`/path/to/file`), home-relative (`~/path/to/file`), and Windows (`C:\path\to\file`) without requiring `file://` prefix; bare paths are also extracted from inside code blocks
- **Fix: Starter Packs not found on Windows** — Replaced git symlinks for pack resources (`src-tauri/resources/packs`, `pack-docs`) with direct copies from `workspace-packs/`; simplified `resolve_pack_sources()` to a single deterministic path
- **Install success toasts** — Successful starter pack installation shows a toast with the pack title and a prompt hint; successful skill install/re-install shows a toast confirming the skill is available to the agent
- Reduce gap (top) for text message bubbles

## v0.5.1

- **Skills Catalog Reorganization** — Renamed skill template folders with category prefixes (e.g., `social-content` → `marketing-social-content`, `canvas-design` → `design-canvas-design`) for consistent categorization; removed broken reference to non-existent `references/estimate.md` in `development-estimation` skill.

## v0.5.0 (2026-02-17)

- **6.1-6.3 Workspace-as-Folder** — Workspace-per-folder model where each workspace is a unique directory that becomes the AI agent's CWD, scopes sessions, and provides a file tree browser.
- **6.4 File Preview Panel** — Resizable right-side panel for previewing code (syntax-highlighted), Markdown, images, video, PDF, HTML, and text files from the file tree or chat media thumbnails; fullscreen mode; "Add to Chat" button inserts `@path` reference into chat input.
- **7.1–7.3 Workspace Starter Packs** — Home screen now features a "Starter Packs" browser (replacing the old example prompts) with 6 guided workspace packs. Users can search/filter packs, install them to any folder, and the app auto-creates a workspace and starts a task from the pack's START_HERE.md.
- **8.1–8.2 Starter Skills** — Browsable Skills Catalog on the Home screen below Starter Packs with category tabs, search, and install/re-install. Skills are bundled as templates and installed to `~/.config/opencode/skills/` with SHA256 checksum-based update detection.

## v0.4.5 (2026-02-17)

- **3.7.2 Tool Call Display** - Tool-use messages now render as collapsible cards showing tool name and input summary when collapsed, full input/output when expanded.
- **3.7.3 Question Handling** - Added `task:question_request` event handling with a dedicated question dialog. Streaming, permissions, and all existing functionality preserved.
- **3.7.4 Component Decomposition** — Rewrote the monolithic Execution.tsx into modular chat components (MessageList, MessageBubble, ToolCallCard, PermissionModal, QuestionDialog, ChatInput, ThinkingIndicator).
- **Fix: Tasks failing during permission waits** — Extended `sendMessage` timeout from 30s to 10 min since the endpoint blocks until the full agent turn completes (Req 1.2.1)
- **Fix: Default folder access not covering contents** — Default `~/Downloads` and `~/Desktop` permissions now use `/*` glob pattern (Req 1.3.2)
- **Fix: Tasks stalling on concurrent permission requests** — Replaced single `permissionRequest` field with a queue and pattern-based auto-approval for matching directory patterns (Req 1.3.1)
- **Fix: Tool call card overflowing chat width** — Added `min-w-0` constraints so `<pre>` content respects the max-width container instead of blowing out the layout (Req 3.7.2)

## v0.4.4 (2026-02-16)

- **Fix: Streaming messages not displayed in UI** — The sidecar `SessionManager` only listened to `message.part.updated` SSE events (which don't carry text deltas); added a `message.part.delta` listener so incremental text is accumulated and forwarded to the frontend.
- **Fix: Sidecar log files written to wrong directory on Windows** — The sidecar logger and process manager hardcoded `~/.local/share/opencode/log` (Unix convention); now uses `%LOCALAPPDATA%\opencode\log` on Windows to match the Rust-side logger, so all logs are co-located in one directory

## v0.4.3 (2026-02-16)

- **Refactor: Split lib.rs into modules** — Extracted the 2200-line monolithic `lib.rs` into a `types.rs` module for shared types and a `commands/` directory with 13 focused command modules.
- **1.1.5 OpenRouter Small-Model Pinning** — Fixed OpenCode using the wrong small model (Claude Haiku 4.5 via the built-in "opencode" provider) when an OpenRouter model is selected. 

## v0.4.2 (2026-02-15)

- **1.1.3 OpenRouter Provider Support** — Implemented OpenRouter Provider support with dynamic model selection from the OpenRouter API
- **1.1.4 Dynamic Model Discovery** — When connecting to Anthropic, OpenAI, Google AI, xAI, or DeepSeek, the app now fetches available models from the provider's API instead of using a hardcoded list. Fetched models are persisted and restored on settings reopen. Falls back to static defaults if the API is unreachable.
- **5.1 Windows Runtime Fixes (Phase 1)** — Platform-aware log directory, Windows PATH resolution (semicolon separators, case-insensitive dedup, well-known Windows tool directories), cross-platform sidecar build script, graceful sidecar shutdown for Windows process management

## v0.4.1 (2026-02-13)

- Security hardening: restricted login-shell PATH probing to a trusted shell allowlist in both Rust and sidecar runtimes, preventing untrusted `$SHELL` values from being executed
- Fix app update download 404: changed `tagName` in publish workflow from `app-v__VERSION__` to `v__VERSION__` so `latest.json` download URLs match the actual release tag

## v0.4.0 (2026-02-13)

- **2.4 OpenCode Server API Skill** — Bundled SKILL.md giving the agent self-introspection capabilities via the OpenCode server REST API (health, config, sessions, messages, todos, skills, MCP status); replaced hardcoded system prompt behavior blocks with a compact server-access pointer; skill auto-deployed to `~/.config/opencode/skills/` on every app launch
- Fix export log functionality in debug panel

## v0.3.1 (2026-02-12)

- Fix: Assign right entitlement to Tauri macOS build to fix sidecar binary crashing on start

## v0.3.0 (2026-02-12)

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

## v0.2.0 (2026-02-6)

- **OpenCode Sidecar Rewrite** — Replaced PTY-based OpenCode integration with HTTP/SSE client communicating via the OpenCode Server API; JSON-line IPC protocol between Rust and Node.js sidecar
- **1.1 Multi-Provider Support** — 13+ AI providers across direct API (Anthropic, OpenAI, Gemini, xAI, DeepSeek, Z.AI), cloud platforms (AWS Bedrock, Azure AI Foundry), local (Ollama), and proxy services (OpenRouter, LiteLLM); credentials stored in OS Keychain
- **1.2 Session Management** — Task creation, session persistence (messages, permissions, metadata) to SQLite, session resumption with restored conversation context and ad-hoc permissions, task history in sidebar
- **4.1 Settings** — Persistent settings in SQLite with immediate apply; configurable provider/model selection, per-provider API keys, folder permissions, skills folder path, and debug mode
- **5.3 Error Handling** — User-friendly API error messages, inline tool execution errors with actionable context, session restart on unrecoverable errors, platform-appropriate debug logging

## v0.1.0 (2026-02-01)

- Migrate from Electron to Tauri with OpenCode sidecar
