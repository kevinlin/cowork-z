![Cowork-Z](src-tauri/icons/128x128.png)

# UPDATE LOG

## v0.5.10

- 

## v0.5.9 (2026-02-22)

-  Fix image in About Dialog

## v0.5.8 (2026-02-22)

- **GitHub Copilot Provider** — Added GitHub Copilot as a provider with OAuth device flow authentication
- **Expanded Theme Library** — 12 themes (up from 6): replaced Classic Light with Sage Garden as default, added Amber Glow, Ocean Depths, Rose Quartz, Midnight Ember, Sandstone, and Slate Noir; improved color consistency across all themes

## v0.5.7 (2026-02-21)

- **Skills Manager** — Dedicated window for managing Git-based skill repositories; register repos, browse discovered skills, and install/update/delete skills
- **Fix:** Resolved server startup timeout on Windows

## v0.5.6 (2026-02-20)

- **About button in sidebar** — Added About button to sidebar for easier access on all platforms
- **Simplified Chinese README** — Added full Simplified Chinese translation with language switcher links
- **Fix:** Resolved port conflicts on Windows caused by reserved system port ranges

## v0.5.5 (2026-02-20)

- **Keyboard Shortcuts Help** — Press `Shift+?` or use Help > Keyboard Shortcuts to view all shortcuts grouped by category
- **View Skill** — Added "View" button to skill cards in the Skills Catalog to preview the full skill definition before installing
- **Improved agent responses** — Assistant messages now display full content without truncation

## v0.5.4 (2026-02-19)

- **Renamed sidebar "Tasks" to "Todos"** — The sidebar section showing agent progress items is now labeled "Todos" to avoid confusion with tasks/sessions

## v0.5.3 (2026-02-19)

- **Unified file click behavior** — File links in chat messages and artefact clicks now open the in-app preview panel; added "Open Externally" button to open files with the OS default application
- **Slash Command Skills** — Type `/` at the start of the input to browse and select installed skills from an autocomplete popover; selected skills appear as a visual pill above the input
- **New Themes: Nordic Light & Deep Space** — Two new themes: Nordic Light (Scandinavian-inspired light theme) and Deep Space (dark theme with blue-shifted backgrounds)
- **Fix:** Code preview now uses the correct syntax highlighting for light and dark themes
- **Fix:** JSON, YAML, TOML, and config files now open with syntax highlighting in the preview panel

## v0.5.2 (2026-02-18)

- **Improved file path detection** — File paths in chat messages are now auto-detected on macOS, Linux, and Windows without requiring a `file://` prefix
- **Install success toasts** — Starter pack and skill installations now show confirmation toasts
- **Fix:** Starter Packs not found on Windows
- Reduced spacing between chat message bubbles

## v0.5.1

- **Skills Catalog Reorganization** — Skill categories are now consistently named and organized

## v0.5.0 (2026-02-17)

- **Workspace-as-Folder** — Each workspace is tied to a folder that becomes the AI agent's working directory, scopes sessions, and provides a file tree browser in the sidebar
- **File Preview Panel** — Resizable right-side panel for previewing code (syntax-highlighted), Markdown, images, video, PDF, HTML, and text files; fullscreen mode; "Add to Chat" button inserts a file reference into chat input
- **Workspace Starter Packs** — Home screen features a "Starter Packs" browser with guided workspace packs; search/filter packs, install to any folder, and the app auto-creates a workspace and starts a task
- **Skills Catalog** — Browsable Skills Catalog on the Home screen with category tabs, search, and install/re-install

## v0.4.5 (2026-02-17)

- **Tool Call Display** — Tool-use messages now render as collapsible cards showing tool name and summary when collapsed, full details when expanded
- **Question Handling** — The agent can now ask clarifying questions via a dedicated dialog during task execution
- **Fix:** Tasks no longer fail while waiting for permission approval
- **Fix:** Default folder permissions now correctly cover folder contents
- **Fix:** Multiple concurrent permission requests are now handled properly
- **Fix:** Tool call cards no longer overflow the chat width

