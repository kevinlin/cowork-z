![Cowork-Z](src-tauri/icons/128x128.png)

# UPDATE LOG

## v0.8.3

- 

## v0.8.2 (2026-06-27)

- **Fix: macOS release pipeline failures** — Two failures broke the v0.8.2 macOS release. Builds compiled, signed, and notarized but crashed on entering DMG bundling, because a dependency override pulled in a version that needed a newer Node than the release workflow ran; the override was constrained to a compatible line. Separately, parallel release jobs raced while uploading assets and merging the auto-update metadata, dropping the Apple Silicon entry; the jobs were serialized so each platform updates the shared release in order.

## v0.8.1 (2026-06-27)

- **Address findings from the 2026-06-12 technical review** — A second security, reliability, and performance pass across the app:
  - Hardened the Content Security Policy and tightened how previews and embedded plugin content load, so a markup bug can no longer escalate to running arbitrary code.
  - Storage failures (bad reads, lock errors, mid-migration faults) now surface as errors and roll back cleanly instead of crashing the app or leaving the database half-migrated; writes aimed at a task that doesn't exist are rejected.
  - Live streaming no longer re-renders or re-parses the whole conversation on every update, so long sessions stay responsive.
  - Task and session lifecycle is more robust: a superseded session is aborted before cleanup so it stops consuming tokens, failed turns and undelivered permission replies surface as errors instead of hanging, commands wait for the sidecar's readiness handshake and run one at a time, and a crashed sidecar is respawned on the next task.
  - The file watcher now picks up changes in nested folders, async event listeners are cancelled when their component unmounts, and deleting a task frees its todos, artefacts, and streaming state.
  - The app keeps its OpenCode configuration in its own private directory (cleaning up stale files from older versions) and never modifies the user's global config; a saved Ollama key is now actually used.
  - Secrets stay out of prompts and logs: the server password is referenced through an environment variable instead of embedded in the prompt, API keys cross the process boundary only when they change, and logs and the debug panel no longer record key material or conversation content.
  - Path handling is locked down: opening, revealing, previewing, and listing files all pass the same validation, workspace paths must resolve under approved roots, and skill identifiers can't be used for path traversal.
  - Dependencies and CI: Tauri packages and Rust crates are pinned to compatible ranges, weekly vulnerability scanning and a CI audit step were added, known-vulnerable dependencies were updated, and CI now typechecks, builds, lints, and tests on Linux and macOS.

## v0.8.0 (2026-06-12)

- **Workspace convention aligned with folder governance** — `Misc/` is now approval-gated for edits (was read-only), so the agent can promote curated scripts and prompt experiments from `Output/` into `Misc/` after the user approves. The conventions shown to the agent now describe `Misc/` as holding both static user assets (icons, logos, brand images, fonts) and curated utilities, with two promotion paths: governed deliverables go to `Artefacts/`, curated utilities go to `Misc/`.
- **Address findings from technical review** — Security hardening, bug fixes, and performance improvements across the app:
  - Quitting the app no longer leaves the OpenCode server running with API keys in its environment and a live listening port.
  - Enabled a restrictive Content Security Policy and tightened the HTML preview sandbox and asset-loading scope, so an injection bug can't escalate to running arbitrary scripts or reaching arbitrary files.
  - File read, trash, and export now validate paths against registered workspaces and granted folders, with exports routed through a native save dialog; unused shell permissions were removed from both windows.
  - Secrets stay out of storage and logs: Git tokens are no longer written to skill-repo config (and ones saved earlier are scrubbed), MCP secrets and payloads are redacted by default, the server password is never logged, and key-change detection compares fingerprints instead of raw keys.
  - API keys added or rotated mid-session now take effect by restarting the server instead of being ignored until the next launch; Azure Foundry keys are stored under a standard id (migrating older entries) and forwarded correctly; MCP config updates reach the right server instance.
  - Reliability and UI fixes: event-stream reconnects use capped exponential backoff, task completion is handled by a single listener (no duplicate writes), the debug log panel mounts only in debug mode and caps its history, `file://` links and chat auto-scroll work again, multi-folder permission grants are no longer dropped, and a crash in the streaming chat view was fixed.

