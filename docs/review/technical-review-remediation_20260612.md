# Technical Review Remediation Tracker — June 12, 2026

Canonical tracker for remediation of the findings in
[`technical-review_20260612.html`](./technical-review_20260612.html)
(review of `main` @ `f55c5f0`, generated June 12, 2026). This is the second
remediation round; the June 11 round is recorded in
[`technical-review-remediation.md`](./technical-review-remediation.md).

Workflow: one git worktree + one commit per issue, integrated sequentially into
`fix/tech-review-remediation`. See
[`docs/specs/plan_technical_review_fixes.md`](../specs/plan_technical_review_fixes.md).

Each fixed entry records: worktree branch, commit hash, `UPDATE_LOG.md` entry
label (under `v0.8.1`), and verification commands with outcomes.

## Queued

Sidecar lifecycle:

- [ ] #24 Permission-reply failures silently dropped
- [ ] #21 Stale sessions cleaned up locally but never aborted on the server
- [ ] #23 SSE workspace filter disabled when `workingDirectory` is unset
- [ ] #22 `ApiKeys.ollama` defined but never applied at server spawn
- [ ] #25 OpenCode config merge can clobber user settings on disk

Frontend store / performance:

- [ ] #11 Arena mode double-persists and never dedupes task events
- [ ] #26 Async `listen()` unsubscribe races leak Tauri event listeners
- [ ] #27 `deleteTask` leaks `todos`/`artifacts` map entries
- [ ] #19 Filesystem watcher is non-recursive — stale file tree for nested changes
- [ ] #12 Streaming pipeline re-parses full markdown and re-renders the whole page per delta
- [ ] #35 O(n²) per-render scans in `MessageList`

Rust robustness:

- [ ] #16 Database migrations are not transactional
- [ ] #17 DB layer panics: `.expect()` on queries and residual `.lock().unwrap()`
- [ ] #14 Task persistence commands accept arbitrary `task_id` without validation
- [ ] #29 CSP residual weaknesses (`object-src data:`, missing `base-uri`/`frame-ancestors`)

## In Progress

(none)

## Fixed

