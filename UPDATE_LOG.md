![Cowork-Z](src-tauri/icons/128x128.png)

# UPDATE LOG

## v0.7.15

- **Fix: Orphaned `opencode serve` process on app shutdown** — Quitting the app could leave `opencode serve` running with API keys in its environment and a live listening port.

- **Fix: Chat auto-scroll never fired on new/streaming messages (#23)** — The Execution page's auto-scroll effect queried `[data-messages-end]`, but the sentinel div in `MessageList` never carried that attribute, so `querySelector` always returned `null` and only the one-time on-load jump and the manual scroll-to-bottom button worked. The sentinel now has `data-messages-end`. (Technical review finding #23.)

- **Fix: CI silently discarded lint failures (#16)** — The CI "Run frontend lint and tests" step backgrounded `pnpm ultracite:check` with a single `&`, so only the test exit code gated the build and lint/format violations could never fail CI. Changed to `&&` so both checks are blocking. (Technical review finding #16.)

- **Workspace convention aligned with `rfp-daily` folder governance** — `Misc/` is now `edit: ask` (was `edit: deny`) so the agent can promote curated supporting scripts and prompt experiments from `Output/` to `Misc/` after user approval, matching the four-tier governance model in `~/dev/ai-sdlc/zapac-agent-skills/rfp-daily/assets/folder_governance.md`. The `<workspace-conventions>` system prompt block now documents `Misc/` as holding both static user assets (icons, logos, brand images, fonts) **and** curated utilities promoted from `Output/`, and describes the dual promotion workflow (`Output/` → `Artefacts/<category>/` for governed deliverables, `Output/` → `Misc/<topic>/` like `Misc/scripts/` or `Misc/prompt-experiments/` for curated utilities). `mkdir -p` first-action still seeds all four folders silently because bash is not gated by the `edit` permission. Config-builder test updated; all 93 sidecar tests pass.


## v0.7.14

- **Four-folder workspace convention** — Workspaces now have four root-level convention folders: `Input/` (read-only source material), `Output/` (scratchpad with category subfolders), `Misc/` (read-only static assets like icons/images, `edit: deny`), and `Artefacts/` (curated deliverables, typically promoted from `Output/`, gated by `edit: ask` so the user approves each save). The agent auto-creates any missing folders.`

- **Fix: Automation runs list pushed pinned sidebar panels off-screen** — `AutomationRunsPanel` used `h-full` on its root, which in a flex column layout grows with content rather than constraining to the parent's remaining space. With many runs, the panel expanded vertically and pushed the pinned `FoldersPanel` and `Todos` sections below the viewport. The panel now uses `min-h-0 flex-1 flex-col overflow-hidden` (matching `SessionPanel`/`FileTreePanel`), so only the runs list scrolls and the pinned sections stay visible regardless of run count.

## v0.7.13

- **`Development` skill category** — Added a new green-badged `Development` category for software-engineering skills (code review, debugging, TDD, refactor, lint, spec-driven development, ADRs, changelog, etc.), which now derive a meaningful colored badge in the Skills Manager grid and Home catalog instead of falling back to `General`.
- **Always-on "Others" answer for agent questions** — `QuestionDialog` now appends a synthetic `Others` free-text option to every agent question (skipped only when the agent already provides a case-insensitive `Other`/`Others` choice, or supplies no options at all). In multi-select questions the input renders inline so it can coexist with checkbox selections.
- **Fix: OpenCode 1.14.x SSE stream closing immediately** — Switched the sidecar's event stream from the per-instance `/event` endpoint to `/global/event` (backed by long-lived `GlobalBus`). OpenCode 1.14.x bound `/event`'s wildcard PubSub to per-request Effect scope lifecycle, so its finalizer published `server.instance.disposed` and shut down the stream after the very first `server.connected` frame — no `session.*` / `message.*` events ever reached the frontend. `EventStream` now unwraps the new `{ directory, project, payload }` envelope and filters by `directory` in-process; all downstream `SessionManager` listeners are unchanged.

## v0.7.12

- **Open repo site from Skills Manager toolbar** — When a specific repo is selected in the Skills Manager dropdown, a new external-link button appears next to it; clicking opens the repo's GitHub/GitLab page in the default browser. Supports HTTPS and SSH Git URLs; tooltip shows the resolved web URL on hover.
- **Normalize skill repo URLs** — Removed `.git` suffix from all curated skill repo URLs in the Skills Catalog, and added a DB migration (v8) so previously-registered repos match the updated catalog entries.
- **Camel case workspace default folders** — Renamed workspace convention folders from `input/` → `Input/` and `output/` → `Output/` for visual consistency; updated system prompt, permission rules, and all documentation references

## v0.7.11

- **Fix: Automations fire in bursts after the app is backgrounded (release builds)** — In macOS release builds, leaving the app in the background caused a automation to silently queue ~one pending run per minute and then dispatch all queued runs back-to-back when the app returned to foreground.

## v0.7.10

- **`skills.sh` deep link on Skills Manager cards** — Every `SkillCard` in **Skills Manager** now exposes a `skills.sh` text link next to the existing `View` link, opening the matching public listing on [skills.sh](https://skills.sh/) (`https://skills.sh/<org>/<repo>/<skill-id>`, with `<org>` and `<repo>` lowercased) in the user's default browser. The full URL is shown in a tooltip on hover.
- **Refactor: shared `fs_utils` module** — Extracted `copy_dir_recursive`, `compute_dir_checksum`, and `collect_files` from `commands/packs.rs` and `commands/skills.rs` into a new `src-tauri/src/fs_utils.rs`, eliminating a duplicated `copy_dir_recursive` implementation.

## v0.7.9

- **Polished card hover interactions** — Curated repo cards in **Skills Catalog**, starter pack cards in **Starter Packs**, and skill cards in **Skills Manager** now share a consistent shadow and lift-on-hover effect, with the `Skills Catalog` "Open" arrow nudging on group hover. `SkillCard` also picks up the missing `bg-card` background so its hover shadow reads correctly against the page.
- **Full-text tooltips on truncated card content** — `line-clamp`-ed descriptions, truncated skill names, and the `font-mono` `skillPath` row are now wrapped in Radix `Tooltip` (400 ms delay) so hovering reveals the complete text in a popover.
- **`SkillCard` action row hardening** — The "View / Install / Re-install / Update / Delete" button row now wraps every right-side variant in a single `<div className="ml-auto flex items-center gap-1">` container, so future action states inherit right-alignment automatically instead of each branch remembering its own `ml-auto`.
- **Standardised search inputs** — `SkillsCatalog` and `StarterPacks` now use the shared `<Input>` shadcn primitive so focus rings, disabled states, and dark-mode handling stay in lockstep with the rest of the app.

## v0.7.8

- **Smarter Skills Manager category badges** — `SkillCard` and the Skills Manager filter tabs now derive each skill's category from its name (keyword match against the closed `CATEGORY_COLORS` taxonomy), falling back to the source repo's curated categories, then the backend-derived path category, then `General`. Repos that don't follow the `{category}/skills/{name}` convention (e.g. `openai/skills`, `mattpocock/skills`) now show meaningful, color-coded badges that match a selectable filter tab.

## v0.7.7

- **Skills Catalog redesign — Curated repo browser** — The Home tab "Skills Catalog" now lists hand-picked Git skill repositories (Anthropic, OpenAI, Vercel, and others) instead of bundled individual skills. Clicking a card opens the Skills Manager and either selects the repo (if already added) or auto-clones it via `git clone --depth 1`, then filters the toolbar dropdown to it. Bundled `skill-templates/` and the `sync-skills.mjs` ritual have been retired — all skill discovery and install now flows through the Skills Manager.

## v0.7.6

- **Fix: All automation runs incorrectly shown as "Has findings"** — The `has_findings` flag now inspects the agent's final response for "no findings" phrases instead of marking every completed run as having findings
- **Fix: Automation form freezes and pending runs pile up after a run completes** — A bug in the automation scheduler caused a self-deadlock that permanently blocked the worker thread, preventing all subsequent Tauri commands from executing; the form now also disables the Save button while a save is in-flight to prevent duplicate submissions

## v0.7.5

- **Fix: Automation schedules firing at UTC instead of local time** — Scheduler now evaluates cron expressions against the system's local timezone

## v0.7.4

- **Per-automation scheduler threads** — Refactored the automation scheduler from a single shared priority-queue thread to one dedicated thread per active automation; each thread sleeps precisely until its next fire time using a condvar; cancel-on-change semantics instantly stop/restart threads when automations are created, updated, toggled, or deleted; next run times are now computed and served by the Rust backend
- **Fix: Invalid custom cron expressions silently accepted** — The automation form now validates cron expressions in real-time against the Rust backend's scheduler-identical normalization pipeline, displaying an error message and blocking save on invalid input

## v0.7.3

- **Compact automation run items** — Sidebar automation run items now display as a single row (name, status, time) instead of two rows; status text truncates with ellipsis when space is tight
- **Fix: Automations scheduled on weekdays not triggering** — The `cron` crate (v0.12) interprets numeric day-of-week values differently from standard Unix cron (`1-5` was parsed as Sun–Thu instead of Mon–Fri), causing automations with weekday schedules to never fire on the correct days

## v0.7.2

- **Next run time on automation cards** — Automation cards on the Home tab now display the next scheduled run time; daily automations show just the time (e.g., "9:00 AM"), weekly automations show the weekday and time (e.g., "Monday 9:00 AM"); disabled automations hide the next run indicator
- **Fix: Custom cron schedules not saved** — Custom cron expressions (e.g., `*/5 * * * *`) were saved as empty strings, causing the scheduler to reject them; the custom cron input now correctly populates `scheduleCron`
- **Fix: Editing custom-schedule automations defaults to Daily** — Opening the edit form for an automation with a custom cron now correctly detects the frequency and defaults the picker to "Custom" with the cron expression pre-filled
- **Fix: Scheduled automation tasks never started** — The scheduler's `fire_automation` created an automation run record with "running" status but never created a task record or dispatched `StartTask` to the sidecar, so scheduled runs appeared as "Running..." with no actual execution; the same issue affected `process_pending_runs` for queued runs; both now mirror the `run_automation_now` flow: create task, link run, resolve workspace context, and dispatch to sidecar via a spawned Tokio runtime
- **Refactor: dedupe automation dispatch** — `run_automation_now` command now uses the same helpers as the scheduler

## v0.7.1

- **Automation enable/disable toggle** — Automations card now shows an inline toggle switch for quick enable/disable without opening the dropdown menu; disabled automations are not triggered by the scheduler
- **Fix: Automation run status not updating after task completion** — Automation runs were stuck showing "Running..." after the task completed because `complete_task` never marked the associated automation run as complete

## v0.7.0

- **Automations** — Scheduled AI automations: creation/management on the Home tab, cron-based scheduling in Rust, a run triage panel in the Sidebar, and filtering of automation-triggered tasks from the regular Sessions tab

## v0.6.11

- **Categorized output subfolders** — The system prompt now requires the agent to organize every new file under a category subfolder; the agent reuses existing categories when they fit and picks short, kebab-case names based on the file's nature, so workspace artefacts stay neatly grouped instead of dumped into `Output/` root
- **Fix: Symlink-installed skills not appearing in slash command autocomplete** — Skills installed via the Skills Manager on macOS/Linux (which use symbolic links) were not recognized by the Skills Catalog's install detection, causing them to be excluded from the `/` slash command autocomplete in TaskInputBar and ChatInput; updated `skills_list_with_status` to detect both copy-based and symlink-based installs
- **Fix: Custom skills in `~/.config/opencode/skills` not appearing in slash command autocomplete** — User-copied skill folders (and skills from custom repos that don't ship as bundled templates) were missing from the `/` autocomplete popover

## v0.6.10

- **File tree item action buttons** — Every row in the file tree shows Open and Delete buttons on hover; folders open in Finder/Explorer, files open with the default app; delete moves both files and folders to system trash with immediate tree refresh
- **Symbolic link support in file tree** — Symlinks (macOS/Linux) are now detected and displayed with a link overlay badge; symlink folders expand to show the linked directory's contents
- **Symlink-based skill installation (macOS/Linux)** — Installing skills from repos now creates a symbolic link instead of copying files; installed skills always reflect the latest repo cache after sync; deletion is symlink-aware to prevent accidental cache removal

## v0.6.9

- **Expandable arena sessions in sidebar** — Arena entries in the Sessions panel now show a disclosure triangle that expands to reveal the 3 individual chat sessions; clicking a child session opens the standard chat view while clicking the arena row opens the tabbed Arena view


## v0.6.8

- **Fix: Auto-create target skills folder on switching** — Switching the Skills Manager target folder now creates the destination directory if it does not exist yet.
- **Auto-scroll on session resume** — Opening an existing chat now jumps to the bottom of the conversation so the latest messages are visible immediately.
- **Fix: Arena sidebar status auto-refresh** — Arena session entries in the Sessions panel now update automatically as child tasks change state (running, completed, failed, interrupted) instead of staying stuck in the initial running state.

## v0.6.7

- **Mandatory workspace context in system prompt** — the agent is always told the current workspace path and instructed to create every new file under `<workspace>/Output/` (including bash-created files like `touch`, `>`, `tee`, `mkdir`), never at the workspace root or in `Input/`.
- **Cursor-aware slash commands** — Slash-command skill picker now triggers whenever `/` is typed after whitespace (or at text start), not only at the start of input; the filter uses just the characters between `/` and the caret. Selecting a skill removes only the `/query` token and preserves the surrounding prose.
- **Multi-skills support** - Multiple skills can be referenced per message — each appears as its own pill above the textarea and is prefixed in the composed prompt as `/skill-a /skill-b <your text>`.

## v0.6.6

- **Clickable skill pill** — Clicking a selected skill's name in the pill opens its SKILL.md definition in the file preview panel; skill file resolution follows OpenCode's discovery order (project-level, global, bundled templates)
- **Arena slash commands** — ArenaInputBar now supports `/` slash command skill invocation with autocomplete popover, skill pill, and prompt composition (matching TaskInputBar and ChatInput)

## v0.6.5

- **Convention-based workspace permissions** — Workspace `Input/` folder is now read-only (agent cannot edit files there); `Output/` folder is explicitly writable. Permission approvals are now remembered at the workspace level and automatically applied to all future tasks in the same workspace.
- **Arena completion tracking** — The Rust backend now automatically marks an arena as completed when all 3 child tasks reach a terminal state (completed, failed, or interrupted); `completed_at` timestamp is set on the arena record

## v0.6.4

- **High-priority todo indicator** — Changed the high-priority badge in the Todos panel from a red `!` (which resembled an error) to an amber `↑` arrow with a softer amber background
- **Fix: GitLab PAT authentication for skill repos** — Private GitLab repositories (self-hosted or gitlab.com) now authenticate correctly using the `oauth2:{token}@` URL format required by GitLab HTTP auth
- **Remove skill repo from Skills Manager** — Added a "Remove" button to the Skills Manager toolbar (visible when a repo is selected) to delete a registered skill repository, its cached clone, and stored credentials

## v0.6.3

- **Fix: Arena sidebar visibility** — Arena sessions now appear in the sidebar immediately after creation instead of requiring an app restart
- **Arena tabbed layout** — Arena columns replaced with a tabbed view; each tab shows the model name and status, displaying one model's output at a time

## v0.6.2

- **Fix: Arena tool call card spacing** — Consecutive tool call cards in Arena mode now use tight 4px spacing (matching normal chat) instead of the uniform 16px gap that was applied to all messages
- **Fix: Arena file reference handling** — Arena input bar now supports "Add to Chat" button from the file preview panel and drag-and-drop of files from the sidebar file tree and OS file manager, inserting `@path` references at the cursor position (matching TaskInputBar and ChatInput behavior)

## v0.6.1

- **Fix: Arena question requests** — Agent questions (e.g., asking the user to choose an output folder) are now handled in Arena mode; previously the question was silently dropped and the agent hung waiting for a response
- **Tool call cards redesign** — Tool call rows restyled with reduced padding, borderless design, and smaller icons; hover reveals copy and expand controls; file-based tools (Read, Write, Edit) show an "Open in file viewer" button on hover

## v0.6.0

- **Arena — Side-by-Side Agent Comparison** — Compare 3 AI models on the same prompt simultaneously; pick a model for each column via the full provider settings panel, submit a prompt, and watch all 3 agents stream responses in a 3-column layout; arena sessions appear in the sidebar with a distinct icon and support follow-up messages to all agents at once
- **Arena - Chat history persistence** — Full chat history from all 3 agents is now retained across follow-ups and persisted to the database for reload
- **Enhanced MCP Server Settings** — MCP configuration now shows each server as an individual card with real-time status indicators (connected/failed/disabled), per-server enable/disable toggles, expandable tool listings, and add/edit/remove actions; includes a JSON fallback view for power users
- **Fix infinite compaction loop** - Added compaction loop detection with threshold limit (3)
- **Improved dialog readability** — Reduced backdrop blur and opacity on question/permission dialogs so main window content stays readable; dialogs are now draggable to reveal covered content

## v0.5.15

- **Standardized log file naming** — TypeScript sidecar logfile now matches the Rust sidecar format (`YYYY-MM-DD_HH-MM-SS_TS.log`) for consistent sorting and easier correlation
- **New Starter Packs** - Add new start packs: **Data Visualization** and **Finance Analysis**

## v0.5.14

- **Add find-skills to Skills Catalog** - Helps users discover and install agent skills 
- **Settings dialog layout** — Aligned Settings dialog width and padding with the Task Launcher for visual consistency across dialog surfaces
- **Update Skills in Skill Catalog** - Sync the latest changes on skills: `skill-creator` and `brainstorming`

## v0.5.13

- **Fix: Intermediate assistant messages not persisted** — Multi-step agent sessions now correctly save all intermediate assistant messages to the database
- **Fix: Long-running task false failure** — Conversations running longer than 10 minutes no longer incorrectly show "Failed" status; the `sendMessage` HTTP call is now fire-and-forget since session lifecycle is managed entirely via SSE events
- **Fix: Tool call card input/output** — Tool call cards now persist and display input and output correctly; tool messages update in-place as they transition from pending to completed; added skill tool display with icon

## v0.5.12

- **Fix: Stop button** — Stop button and Escape key now correctly abort running tasks
- **Fix: Cross-task message leakage** — Messages from failed or stuck sessions no longer appear in newly started tasks
- **Fix: Question reply stuck** — Answering agent question prompts no longer causes the task to hang
- **Fix: Multi-select question dialog** — Fix display and handling of agent questions with multiple-choice answers
- **Fix: Markdown table rendering** — Tables and other block-level markdown elements in agent responses now render correctly when not preceded by a blank line
- **Update skills in Skill Catalog** - Sync from latest source repos

## v0.5.11 (2026-02-24)

- **Fix: Streaming message duplication** — Multi-step agent turns no longer display as repeated message blocks; partial messages are now correctly finalized between steps

## v0.5.10 (2026-02-24)

- **Fix: Handle pre-existing skills repo** — Re-adding a previously removed skill repository no longer fails
- **New Skills in Skill Catalog** - Add new skills: `planning-with-files` and `skill-creator`
- **Rename Conversations** — Right-click a conversation in the sidebar to rename it via inline editing

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