## v0.7.14 (2026-05-26)

- **Four-folder workspace convention** — Workspaces now have four root-level convention folders: `Input/` (read-only source material), `Output/` (scratchpad with category subfolders), `Misc/` (read-only static assets like icons and images), and `Artefacts/` (curated deliverables promoted from `Output/`, where each save needs user approval). The agent auto-creates any missing folders.
- **Fix: Automation runs list pushed pinned sidebar panels off-screen** — A long list of automation runs grew the panel vertically and pushed the pinned Folders and Todos sections below the viewport; the runs list now scrolls within its own area so the pinned sections stay visible regardless of run count.

## v0.7.13 (2026-05-11)

- **`Development` skill category** — Added a green-badged `Development` category for software-engineering skills (code review, debugging, TDD, refactor, lint, spec-driven development, and similar), which now show a meaningful colored badge in the Skills Manager and Home catalog instead of falling back to `General`.
- **Always-on "Others" answer for agent questions** — Agent questions now always include a synthetic free-text "Others" option (skipped only when the agent already offers an "Other" choice or supplies no options). In multi-select questions the input appears inline so it can coexist with checkbox selections.
- **Fix: OpenCode 1.14.x event stream closing immediately** — On OpenCode 1.14.x the agent's event stream shut down right after connecting, so no messages reached the UI. The sidecar now subscribes to the long-lived global event endpoint and filters events by workspace in process.

## v0.7.12 (2026-05-09)

- **Open repo site from Skills Manager toolbar** — When a repo is selected in the Skills Manager dropdown, a new external-link button opens that repo's GitHub/GitLab page in the default browser. Supports HTTPS and SSH Git URLs; the resolved web URL shows in a tooltip on hover.
- **Normalize skill repo URLs** — Removed the `.git` suffix from curated skill repo URLs in the Skills Catalog, and added a migration so previously-registered repos match the updated entries.
- **Camel case workspace default folders** — Renamed workspace convention folders from `input/` → `Input/` and `output/` → `Output/` for visual consistency; updated the system prompt, permission rules, and all documentation references.

## v0.7.11 (2026-05-08)

- **Fix: Automations fire in bursts after the app is backgrounded (release builds)** — In macOS release builds, leaving the app in the background caused an automation to silently queue about one pending run per minute, then dispatch all queued runs back-to-back when the app returned to the foreground.

## v0.7.10 (2026-05-08)

