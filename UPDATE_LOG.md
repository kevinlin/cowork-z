![Cowork-Z](src-tauri/icons/128x128.png)

# UPDATE LOG

## v0.8.1

- **Fix: deleting a task now releases its todos, artifacts, and streaming buffers** — Deleted tasks were removed from the task lists but their entries in the per-task todo/artifact maps (and any in-flight streaming text for the open task) were kept forever, accumulating memory over long sessions (2026-06-12 review #27).
- **Fix: the app's OpenCode config is now written to an app-private directory** — The sidecar wrote `opencode.json`/`config.json` into OpenCode's own log directory and rewrote them with replace/delete semantics (an empty MCP set deleted the `mcp` key, model switches rewrote provider overlays), risking clobbering settings the app did not write; config now lives in a `cowork-z`-owned directory, stale files from previous versions are cleaned up, and the user's global OpenCode config is never touched (2026-06-12 review #25).
- **Fix: a stored Ollama API key is now passed to the OpenCode server** — The IPC contract defined an `ollama` key but the server spawn never mapped it to an environment variable, so authenticated Ollama setups silently failed; it is now exported as `OLLAMA_API_KEY` alongside the other providers (2026-06-12 review #22).
- **Fix: workspace-scoped server events are dropped when no workspace is active** — If the sidecar connected to the OpenCode server before any task set a workspace (e.g. during Copilot sign-in), the event stream's directory filter was effectively disabled and events from any workspace passed through, risking misattribution to the wrong task; workspace-scoped events are now dropped until a task scopes the stream to its workspace (2026-06-12 review #23).
- **Fix: superseded sessions are now aborted on the OpenCode server** — Starting a new task only removed the previous task's session from the sidecar's local tracking; the server-side session kept running, consuming tokens and potentially still executing tools (file writes, shell commands) after the UI had moved on; still-running stale sessions are now aborted server-side before local cleanup (2026-06-12 review #21).
- **Fix: failed permission replies now surface as task errors** — When delivering a permission approval/denial to the OpenCode server failed, the sidecar only logged it, leaving the agent blocked on the permission while the UI showed it as answered; the failure is now reported as a task error like question replies already were (2026-06-12 review #24).
- **Fix: failed message sends now surface as task errors instead of hanging the UI** — When the message that kicks off a turn was rejected (network blip, auth error, model error), the sidecar only wrote a log line, so the task appeared active forever with no way to retry; a rejection arriving before any server-sent event has confirmed the turn now emits a task error and aborts the orphaned server session, while rejections on already-running turns (e.g. socket timeouts on long turns) are still tolerated (2026-06-12 review #9).
- **Fix: the app now waits for the sidecar's ready handshake before sending commands** — The sidecar was marked ready the instant its process spawned, so commands sent during Node startup could be silently lost, producing hard-to-reproduce first-task failures; spawning now blocks until the sidecar emits its `ready` event (15s timeout), a crashed sidecar process is no longer reported as running, and a dead sidecar is respawned on the next task instead of failing forever (2026-06-12 review #18).
- **Fix: sidecar commands are now handled strictly one at a time** — Each command line arriving on the sidecar's stdin used to spawn a concurrent handler, so overlapping commands (e.g. a task start racing a shutdown, or two task starts) could race on shared server/session state and produce duplicate server spawns or lost shutdown ordering; commands now run through a FIFO queue, and commands arriving after shutdown begins are dropped (2026-06-12 review #8).
- **Fix: the OpenCode server password no longer enters the LLM system prompt** — Every message sent the server's basic-auth password to the model provider inside the system prompt (provider logs/retention, prompt-injection echo, and visibility in any prompt dump); the prompt and the bundled server-API skill now reference the `OPENCODE_SERVER_PASSWORD` environment variable, which the agent's shell expands locally — the secret never leaves the machine as prompt text (2026-06-12 review #1).
- **Fix: API keys no longer ride along on every task start** — Every task start serialized the complete credential set (all providers) onto the sidecar's stdin; task payloads now carry only a SHA-256 fingerprint, and the sidecar requests the actual keys through a dedicated request/response bridge solely when it (re)spawns the OpenCode server — keys cross the process boundary only when they change (2026-06-12 review #5).
- **Fix: streaming handlers no longer log message content** — Every streamed message wrote its complete final text into the persisted app log (agent conversation content can include secrets read from files) and `console.log`-ed every delta; streaming logs now record message id and length only (2026-06-12 review #28).
- **Fix: removed the IPC command that returned the full Anthropic API key to the webview** — `get_api_key` handed the complete keychain secret to any frontend caller (any XSS or webview compromise could exfiltrate it), and nothing in the UI used it; the renderer now only ever sees existence + masked prefix via `get_all_api_keys` (2026-06-12 review #13).
- **Fix: API keys can no longer escape log redaction** — The sidecar logged full incoming command payloads (which include every provider's API key on task start), and the redactor's key-name pattern missed provider-name fields like `anthropic` or `openai` inside the `apiKeys` map; commands are now logged as type + task id only, and the entire `apiKeys` container is masked like `environment`/`headers` (2026-06-12 review #6).
- **Fix: open/reveal file actions are now path-guard validated Rust commands** — The webview could open any file under `$HOME` with its default OS application via the opener plugin (a meaningful exploitation step even without shell access); "open" and "reveal in Finder" now route through Rust commands that validate against workspace/granted/app-managed roots, and the `$HOME`-wide opener capability grant is removed from both windows (2026-06-12 review #30).
- **Fix: media thumbnails and preview-by-path now pass the same path-safety gate as chat links** — Paths the agent emits in markdown were rendered as thumbnails and opened in the preview panel without the `isPathSafe` check chat links get, so traversal segments or sensitive system paths could reach the file-read layer; both `extractMediaPaths` and `openPreviewByPath` now reject unsafe paths up front (2026-06-12 review #10).
- **Fix: workspace paths are canonicalized and restricted to home/mounted volumes** — Workspace registration previously accepted any absolute path that didn't match a system-path blocklist, without resolving symlinks, so `/tmp`, `/opt`, another user's directory, or a symlink escaping the validated tree could become a sandbox root; paths are now canonicalized before validation and must live under your home folder, `/Users/Shared`, or a mounted volume (2026-06-12 review #15).
- **Fix: skill ids are validated against path traversal before install/delete/resolve** — `skills_delete_installed` joined a renderer-supplied `skill_id` straight into `remove_dir_all`, so a crafted id like `../../.ssh` could delete arbitrary user directories; skill ids must now be a single plain path component everywhere they touch the filesystem (delete, install destination, SKILL.md resolution), and deletion additionally verifies the canonicalized target is a direct child of the skills directory (2026-06-12 review #4).
- **Fix: permission grants are validated and canonicalized before persisting** — Folder grants (user-saved or ad-hoc from permission approvals) previously accepted any path, including `/` and `~/.ssh`, which then fed the file-access guard and asset scope; grants now pass system-path rules and a credential-directory denylist, and historical bad grants are filtered out at load time (2026-06-12 review #3).
- **Fix: directory listing is now scoped to workspace and granted folders** — `read_directory` validated no paths at all, letting a compromised webview enumerate any directory on disk; it now goes through the same canonicalizing path guard as the file read/trash commands (2026-06-12 review #2).
- **Fix: Tauri packages pinned to minor lines; sidecar binary compiler pinned exactly** — `@tauri-apps/*` JS packages and the matching Rust crates now use tilde version ranges so the two sides of the IPC/permission contract bump together, and `@yao-pkg/pkg` is pinned exactly so sidecar bundling behavior can't drift without a code diff (2026-06-12 review #34).
- **Fix: dependency-audit automation added; known vulnerable dependencies updated** — Dependabot now watches npm (root + sidecar), Cargo, and GitHub Actions weekly; CI gained an `audit` job (`pnpm audit --audit-level=high` + `cargo audit`). JS dependencies were updated within existing semver ranges and vulnerable Rust crates patched in `Cargo.lock`, clearing 46 npm advisories and 8 RustSec advisories; `.gitignore` now excludes `.env` files (2026-06-12 review #32).
- **Fix: pre-commit formatting now covers `.tsx` files** — The husky hook's staged-file filter only matched `.ts`, so React components bypassed pre-commit lint/format entirely (2026-06-12 review #33).
- **Fix: CI now typechecks, builds, and runs on macOS** — The Build workflow gained `pnpm typecheck` and production `pnpm build` steps, and the test job runs on both Linux ARM64 and macOS ARM64 so platform-specific breakage is caught before release (2026-06-12 review #31).
- **Fix: CI lint gate restored** — The June 11 CI lint fix had been reverted because `pnpm ultracite:check` failed with 17 pre-existing violations; all 17 are now fixed (`substring` → `slice` conversions plus modal a11y in `McpAddServerDialog`), and the workflow runs lint and tests as separate gating steps (2026-06-12 review #7).

## v0.8.0

- **Workspace convention aligned with `rfp-daily` folder governance** — `Misc/` is now `edit: ask` (was `edit: deny`) so the agent can promote curated supporting scripts and prompt experiments from `Output/` to `Misc/` after user approval, matching the four-tier governance model in `~/dev/ai-sdlc/zapac-agent-skills/rfp-daily/assets/folder_governance.md`. The `<workspace-conventions>` system prompt block now documents `Misc/` as holding both static user assets (icons, logos, brand images, fonts) **and** curated utilities promoted from `Output/`, and describes the dual promotion workflow (`Output/` → `Artefacts/<category>/` for governed deliverables, `Output/` → `Misc/<topic>/` like `Misc/scripts/` or `Misc/prompt-experiments/` for curated utilities). `mkdir -p` first-action still seeds all four folders silently because bash is not gated by the `edit` permission. Config-builder test updated; all 93 sidecar tests pass.
- **Address findings from technical review** — Security hardening, bug fixes, and performance improvements across the app:
  - Orphaned `opencode serve` process on app shutdown — Quitting the app could leave `opencode serve` running with API keys in its environment and a live listening port.
  - Enabled a restrictive Content Security Policy (previously disabled), so markup-injection bugs can no longer escalate to arbitrary script execution.
  - Narrowed the `asset:` protocol scope from the entire filesystem to exactly the directories previews need (workspaces, granted folders, app-managed dirs), synced at runtime.
  - Renderer-reachable file read/trash commands now validate paths against registered workspaces and granted folders; file exports go through a Rust-side native save dialog instead of renderer-supplied write paths.
  - Git personal access tokens are no longer persisted in plaintext to skill-repo `.git/config`; credentials persisted by earlier versions are scrubbed on the next sync.
  - Removed unused shell permissions from both webview capability files and narrowed the filesystem-wide opener grant to user-accessible locations.
  - HTML preview sandbox no longer lets agent-generated scripts escape via popups, and the injected base href is HTML-encoded.
  - MCP secrets, HTTP bodies, and SSE payloads are redacted from sidecar logs by default; full payload logging is now an explicit debug opt-in.
  - The OpenCode server password is no longer written to logs or the debug panel; the sidecar logger redacts secret-looking values from every entry.
  - API keys added or rotated mid-session now take effect by restarting the OpenCode server, instead of being silently ignored until app restart.
  - API-key change detection now compares SHA-256 fingerprints, so no raw key material is retained in memory.
  - SSE reconnect timers are cleared on disconnect and retries use exponential backoff (capped at 60s) instead of retrying every 5s forever.
  - The Azure Foundry API key is now stored under the standardized keychain id, reported correctly in Settings, and forwarded to the OpenCode server environment.
  - Azure Foundry keys stored under the legacy keychain id are migrated to the canonical id at startup (replacing the read-time fallback), so UI deletes can't leave a stale entry behind.
  - MCP config updates now carry the active workspace directory so they reach the correct OpenCode server instance.
  - Task completion events are handled by a single global listener, eliminating duplicate DB writes and state updates.
  - The debug-log panel mounts only when debug mode is on, caps retained logs at 500 entries, and no longer re-renders the whole chat per log line.
  - `file://` links in chat messages work again (the markdown URL sanitizer now allows them, with path safety still enforced at click time).
  - Permission approvals covering multiple path patterns no longer drop all but the last folder grant.
  - Fixed a Rules of Hooks violation in `StreamingText` that could crash the chat view when streaming mode flipped on a mounted instance.
  - Chat auto-scroll now fires on new and streaming messages (the scroll sentinel was missing its anchor attribute).

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