- [x] #9 `sendMessage` failures swallowed — tasks hang with no error surfaced
  - Branch/worktree: `fix/tr2-09-sendmessage-errors` (`.worktrees/tr2-09`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: failed message sends now surface as task errors instead of hanging the UI (2026-06-12 review #9)"
  - Change: sendMessage stays fire-and-forget (awaiting would mark long
    turns failed when the HTTP socket times out), but the catch handler now
    routes to `handleSendMessageFailure`, which disambiguates via a new
    `turnConfirmed` flag set by any SSE evidence the server is processing
    the turn (`session.status busy`, `message.updated`, part deltas/
    updates). Unconfirmed rejection → emit `error` (→ `task_error` IPC),
    abort the orphaned server session, clean up local maps. Confirmed or
    already-cleaned-up → log-only, as before. Applied to both the initial
    message (startTask) and follow-ups (resumeSession).
  - Verification: sidecar `pnpm build` (tsc) — pass; `pnpm test` — 117/117
    pass (new: unconfirmed rejection emits error + aborts; rejection after
    busy SSE is tolerated; resume follow-up failure surfaces); ultracite
    clean.

- [x] #18 Sidecar marked ready immediately after spawn (no handshake)
  - Branch/worktree: `fix/tr2-18-ready-handshake` (`.worktrees/tr2-18`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: the app now waits for the sidecar's ready handshake before sending commands (2026-06-12 review #18)"
  - Change: `is_ready: bool` (set unconditionally right after `spawn()`)
    replaced with an `Arc<AtomicBool>` that the stdout reader task flips
    when the sidecar's `ready` IPC event arrives. `spawn()` now polls that
    flag (50ms interval, 15s timeout) before returning; on timeout the
    child is killed and an error returned, and if the process dies during
    startup the spawn fails with a clear message. Two adjacent gaps in the
    same state machine closed: `is_running()` now also checks the existing
    `exited` flag (a crashed sidecar previously kept reporting as running),
    and `spawn()` respawns over a dead child instead of early-returning
    `Ok` on the stale handle (previously a crashed sidecar could never be
    restarted without an app restart). Since all callers hold the manager
    mutex across `spawn()`, concurrent commands queue behind the handshake
    rather than racing it.
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib sidecar` — 3/3 pass.

- [x] #8 Unserialized concurrent stdin command handling in the sidecar
  - Branch/worktree: `fix/tr2-08-stdin-serialize` (`.worktrees/tr2-08`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: sidecar commands are now handled strictly one at a time (2026-06-12 review #8)"
  - Change: new `CommandQueue` (promise-chain FIFO) serializes every stdin
    command; the readline handler parses, then enqueues. A failing handler
    is logged and never breaks the chain. `shutdown` is queued (in-flight
    commands finish first) and flips a flag that drops anything arriving
    after it. Two commands deliberately bypass the queue: `ping` (liveness
    must not wait behind a long task) and `api_keys_response` — it resolves
    a promise that a *queued* command (`doInitialize` inside
    `start_task`) is awaiting, so queueing it would deadlock the bridge
    added for #5.
  - Verification: sidecar `pnpm build` (tsc) — pass; `pnpm test` — 114/114
    pass (new: FIFO ordering, error isolation, post-shutdown drop);
    ultracite clean.

- [x] #1 OpenCode server password embedded in every LLM system prompt (CRITICAL)
  - Branch/worktree: `fix/tr2-01-password-prompt` (`.worktrees/tr2-01`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: the OpenCode server password no longer enters the LLM system prompt (2026-06-12 review #1)"
  - Change: `buildSystemPrompt` no longer takes or interpolates the server
    password. The `<server-access>` block (and every curl example in the
    bundled `opencode-server-api` skill) now references
    `$OPENCODE_SERVER_PASSWORD` (`$env:` form noted for PowerShell), which
    the agent's shell expands locally — the agent's bash tool runs as a
    child of `opencode serve`, whose environment already carries the
    variable (set by `process-manager` at spawn). Both prompt and skill
    explicitly instruct the agent to never print/echo/write the value.
    `SessionManager` drops its `serverPassword` field; the password now
    lives only in the sidecar process and the server's env. Chose the
    review's env-var option over a localhost token broker — no new
    surface, and the variable is already in place.
  - Verification: sidecar `pnpm build` (tsc) — pass; `pnpm test` — 111/111
    pass (new regression test: every `opencode:` auth reference in the
    prompt must be the env-var form, plus a never-print instruction
    check); ultracite clean.

- [x] #5 All provider API keys sent in bulk over sidecar IPC on every task start
  - Branch/worktree: `fix/tr2-05-keys-ipc` (`.worktrees/tr2-05`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: API keys no longer ride along on every task start (2026-06-12 review #5)"
  - Change: task payloads (`start_task`/`resume_session`, arena, automation
    dispatch) now carry only `apiKeysFingerprint` — a Rust-computed SHA-256
    digest with no key material. The sidecar pulls actual credentials
    through a new narrow bridge (`request_api_keys` event →
    `api_keys_response` command) only when it is about to (re)spawn the
    OpenCode server, i.e. on first spawn or when the fingerprint differs
    from the last applied one (preserving the v0.8.0 restart-on-rotation
    behavior — the response includes the host-computed fingerprint, so the
    sidecar never hashes key material itself). Chose this over "send only
    the active provider's key" because Arena runs three providers against
    one shared server — per-provider filtering would force a server restart
    between slots. The full key set still enters the server's environment
    at spawn (the server serves any provider), but keys now cross IPC only
    on change instead of on every task. `api-key-fingerprint.ts` moved to
    Rust (`sidecar::fingerprint_api_keys`); CLAUDE.md IPC protocol lists
    updated.
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib sidecar` — 3/3 new fingerprint tests pass; sidecar
    `pnpm build` + `pnpm test` — 111/111 pass (7 TS fingerprint tests
    removed with the module); `pnpm typecheck` — pass; `pnpm test --run` —
    337/337 pass.

- [x] #28 Streaming debug logs write full message text in production
  - Branch/worktree: `fix/tr2-28-streaming-logs` (`.worktrees/tr2-28`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: streaming handlers no longer log message content or console.log per delta (2026-06-12 review #28)"
  - Change: removed both `console.log` calls in the module-level streaming
    handlers (the only ones in production frontend code) and the
    per-partial `logEvent` IPC call (overhead at streaming frequency);
    the message-complete log now records `messageId` + `textLength` only —
    the full message text (which can contain secrets the agent read from
    files) no longer reaches the persisted app log.
  - Verification: `pnpm typecheck` — pass; `pnpm test --run` — 337/337
    pass; ultracite clean.

- [x] #13 `get_api_key` command returns the full keychain secret to the webview
  - Branch/worktree: `fix/tr2-13-get-api-key` (`.worktrees/tr2-13`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: removed the IPC command that returned the full Anthropic API key to the webview (2026-06-12 review #13)"
  - Change: removed the `get_api_key` Tauri command, its registration, and
    the `getApiKey` frontend bridge/interface entries. It had zero frontend
    call sites — pure dead exfiltration surface. The UI keeps using
    `get_all_api_keys` (existence + masked prefix); full secrets stay
    Rust-side (`secure_storage::get_api_key` remains for internal use).
  - Verification: `cd src-tauri && cargo check` — pass; `pnpm typecheck` —
    pass; `pnpm test --run` — 337/337 pass.

- [x] #6 API keys escape redaction into plaintext logs
  - Branch/worktree: `fix/tr2-06-apikey-redaction` (`.worktrees/tr2-06`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: API keys can no longer escape log redaction (2026-06-12 review #6)"
  - Change: the sidecar's command router now logs only `{ type, taskId }`
    instead of the full `start_task`/`resume_session` payload (which carries
    every provider key), and `redactSecrets` treats `apiKeys`/`api_keys` as
    secret *containers* (like `environment`/`headers`/`env`) so
    provider-name keys (`anthropic`, `openai`, nested Bedrock objects) are
    fully masked even when they don't look secret themselves. The Rust-side
    verbatim stdout log inherits the fix: with the payload log gone and the
    container redacted at the sidecar logger, key material no longer
    reaches stdout in the first place.
  - Verification: sidecar `pnpm build` (tsc) — pass; `pnpm test` — 118/118
    pass (new regression test: `apiKeys` container with provider-name keys
    and nested Bedrock credentials never appear in redacted output).

- [x] #30 Opener capability still grants `$HOME/**`
  - Branch/worktree: `fix/tr2-30-opener-scope` (`.worktrees/tr2-30`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: open/reveal file actions are now path-guard validated Rust commands; the $HOME-wide opener grant is removed (2026-06-12 review #30)"
  - Change: new Tauri commands `open_path_in_default_app` and
    `reveal_path_in_file_manager` validate against
    `path_guard::validate_path_allowed` (workspaces + grants + app-managed
    dirs) before delegating to the opener plugin's Rust API;
    `tauri-api.ts`'s `openFilePath`/`revealInFinder` now invoke them instead
    of the plugin's JS bindings. The `opener:allow-open-path` grant
    (`$HOME/**`, `/Volumes/**`, `/media/**`, `/mnt/**`) is removed from both
    `default.json` and `skills.json`; `opener:default` remains for
    `openExternal` URL opens (http/https/mailto/tel only). All existing
    consumers stay inside the allowed roots: file tree + preview panel
    (workspace), Settings' skills folder reveal (app-managed root).
  - Verification: `cd src-tauri && cargo check` — pass; `pnpm typecheck` —
    pass; `pnpm test --run` — 337/337 pass.

- [x] #10 Agent-triggered file previews bypass `isPathSafe`
  - Branch/worktree: `fix/tr2-10-preview-pathsafe` (`.worktrees/tr2-10`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: media thumbnails and preview-by-path now pass the same path-safety gate as chat links (2026-06-12 review #10)"
  - Change: `filePreviewStore.openPreviewByPath` (the single entry point used
    by media thumbnails, tool-call cards, chat-input attachments, and
    markdown links) now silently rejects paths failing `isPathSafe`
    (traversal segments, sensitive system paths), and
    `extractMediaPaths` applies the same gate before any path reaches
    `convertFileSrc` thumbnails. The Rust `path_guard` remains the backstop;
    this makes the frontend trust boundary consistent with `EnhancedLink`.
  - Verification: `pnpm typecheck` — pass; `pnpm test --run` — 337/337 pass
    (new: traversal/sensitive-path rejection for both `extractMediaPaths`
    and `openPreviewByPath`, plus a safe-path happy case).

- [x] #15 Workspace validator allows any non-home path without canonicalization
  - Branch/worktree: `fix/tr2-15-workspace-canonicalize` (`.worktrees/tr2-15`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: workspace paths are canonicalized and restricted to home/mounted volumes (2026-06-12 review #15)"
  - Change: new `validate_and_canonicalize_workspace_path` resolves
    symlinks/`..` before validation and returns the canonical path, which
    `add_workspace` now persists — a symlink can no longer alias a workspace
    root to a tree that was never validated (on macOS this also closes the
    `/tmp` → `/private/tmp` dodge). The unix rule check's `Ok(())`
    fall-through is replaced with an allowlist: home subtrees,
    `/Volumes/<vol>/<sub>` (macOS), `/Users/Shared`, and Linux mount trees
    (`/media/`, `/run/media/`, `/mnt/`); `/tmp`, `/opt`, other users' homes
    etc. are now rejected. Grants inherit the same allowlist via
    `validate_grant_path` (#3). Chose the review's "restrict" option over
    "explicit confirmation" — no UI needed, and external-drive workflows
    keep working. Existing persisted workspaces are not re-validated at load
    (registration is the gate); noted as a judgement call.
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib workspace_validator` — 14/14 pass (new: non-home
    rejection, mount allowlist, symlink-to-home resolves to canonical
    target, symlink-to-/etc denied, missing path denied);
    `cargo test --lib path_guard` — 14/14 still pass.

- [x] #4 Path traversal in `skills_delete_installed` via unsanitized `skill_id`
  - Branch/worktree: `fix/tr2-04-skill-delete` (`.worktrees/tr2-04`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: skill ids are validated against path traversal before install/delete/resolve (2026-06-12 review #4)"
  - Change: new `validate_skill_id` rejects any id that is not a single plain
    path component (empty, `.`, `..`, `/`, `\`, NUL). Applied in
    `skills_delete_installed` (which additionally canonicalizes and verifies
    the target is a direct child of the install dir before `remove_dir_all`),
    in `skills_install_from_repo` (skill ids originate from repo
    scans/manifests, so a malicious repo cannot point the symlink/copy
    destination outside the install dir), and in `skills_get_skill_file_path`
    (no probing arbitrary directories for SKILL.md). `resolve_target_folder`
    was already safe (exact-match whitelist of three folder names).
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib skill_repos` — 2/2 pass (accept/reject id matrices
    including `../../.ssh`, backslash and absolute-path forms).

- [x] #3 Workspace permission grants persisted without path validation widen the sandbox
  - Branch/worktree: `fix/tr2-03-grant-validation` (`.worktrees/tr2-03`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: permission grants are validated and canonicalized before persisting (2026-06-12 review #3)"
  - Change: new `path_guard::validate_grant_path` canonicalizes grant paths
    (resolving symlinks/`..` via the deepest existing ancestor, so grants for
    not-yet-created folders still work; traversal segments through missing
    directories are rejected), applies the `workspace_validator` rules
    (blocks `/`, system dirs, the home root), and denies credential
    directories (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`,
    `~/.azure`, `~/Library/Keychains`). Applied in
    `save_workspace_permission` (rejects) and the `respond_to_permission`
    ad-hoc grant loop (skips the grant with a warning — the permission reply
    still reaches the agent). Defense in depth: `allowed_roots` re-validates
    persisted grants at load time, so bad grants from older versions can no
    longer re-open the sandbox or the asset scope.
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib path_guard` — 14/14 pass (8 new grant-validation tests:
    root/home/system/sensitive-dir/traversal denial, missing-tail
    resolution).

- [x] #2 Unscoped `read_directory` allows arbitrary filesystem enumeration
  - Branch/worktree: `fix/tr2-02-read-directory` (`.worktrees/tr2-02`)
  - Commit: `95356c9`
  - UPDATE_LOG: "Fix: directory listing is now scoped to workspace and granted folders (2026-06-12 review #2)"
  - Change: `read_directory` now canonicalizes its path and validates it via
    a new shared `path_guard::validate_path_allowed` (registered workspaces +
    granted permission folders + app-managed dirs) before listing — the same
    gate `read_file_content`/`read_binary_file`/`trash_file` use, now
    factored into `path_guard` so all four commands share one implementation.
    Both legitimate frontend consumers keep working: the workspace file tree
    (workspace roots) and the Skills Manager sidebar
    (`~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` are
    app-managed roots).
  - Verification: `cd src-tauri && cargo check` — pass;
    `cargo test --lib path_guard` — 6/6 pass.

- [x] #34 Floating versions on security-sensitive build dependencies
  - Branch/worktree: `fix/tr2-34-pin-versions` (`.worktrees/tr2-34`)
  - Commit: `a6a0f6e`
  - UPDATE_LOG: "Fix: Tauri packages pinned to minor lines; sidecar binary compiler pinned exactly (2026-06-12 review #34)"
  - Change: all `@tauri-apps/*` JS packages now use tilde ranges (same minor
    line: api/updater `~2.10.1`, dialog `~2.7.1`, opener `~2.5.4`, process
    `~2.3.1`, shell `~2.3.5`, cli `~2.11.2`); the Cargo side mirrors this
    (`tauri ~2.10`, `tauri-build ~2.5`, plugins tilde-pinned to their
    resolved minors) so JS/Rust pairs must be bumped together;
    `@yao-pkg/pkg` pinned exactly to `5.16.1` so sidecar binary bundling
    behavior cannot change without a manifest diff. Dependabot's grouped
    `tauri-js`/`tauri-rust` rules (added in #32) bump each side as a unit.
  - Verification: `pnpm install --lockfile-only` (root + sidecar) — lockfiles
    consistent, resolutions unchanged; `cd src-tauri && cargo check` — pass
    with existing `Cargo.lock` (tilde requirements satisfied by locked
    versions, no resolution change).

- [x] #32 No dependency-audit automation; `.gitignore` lacks `.env`
  - Branch/worktree: `fix/tr2-32-dep-audit` (`.worktrees/tr2-32`)
  - Commit: `04005ac`
  - UPDATE_LOG: "Fix: dependency-audit automation added; known vulnerable dependencies updated (2026-06-12 review #32)"
  - Change: added `.github/dependabot.yml` (weekly npm root + sidecar, cargo,
    github-actions; Tauri JS/Rust packages grouped); new `audit` CI job runs
    `pnpm audit --audit-level=high` (root + sidecar) and `cargo audit`;
    `.gitignore` gained `.env` / `.env.*`. To make the gates green from day
    one (avoiding a repeat of #7): updated JS deps within semver ranges
    (root: 30 → 3 moderate-only vulns; sidecar: 16 → 0), added a pnpm
    override `@actions/http-client>undici: >=6.24.0` for the
    `@tauri-release/cli` chain (latest 0.2.5 still pins `@actions/github@5`),
    and bumped `bytes`/`rustls-webpki`/`tar`/`time` in `Cargo.lock`
    (`time` held at 0.3.47 — 0.3.48 breaks `cookie`'s trait coherence).
  - Verification: `pnpm audit --audit-level=high` — pass (root + sidecar);
    `cargo audit` — pass (unmaintained-crate warnings only, from Tauri's
    Linux GTK3 bindings); `cd src-tauri && cargo check` — pass;
    `pnpm typecheck` — pass; `pnpm test --run` — 332/332 pass; `pnpm build` —
    pass; sidecar `pnpm build` + `pnpm test` — 117/117 pass.

- [x] #33 Husky pre-commit hook skips all `.tsx` files
  - Branch/worktree: `fix/tr2-33-husky-tsx` (`.worktrees/tr2-33`)
  - Commit: `ef89dc2`
  - UPDATE_LOG: "Fix: pre-commit formatting now covers .tsx files (2026-06-12 review #33)"
  - Change: `.husky/pre-commit` — staged-file filter changed from
    `grep '\.ts$'` (anchored, so `.tsx` never matched) to
    `grep -E '\.tsx?$'`, so React components and `.test.tsx` files get
    formatted/linted on commit like plain `.ts` files.
  - Verification: `echo 'a/b.tsx\na/c.ts\na/d.json' | grep -E '\.tsx?$'`
    matches the first two only; hook logic otherwise unchanged
    (config-only, validated by inspection).

- [x] #31 CI gaps: no typecheck, no production build, single Linux-ARM64 platform
  - Branch/worktree: `fix/tr2-31-ci-gaps` (`.worktrees/tr2-31`)
  - Commit: `a6b5637`
  - UPDATE_LOG: "Fix: CI now typechecks, builds, and runs on macOS (2026-06-12 review #31)"
  - Change: `.github/workflows/test.yml` — added `pnpm typecheck` and
    `pnpm build` (production Vite build) steps; the job now runs on a
    `fail-fast: false` matrix of `ubuntu-24.04-arm` + `macos-latest`. The
    apt system-deps step is Linux-only; the sidecar binary build step is
    split per OS (`build:binary:linux-arm64` on Linux, `build:binary`
    macOS ARM64 on macOS).
  - Verification: `pnpm build` — passes locally (tsc + vite build, chunk-size
    warning only); workflow change validated by inspection (config-only).

- [x] #7 CI lint failures still silently discarded (remediation regression)
  - Branch/worktree: `fix/tr2-07-ci-lint` (`.worktrees/tr2-07`)
  - Commit: `24fcd79`
  - UPDATE_LOG: "Fix: CI lint gate restored (2026-06-12 review #7)"
  - Root cause: the June 11 fix (`5854d3f`, `&` → `&&`) was deliberately
    reverted on `main` (`ff522dd`) because `pnpm ultracite:check` fails with
    17 pre-existing errors — enabling the gate broke CI, so it was turned
    back off instead of fixing the violations.
  - Change: fixed all 17 lint errors — 15 mechanical `substring` → `slice`
    conversions across 9 files (all call sites use non-negative indices, so
    `slice` is behavior-identical; the one `lastIndexOf`-derived bound in
    `FilePreviewPanel.tsx` is clamped with `Math.max(0, …)`), and 2 a11y
    errors in `McpAddServerDialog.tsx` (backdrop gained Escape key handling +
    `role="presentation"`, the panel is `role="dialog"` + `aria-modal`, and
    the inner stopPropagation click handler was replaced with an
    `e.target === e.currentTarget` check on the backdrop). The workflow now
    runs lint and tests as two separate named steps so failures are
    attributable and both gate the build.
  - Verification: `pnpm ultracite:check` — clean; `pnpm typecheck` — pass;
    `pnpm test --run` — 332/332 pass; sidecar `pnpm build` (tsc) + `pnpm test`
    — 117/117 pass.

## Review Later

- #20 TOCTOU race in ephemeral port selection — carried over from June 11
  (#12); proper fix (server binds port 0 itself / bounded retry with identity
  verification) is an upstream behavior change; deferred again.
- #36 Rust backend largely untested — broad test-infrastructure initiative,
  not a single fix; individual fixes in this round add targeted tests
  (migrations, path validation, serde contract) but the initiative remains
  deferred.
- #12 (partial) Full streaming-markdown rework (plain-text streaming render /
  list virtualization) — this round fixes the whole-page re-render via
  granular selectors and throttles parsing; a virtualized chat list (#35
  remainder) stays deferred.

## Out of Scope (this pass)

Low-severity findings #37–#43 were not assessed in this remediation pass.