## v0.4.4 (2026-02-16)

- **Fix:** Streaming messages now display correctly in the chat UI
- **Fix:** Log files are now written to the correct directory on Windows

## v0.4.3 (2026-02-16)

- **Fix:** OpenRouter provider now correctly uses the selected small model instead of falling back to a default

## v0.4.2 (2026-02-15)

- **OpenRouter Provider** — Added OpenRouter as a provider with dynamic model selection
- **Dynamic Model Discovery** — Connecting to Anthropic, OpenAI, Google AI, xAI, or DeepSeek now fetches available models from the provider's API instead of using a hardcoded list
- **Windows compatibility improvements** — Improved log directory handling, PATH resolution, and process management on Windows

## v0.4.1 (2026-02-13)

- Security hardening for shell environment handling
- **Fix:** App update downloads now resolve correctly

## v0.4.0 (2026-02-13)

- **Agent Self-Introspection Skill** — Bundled skill giving the agent awareness of its own sessions, todos, skills, and MCP status
- **Fix:** Export log functionality in debug panel

## v0.3.1 (2026-02-12)

- **Fix:** Resolved app crash on macOS at startup

## v0.3.0 (2026-02-12)

- **Permission System** — Granular folder-level access controls (read / read-write); runtime permission prompts when the agent requests access outside approved directories; per-session grants that persist on session resume
- **User Prompt Customization** — Define a custom system prompt in Settings to guide agent behavior on every message
- **Agent Skill Support** — Auto-discovery of installed skills; clickable skills folder link in Settings
- **MCP Server Support** — Configure local and remote MCP servers via Settings with per-server enable/disable toggle
- **Rich File Display** — File paths in agent messages rendered as clickable links with icons; image and video thumbnails with in-app modal preview
- **Rich URL Display** — URLs in agent messages rendered as clickable links that open in the default browser
- **Task Todos Panel** — Sidebar panel showing the agent's task progress with status icons, progress bar, and auto-expand on new items
- **Artefacts Panel** — Sidebar panel tracking all files the agent creates or modifies; click to open; restored on session resume
- **Drag-and-Drop in Chat** — Drag files or folders from Finder/Explorer into the chat input to attach them
- **Multi-Line Text Input** — Auto-resizing textarea with `Shift+Enter` for newlines and `Enter` to submit
- **Theme Support** — Multiple predefined themes including dark mode; runtime switching without restart; follows OS preference by default
- **Keyboard Shortcuts** — `Cmd+N` new task, `Cmd+,` settings, `Cmd+Enter` send message, `Escape` cancel task (platform-aware modifier keys)
- **About Panel** — Version and changelog accessible via Help > About
- **User Feedback** — In-app bug report and feature request buttons that open pre-filled GitHub Issues
- **Cross-Platform Support** — macOS (ARM64 + x64), Windows (x64), and Linux (x64 + ARM64) builds
- **Security** — API keys stored in OS Keychain; server bound to localhost with per-launch authentication
- **Missing CLI Detection** — Pre-flight check before task execution with install instructions if OpenCode CLI is not found
- **App Update** — Automatic update check on startup with version info, release notes, and install options

## v0.2.0 (2026-02-06)

- **Multi-Provider Support** — 13+ AI providers: Anthropic, OpenAI, Gemini, xAI, DeepSeek, Z.AI, AWS Bedrock, Azure AI Foundry, Ollama, OpenRouter, and LiteLLM; credentials stored in OS Keychain
- **Session Management** — Task creation, session persistence, and session resumption with restored conversation context and permissions; task history in sidebar
- **Settings** — Configurable provider/model selection, per-provider API keys, folder permissions, skills folder path, and debug mode
- **Error Handling** — User-friendly error messages, inline tool execution errors with actionable context, and session restart on unrecoverable errors

## v0.1.0 (2026-02-01)

- Initial release — Tauri desktop app with OpenCode AI agent integration