- **`skills.sh` deep link on Skills Manager cards** — Every skill card in Skills Manager now shows a `skills.sh` link next to the existing `View` link, opening the matching public listing on [skills.sh](https://skills.sh/) in the default browser. The full URL shows in a tooltip on hover.
- **Refactor: shared filesystem helpers** — Consolidated duplicated directory-copy and checksum logic shared between packs and skills into one module.

## v0.7.9 (2026-05-07)

- **Polished card hover interactions** — Curated repo cards, starter pack cards, and skill cards now share a consistent shadow and lift-on-hover effect, with the Skills Catalog "Open" arrow nudging on hover.
- **Full-text tooltips on truncated card content** — Clamped descriptions, truncated skill names, and skill paths now reveal the complete text in a tooltip (400 ms delay) on hover.
- **Skill card action row alignment** — The "View / Install / Re-install / Update / Delete" buttons now right-align consistently across every action state.
- **Standardised search inputs** — Skills Catalog and Starter Packs now use the shared input component, so focus rings, disabled states, and dark-mode handling stay in lockstep with the rest of the app.

## v0.7.8 (2026-05-07)

- **Smarter Skills Manager category badges** — Skill categories are now inferred from the skill name (matched against the known category list), falling back to the source repo's categories, then the path-derived category, then `General`. Repos that don't follow the standard folder convention now show meaningful, color-coded badges that line up with the filter tabs.

## v0.7.7 (2026-05-07)

- **Skills Catalog redesign — Curated repo browser** — The Home tab "Skills Catalog" now lists hand-picked Git skill repositories (Anthropic, OpenAI, Vercel, and others) instead of bundled individual skills. Clicking a card opens the Skills Manager and either selects the repo (if already added) or clones it, then filters the toolbar dropdown to it. Bundled skill templates and the manual sync script have been retired; all skill discovery and install now flows through the Skills Manager.

## v0.7.6 (2026-05-06)

- **Fix: All automation runs incorrectly shown as "Has findings"** — The findings indicator now inspects the agent's final response for "no findings" phrases instead of marking every completed run as having findings.
- **Fix: Automation form freezes and pending runs pile up after a run completes** — A scheduler bug caused a self-deadlock that permanently blocked the worker thread, preventing all later commands from running; the form now also disables the Save button while a save is in flight to prevent duplicate submissions.

## v0.7.5 (2026-05-02)

- **Fix: Automation schedules firing at UTC instead of local time** — The scheduler now evaluates cron expressions against the system's local timezone.

## v0.7.4 (2026-05-02)

- **Per-automation scheduler threads** — Reworked the automation scheduler from a single shared queue thread to one dedicated thread per active automation, each sleeping precisely until its next fire time. Creating, updating, toggling, or deleting an automation instantly stops or restarts the relevant thread, and next run times are computed by the backend.
- **Fix: Invalid custom cron expressions silently accepted** — The automation form now validates cron expressions in real time using the same normalization the scheduler uses, showing an error and blocking save on invalid input.

## v0.7.3 (2026-05-01)

- **Compact automation run items** — Sidebar automation run items now display as a single row (name, status, time) instead of two rows; status text truncates with an ellipsis when space is tight.
- **Fix: Automations scheduled on weekdays not triggering** — A day-of-week numbering mismatch in the scheduler meant weekday schedules never fired on the correct days.

## v0.7.2 (2026-05-01)

- **Next run time on automation cards** — Automation cards on the Home tab now show the next scheduled run time; daily automations show just the time (e.g., "9:00 AM"), weekly automations show the weekday and time (e.g., "Monday 9:00 AM"), and disabled automations hide the indicator.
- **Fix: Custom cron schedules not saved** — Custom cron expressions (e.g., `*/5 * * * *`) were saved as empty strings, so the scheduler rejected them; the custom cron input now saves correctly.
- **Fix: Editing custom-schedule automations defaults to Daily** — Opening the edit form for a custom-cron automation now detects the frequency correctly and defaults the picker to "Custom" with the expression pre-filled.
- **Fix: Scheduled automation tasks never started** — Scheduled and queued automation runs were created with a "running" status but never actually started a task, so they showed "Running..." with no execution; both now create, link, and dispatch the task the same way as a manual run, which now shares one dispatch path.

## v0.7.1 (2026-04-30)

- **Automation enable/disable toggle** — The Automations card now shows an inline toggle for quick enable/disable without opening the dropdown menu; disabled automations are not triggered by the scheduler.
- **Fix: Automation run status not updating after task completion** — Automation runs were stuck showing "Running..." after the task completed because completing the task never marked the associated run as complete.

## v0.7.0 (2026-04-30)

- **Automations** — Scheduled AI automations: creation and management on the Home tab, cron-based scheduling, a run triage panel in the Sidebar, and filtering of automation-triggered tasks out of the regular Sessions tab.

## v0.6.11 (2026-04-27)

- **Categorized output subfolders** — The system prompt now requires the agent to organize every new file under a category subfolder, reusing existing categories when they fit and picking short, kebab-case names, so workspace artefacts stay grouped instead of dumped into `Output/` root.
- **Fix: Symlink-installed skills not appearing in slash command autocomplete** — Skills installed via the Skills Manager on macOS/Linux (which use symbolic links) weren't recognized as installed, so they were excluded from the `/` autocomplete; install detection now handles both copy-based and symlink-based installs.
- **Fix: Custom skills in `~/.config/opencode/skills` not appearing in slash command autocomplete** — User-copied skill folders (and skills from custom repos that don't ship as bundled templates) were missing from the `/` autocomplete popover.

## v0.6.10 (2026-04-25)

- **File tree item action buttons** — Every row in the file tree shows Open and Delete buttons on hover; folders open in Finder/Explorer, files open with the default app, and delete moves both files and folders to the system trash with an immediate tree refresh.
- **Symbolic link support in file tree** — Symlinks (macOS/Linux) are now detected and shown with a link overlay badge; symlinked folders expand to show the linked directory's contents.
- **Symlink-based skill installation (macOS/Linux)** — Installing skills from repos now creates a symbolic link instead of copying files, so installed skills always reflect the latest synced cache; deletion is symlink-aware to avoid removing the cache.

## v0.6.9 (2026-04-25)

- **Expandable arena sessions in sidebar** — Arena entries in the Sessions panel now show a disclosure triangle that expands to reveal the 3 individual chat sessions; clicking a child session opens the standard chat view, while clicking the arena row opens the tabbed Arena view.

## v0.6.8 (2026-04-22)

- **Fix: Auto-create target skills folder on switching** — Switching the Skills Manager target folder now creates the destination directory if it doesn't exist yet.
- **Auto-scroll on session resume** — Opening an existing chat now jumps to the bottom of the conversation so the latest messages are visible immediately.
- **Fix: Arena sidebar status auto-refresh** — Arena session entries in the Sessions panel now update automatically as child tasks change state (running, completed, failed, interrupted) instead of staying stuck in the initial running state.

## v0.6.7 (2026-04-21)

- **Mandatory workspace context in system prompt** — The agent is always told the current workspace path and instructed to create every new file under `<workspace>/Output/` (including files created via bash), never at the workspace root or in `Input/`.
- **Cursor-aware slash commands** — The slash-command skill picker now triggers whenever `/` is typed after whitespace (or at the start of input), not only at the very start; the filter uses just the text between `/` and the caret, and selecting a skill removes only the `/query` token while preserving the surrounding prose.
- **Multi-skills support** — Multiple skills can be referenced per message; each appears as its own pill above the textarea and is prefixed in the composed prompt.

## v0.6.6 (2026-04-13)

- **Clickable skill pill** — Clicking a selected skill's name in its pill opens its definition in the file preview panel, following OpenCode's skill discovery order (project-level, global, then bundled templates).
- **Arena slash commands** — The Arena input bar now supports `/` slash-command skill invocation with autocomplete, skill pill, and prompt composition, matching the other input bars.

## v0.6.5 (2026-04-08)

- **Convention-based workspace permissions** — The workspace `Input/` folder is now read-only and `Output/` is explicitly writable. Permission approvals are remembered at the workspace level and applied automatically to future tasks in the same workspace.
- **Arena completion tracking** — An arena is automatically marked complete when all 3 child tasks reach a terminal state (completed, failed, or interrupted).

## v0.6.4 (2026-04-06)

- **High-priority todo indicator** — Changed the high-priority badge in the Todos panel from a red `!` (which looked like an error) to an amber `↑` arrow with a softer amber background.
- **Fix: GitLab PAT authentication for skill repos** — Private GitLab repositories (self-hosted or gitlab.com) now authenticate correctly using the URL format GitLab HTTP auth requires.
- **Remove skill repo from Skills Manager** — Added a "Remove" button to the Skills Manager toolbar (visible when a repo is selected) to delete a registered skill repository, its cached clone, and stored credentials.

## v0.6.3 (2026-03-28)

- **Fix: Arena sidebar visibility** — Arena sessions now appear in the sidebar immediately after creation instead of requiring an app restart.
- **Arena tabbed layout** — Arena columns were replaced with a tabbed view; each tab shows a model name and status and displays one model's output at a time.

## v0.6.2 (2026-03-28)

- **Fix: Arena tool call card spacing** — Consecutive tool call cards in Arena mode now use the same tight spacing as normal chat instead of the wider gap applied to all messages.
- **Fix: Arena file reference handling** — The Arena input bar now supports the "Add to Chat" button from the file preview panel and drag-and-drop of files from the sidebar file tree and OS file manager, inserting `@path` references at the cursor, matching the other input bars.

## v0.6.1 (2026-03-22)

- **Fix: Arena question requests** — Agent questions (e.g., asking the user to choose an output folder) are now handled in Arena mode; previously the question was silently dropped and the agent hung waiting for a response.
- **Tool call cards redesign** — Tool call rows were restyled with reduced padding, a borderless design, and smaller icons; hover reveals copy and expand controls, and file-based tools (Read, Write, Edit) show an "Open in file viewer" button on hover.

## v0.6.0 (2026-03-22)

- **Arena — Side-by-Side Agent Comparison** — Compare 3 AI models on the same prompt at once; pick a model for each column via the full provider settings panel, submit a prompt, and watch all 3 agents stream responses in a 3-column layout. Arena sessions appear in the sidebar with a distinct icon and support follow-up messages to all agents at once.
- **Arena chat history persistence** — Full chat history from all 3 agents is now retained across follow-ups and persisted to the database for reload.
- **Enhanced MCP Server Settings** — MCP configuration now shows each server as a card with real-time status indicators (connected/failed/disabled), per-server toggles, expandable tool listings, and add/edit/remove actions, plus a JSON fallback view for power users.
- **Fix: infinite compaction loop** — Added compaction loop detection with a retry threshold.
- **Improved dialog readability** — Reduced backdrop blur and opacity on question and permission dialogs so main-window content stays readable; dialogs are now draggable to reveal covered content.

## v0.5.15 (2026-03-19)

- **Standardized log file naming** — The TypeScript sidecar log file now matches the Rust sidecar's filename format for consistent sorting and easier correlation.
- **New Starter Packs** — Added Data Visualization and Finance Analysis starter packs.

## v0.5.14 (2026-03-11)

- **Add find-skills to Skills Catalog** — Helps users discover and install agent skills.
- **Settings dialog layout** — Aligned the Settings dialog width and padding with the Task Launcher for visual consistency across dialogs.
- **Update skills in Skills Catalog** — Synced the latest changes to the `skill-creator` and `brainstorming` skills.

## v0.5.13 (2026-02-28)

- **Fix: Intermediate assistant messages not persisted** — Multi-step agent sessions now correctly save all intermediate assistant messages.
- **Fix: Long-running task false failure** — Conversations running longer than 10 minutes no longer incorrectly show "Failed"; session lifecycle is now managed entirely through the event stream.
- **Fix: Tool call card input/output** — Tool call cards now persist and display input and output correctly, update in place as they transition from pending to completed, and show a skill tool display with an icon.

## v0.5.12 (2026-02-28)

- **Fix: Stop button** — The Stop button and Escape key now correctly abort running tasks.
- **Fix: Cross-task message leakage** — Messages from failed or stuck sessions no longer appear in newly started tasks.
- **Fix: Question reply stuck** — Answering an agent question prompt no longer causes the task to hang.
- **Fix: Multi-select question dialog** — Fixed display and handling of agent questions with multiple-choice answers.
- **Fix: Markdown table rendering** — Tables and other block-level markdown in agent responses now render correctly even when not preceded by a blank line.
- **Update skills in Skills Catalog** — Synced from the latest source repos.

## v0.5.11 (2026-02-24)

- **Fix: Streaming message duplication** — Multi-step agent turns no longer display as repeated message blocks; partial messages are now finalized correctly between steps.

## v0.5.10 (2026-02-24)

- **Fix: Handle pre-existing skills repo** — Re-adding a previously removed skill repository no longer fails.
- **New skills in Skills Catalog** — Added `planning-with-files` and `skill-creator`.
- **Rename Conversations** — Right-click a conversation in the sidebar to rename it via inline editing.

## v0.5.9 (2026-02-22)

- Fixed the image in the About dialog.

## v0.5.8 (2026-02-21)

- **GitHub Copilot Provider** — Added GitHub Copilot as a provider with OAuth device flow authentication.
- **Expanded Theme Library** — 12 themes (up from 6): replaced Classic Light with Sage Garden as the default, added Amber Glow, Ocean Depths, Rose Quartz, Midnight Ember, Sandstone, and Slate Noir, and improved color consistency across all themes.

## v0.5.7 (2026-02-21)

- **Skills Manager** — A dedicated window for managing Git-based skill repositories: register repos, browse discovered skills, and install/update/delete skills.
- **Fix:** Resolved server startup timeout on Windows.

## v0.5.6 (2026-02-20)

- **About button in sidebar** — Added an About button to the sidebar for easier access on all platforms.
- **Simplified Chinese README** — Added a full Simplified Chinese translation with language switcher links.
- **Fix:** Resolved port conflicts on Windows caused by reserved system port ranges.

## v0.5.5 (2026-02-20)

- **Keyboard Shortcuts Help** — Press `Shift+?` or use Help > Keyboard Shortcuts to view all shortcuts grouped by category.
- **View Skill** — Added a "View" button to skill cards in the Skills Catalog to preview the full skill definition before installing.
- **Improved agent responses** — Assistant messages now display full content without truncation.

## v0.5.4 (2026-02-19)

- **Renamed sidebar "Tasks" to "Todos"** — The sidebar section showing agent progress items is now labeled "Todos" to avoid confusion with tasks/sessions.

## v0.5.3 (2026-02-19)

- **Unified file click behavior** — File links in chat messages and artefact clicks now open the in-app preview panel; added an "Open Externally" button to open files with the OS default application.
- **Slash Command Skills** — Type `/` at the start of the input to browse and select installed skills from an autocomplete popover; selected skills appear as a visual pill above the input.
- **New Themes: Nordic Light & Deep Space** — A Scandinavian-inspired light theme and a dark theme with blue-shifted backgrounds.
- **Fix:** Code preview now uses the correct syntax highlighting for light and dark themes.
- **Fix:** JSON, YAML, TOML, and config files now open with syntax highlighting in the preview panel.

## v0.5.2 (2026-02-18)

- **Improved file path detection** — File paths in chat messages are now auto-detected on macOS, Linux, and Windows without requiring a `file://` prefix.
- **Install success toasts** — Starter pack and skill installations now show confirmation toasts.
- **Fix:** Starter Packs not found on Windows.
- Reduced spacing between chat message bubbles.

## v0.5.1 (2026-02-18)

- **Skills Catalog Reorganization** — Skill categories are now consistently named and organized.

## v0.5.0 (2026-02-17)

- **Workspace-as-Folder** — Each workspace is tied to a folder that becomes the AI agent's working directory, scopes sessions, and provides a file tree browser in the sidebar.
- **File Preview Panel** — A resizable right-side panel for previewing code (syntax-highlighted), Markdown, images, video, PDF, HTML, and text files, with a fullscreen mode and an "Add to Chat" button that inserts a file reference into chat input.
- **Workspace Starter Packs** — The Home screen features a "Starter Packs" browser with guided workspace packs; search and filter packs, install to any folder, and the app auto-creates a workspace and starts a task.
- **Skills Catalog** — A browsable Skills Catalog on the Home screen with category tabs, search, and install/re-install.

## v0.4.5 (2026-02-17)

- **Tool Call Display** — Tool-use messages now render as collapsible cards showing the tool name and a summary when collapsed, and full details when expanded.
- **Question Handling** — The agent can now ask clarifying questions via a dedicated dialog during task execution.
- **Fix:** Tasks no longer fail while waiting for permission approval.
- **Fix:** Default folder permissions now correctly cover folder contents.
- **Fix:** Multiple concurrent permission requests are now handled properly.
- **Fix:** Tool call cards no longer overflow the chat width.

## v0.4.4 (2026-02-15)

- **Fix:** Streaming messages now display correctly in the chat UI.
- **Fix:** Log files are now written to the correct directory on Windows.

## v0.4.3 (2026-02-15)

- **Fix:** The OpenRouter provider now correctly uses the selected small model instead of falling back to a default.

## v0.4.2 (2026-02-14)

- **OpenRouter Provider** — Added OpenRouter as a provider with dynamic model selection.
- **Dynamic Model Discovery** — Connecting to Anthropic, OpenAI, Google AI, xAI, or DeepSeek now fetches available models from the provider's API instead of using a hardcoded list.
- **Windows compatibility improvements** — Improved log directory handling, PATH resolution, and process management on Windows.

## v0.4.1 (2026-02-13)

- Security hardening for shell environment handling.
- **Fix:** App update downloads now resolve correctly.

## v0.4.0 (2026-02-13)

- **Agent Self-Introspection Skill** — A bundled skill giving the agent awareness of its own sessions, todos, skills, and MCP status.
- **Fix:** Export log functionality in the debug panel.

## v0.3.1 (2026-02-12)

- **Fix:** Resolved an app crash on macOS at startup.

## v0.3.0 (2026-02-12)

- **Permission System** — Granular folder-level access controls (read / read-write), runtime permission prompts when the agent requests access outside approved directories, and per-session grants that persist on session resume.
- **User Prompt Customization** — Define a custom system prompt in Settings to guide agent behavior on every message.
- **Agent Skill Support** — Auto-discovery of installed skills and a clickable skills folder link in Settings.
- **MCP Server Support** — Configure local and remote MCP servers via Settings with a per-server enable/disable toggle.
- **Rich File Display** — File paths in agent messages render as clickable links with icons; image and video thumbnails open in an in-app modal preview.
- **Rich URL Display** — URLs in agent messages render as clickable links that open in the default browser.
- **Task Todos Panel** — A sidebar panel showing the agent's task progress with status icons, a progress bar, and auto-expand on new items.
- **Artefacts Panel** — A sidebar panel tracking all files the agent creates or modifies; click to open, restored on session resume.
- **Drag-and-Drop in Chat** — Drag files or folders from Finder/Explorer into the chat input to attach them.
- **Multi-Line Text Input** — An auto-resizing textarea with `Shift+Enter` for newlines and `Enter` to submit.
- **Theme Support** — Multiple predefined themes including dark mode, with runtime switching (no restart) that follows OS preference by default.
- **Keyboard Shortcuts** — `Cmd+N` new task, `Cmd+,` settings, `Cmd+Enter` send message, `Escape` cancel task (platform-aware modifier keys).
- **About Panel** — Version and changelog accessible via Help > About.
- **User Feedback** — In-app bug report and feature request buttons that open pre-filled GitHub Issues.
- **Cross-Platform Support** — macOS (ARM64 + x64), Windows (x64), and Linux (x64 + ARM64) builds.
- **Security** — API keys stored in the OS Keychain; the server is bound to localhost with per-launch authentication.
- **Missing CLI Detection** — A pre-flight check before task execution with install instructions if the OpenCode CLI is not found.
- **App Update** — Automatic update check on startup with version info, release notes, and install options.

## v0.2.0 (2026-02-06)

- **Multi-Provider Support** — 13+ AI providers: Anthropic, OpenAI, Gemini, xAI, DeepSeek, Z.AI, AWS Bedrock, Azure AI Foundry, Ollama, OpenRouter, and LiteLLM; credentials stored in the OS Keychain.
- **Session Management** — Task creation, session persistence, and session resumption with restored conversation context and permissions; task history in the sidebar.
- **Settings** — Configurable provider/model selection, per-provider API keys, folder permissions, skills folder path, and debug mode.
- **Error Handling** — User-friendly error messages, inline tool execution errors with actionable context, and session restart on unrecoverable errors.

## v0.1.0 (2026-02-01)

- Initial release — Tauri desktop app with OpenCode AI agent integration.
