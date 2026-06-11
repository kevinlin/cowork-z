# Technical Review Remediation Tracker

Canonical tracker for remediation of the findings in
[`docs/technical-review_cowork-z.html`](./technical-review_cowork-z.html)
(review of `main` @ `4b26363`, generated June 11, 2026).

Workflow: one git worktree + one commit per issue, integrated sequentially into
`fix/technical-review-remediation`. See
[`docs/specs/plan_technical_review_fixes.md`](./specs/plan_technical_review_fixes.md).

Each fixed entry records: worktree branch, commit hash, `UPDATE_LOG.md` entry
label (under `v0.7.15`), and verification commands with outcomes.

## Queued

- [ ] #15 Unused shell permissions exposed to webview windows
- [ ] #8 Git PAT persisted to `.git/config` in plaintext
- [ ] #3 Unrestricted filesystem Tauri commands (write / read / trash)
- [ ] #2 Asset protocol scoped to the entire filesystem
- [ ] #1 Content-Security-Policy is fully disabled

## In Progress

(none)

## Fixed

- [x] #5 HTML preview executes untrusted agent JS with sandbox escape
  - Branch/worktree: `fix/tr-05-html-preview` (`.worktrees/tr-05`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: HTML preview allowed sandboxed agent content to escape via popups (#5)"
  - Change: `HtmlPreview.tsx` iframe sandbox reduced from
    `allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms`
    to `allow-scripts allow-forms` — scripts still run for interactive
    previews but in an opaque origin with no popup escape route (the
    existing "open externally" action covers full-fidelity needs); `baseHref`
    is now HTML-attribute-escaped before interpolation into `<base href>`.
  - Verification: `tsc --noEmit` — pass; 4 new Vitest tests in
    `src/components/file-preview/__tests__/HtmlPreview.test.tsx` — pass;
    biome check — clean.

- [x] #10 MCP secrets, HTTP bodies, and SSE events logged in plaintext
  - Branch/worktree: `fix/tr-10-plaintext-logs` (`.worktrees/tr-10`)
  - Commit: `02a2b19`
  - UPDATE_LOG: "Fix: MCP secrets, HTTP bodies, and SSE payloads were logged in plaintext (#10)"
  - Change: `redact.ts` now fully redacts the value maps of
    `environment`/`headers`/`env` containers (MCP server configs carry tokens
    under arbitrary key names), which covers the
    `logger.info('Config updated for session', config)` path; full HTTP
    response bodies and SSE event payloads are now logged only when
    `SIDECAR_DEBUG_PAYLOADS=1` is set — by default only metadata (event type,
    method/path/status) is written. Redaction still applies when payload
    logging is enabled.
  - Verification: sidecar `pnpm build` (tsc) — pass; sidecar `pnpm test` —
    116/116 pass, including 6 new tests
    (`__tests__/logger-payload-gating.test.ts` + container redaction case);
    biome check — clean.

- [x] #4 OpenCode server password leaked to log file and IPC stdout
  - Branch/worktree: `fix/tr-04-password-log` (`.worktrees/tr-04`)
  - Commit: `8d5ee76`
  - UPDATE_LOG: "Fix: OpenCode server password was written to plaintext logs and the debug panel (#4)"
  - Change: removed the verbatim `OPENCODE_SERVER_PASSWORD=<value>` debug log
    in `process-manager.ts` (now logs only the length); added a redaction
    layer (`src/redact.ts`) that the Logger applies to every message and data
    payload before writing to file or IPC — values of secret-looking keys
    (password/secret/token/api-key/authorization/credential/access-key) and
    inline `KEY=value` assignments are replaced with `[REDACTED]`.
  - Verification: sidecar `pnpm build` (tsc) — pass; sidecar `pnpm test` —
    110/110 pass, including 6 new tests in `__tests__/redact.test.ts`; biome
    check — clean.

- [x] #14 `apiKeys` silently ignored after first sidecar initialization
  - Branch/worktree: `fix/tr-14-api-key-lifecycle` (`.worktrees/tr-14`)
  - Commit: `277bd7d`
  - UPDATE_LOG: "Fix: API keys added or rotated mid-session were silently ignored (#14)"
  - Change: `initialize()` in `src-tauri/sidecar-opencode/src/index.ts` now
    fingerprints the incoming `apiKeys` (new `api-key-fingerprint.ts`,
    order-insensitive, never logged) and compares against the keys applied at
    server spawn. On change with no active sessions it deliberately restarts
    the OpenCode server (teardown + re-init) so the new env vars apply; with
    active sessions it logs a warning and defers until the next idle task
    start. `SessionManager` gained `activeSessionCount()`.
  - Verification: sidecar `pnpm build` (tsc) — pass; sidecar `pnpm test` —
    104/104 pass, including 6 new tests in
    `__tests__/api-key-fingerprint.test.ts`; biome check — clean.

- [x] #13 SSE reconnect timer resurrects after disconnect; no backoff
  - Branch/worktree: `fix/tr-13-sse-backoff` (`.worktrees/tr-13`)
  - Commit: (this commit)
  - UPDATE_LOG: "Fix: SSE reconnect could resurrect a disconnected stream and retried with no backoff (#13)"
  - Change: `src-tauri/sidecar-opencode/src/event-stream.ts` — the reconnect
    timer handle is now stored and cleared in `disconnect()`, the callback
    re-checks `shouldReconnect`, and reconnects use bounded exponential
    backoff (base × 2^attempts, capped at 60s, reset on successful open).
  - Verification: sidecar `pnpm build` (tsc) — pass; sidecar `pnpm test` —
    98/98 pass, including 5 new tests in `__tests__/event-stream.test.ts`.

- [x] #17 Azure Foundry key dropped by sidecar; inconsistent provider id
  - Branch/worktree: `fix/tr-17-azure-foundry` (`.worktrees/tr-17`)
  - Commit: `8f5af32`
  - UPDATE_LOG: "Fix: Azure Foundry API key was dropped and misreported (#17)"
  - Change: standardized the keychain id on `azure-foundry` (matches the
    frontend provider id and `secure_storage::PROVIDERS`, so
    `get_all_api_key_status` now reports it correctly);
    `save_azure_foundry_config` stores under the new id and
    `get_all_api_keys` falls back to the legacy `azureFoundry` entry; sidecar
    `ApiKeys` gained `azureFoundry` mapped to `AZURE_API_KEY` in the server
    environment.
  - Verification: `cd src-tauri && cargo check` — pass; sidecar `pnpm build`
    (tsc) — pass; sidecar `pnpm test` — pass.

- [x] #18 `update_mcp_config` never sends `workingDirectory`
  - Branch/worktree: `fix/tr-18-mcp-workdir` (`.worktrees/tr-18`)
  - Commit: `943509f`
  - UPDATE_LOG: "Fix: MCP config updates were not routed to the active workspace (#18)"
  - Change: `src-tauri/src/sidecar.rs` — added
    `working_directory: Option<String>` to `UpdateMcpConfigPayload`;
    `src-tauri/src/commands/settings.rs` resolves the active workspace
    (`last_workspace_id` → workspace `folder_path`) and sends it with the
    payload. The sidecar already forwarded `payload.workingDirectory` to
    `client.updateConfig(...)` — no sidecar change needed.
  - Verification: `cd src-tauri && cargo check` — pass.

- [x] #20 Duplicate `onTaskUpdate` listeners double-process completion
  - Branch/worktree: `fix/tr-20-dup-listeners` (`.worktrees/tr-20`)
  - Commit: `fcdd060`
  - UPDATE_LOG: "Fix: Task completion was double-processed by duplicate listeners (#20)"
  - Change: `addTaskUpdate` is now driven by a single global `onTaskUpdate`
    subscription in `src/stores/taskStore.ts` (merged with the existing
    startup-stage listener). Removed the per-component registrations in
    `Sidebar.tsx` and `Home.tsx`; `Execution.tsx` keeps a lightweight listener
    for tool-activity UI state only (no store/persistence path).
  - Verification: `pnpm typecheck` — pass;
    `pnpm test --run src/stores/__tests__/taskStore.test.ts src/pages/__tests__/Execution.test.tsx` — pass.

- [x] #24 Always-on debug-log listener: unbounded growth + page re-render
  - Branch/worktree: `fix/tr-24-debug-listener` (`.worktrees/tr-24`)
  - Commit: `3cd153d`
  - UPDATE_LOG: "Fix: Debug-log listener ran always-on and re-rendered the whole chat (#24)"
  - Change: extracted the debug panel into
    `src/components/chat/DebugLogPanel.tsx`, mounted from `Execution.tsx` only
    when debug mode is enabled — so the `sidecar:log` listener exists only in
    debug mode, log events re-render just the panel, retained logs are capped
    at 500, and list rows use stable `uid` keys instead of `key={index}`.
  - Verification: `pnpm typecheck` — pass; lints clean on both files.

- [x] #22 `file://` enrichment links silently stripped
  - Branch/worktree: `fix/tr-22-file-links` (`.worktrees/tr-22`)
  - Commit: `0531662`
  - UPDATE_LOG: "Fix: file:// links in chat messages were dead (#22)"
  - Change: `src/components/markdown/EnhancedLink.tsx` — new exported
    `fileAwareUrlTransform` that whitelists `file:` on top of react-markdown's
    `defaultUrlTransform`; `src/components/chat/MessageBubble.tsx` passes it to
    all three `ReactMarkdown` instances. Click-time path safety remains
    enforced by `isPathSafe` in `EnhancedLink`.
  - Verification: `pnpm typecheck` — pass;
    `pnpm test --run src/components/markdown/__tests__/EnhancedLink.test.tsx` —
    pass, including a new end-to-end ReactMarkdown regression test.

- [x] #19 `respondToPermission` stale-read loop drops folder grants
  - Branch/worktree: `fix/tr-19-folder-grants` (`.worktrees/tr-19`)
  - Commit: `134c67b`
  - UPDATE_LOG: "Fix: Multi-pattern permission approvals dropped folder grants (#19)"
  - Change: `src/stores/taskStore.ts` — `respondToPermission` now accumulates
    all target folders from the request's patterns and applies them in a single
    functional `set((state) => …)` update, instead of spreading a stale
    `folderPermissions` snapshot once per loop iteration (which kept only the
    last pattern's grant and raced concurrent `addFolderPermission` calls).
  - Verification: `pnpm typecheck` — pass;
    `pnpm test --run src/stores/__tests__/taskStore.test.ts` — pass.

- [x] #21 `StreamingText` conditional return before hooks
  - Branch/worktree: `fix/tr-21-streaming-hooks` (`.worktrees/tr-21`)
  - Commit: `d463d92`
  - UPDATE_LOG: "Fix: StreamingText violated the Rules of Hooks (#21)"
  - Change: `src/components/ui/streaming-text.tsx` — the real-streaming early
    return now sits below the three `useEffect` hooks; each effect no-ops when
    `isRealStreaming` is true, so the hook count is stable if the flag flips on
    a mounted instance.
  - Verification: `pnpm typecheck` — pass;
    `pnpm test --run src/components/ui/__tests__/streaming-text.test.tsx` —
    10/10 pass.

- [x] #23 Chat auto-scroll selector never matches
  - Branch/worktree: `fix/tr-23-autoscroll` (`.worktrees/tr-23`)
  - Commit: `7703d21`
  - UPDATE_LOG: "Fix: Chat auto-scroll never fired on new/streaming messages (#23)"
  - Change: `src/components/chat/MessageList.tsx` — added the `data-messages-end`
    attribute to the existing sentinel div so the auto-scroll effect in
    `src/pages/Execution.tsx` (`querySelector('[data-testid="messages-scroll-container"] [data-messages-end]')`)
    actually finds its target.
  - Verification: `pnpm typecheck` — pass.

- [x] #16 CI silently discards lint failures
  - Branch/worktree: `fix/tr-16-ci-lint` (`.worktrees/tr-16`)
  - Commit: `5854d3f`
  - UPDATE_LOG: "Fix: CI silently discarded lint failures (#16)"
  - Change: `.github/workflows/test.yml` — `pnpm ultracite:check & pnpm test --run`
    → `pnpm ultracite:check && pnpm test --run`, so a lint/format violation now
    fails the step instead of being backgrounded.
  - Verification: config-only change, validated by inspection of the workflow
    diff (no code paths affected).

## Ignored

- #6 Orphaned `opencode serve` process on shutdown — **stale**: already fixed on
  `main` by commit `74009c5` ("Fix: Orphaned `opencode serve` process on app
  shutdown", `UPDATE_LOG.md` v0.7.15) after the review snapshot was taken.
- #7 `task_complete` status disagrees across all three IPC layers — **stale**:
  already fixed on `main` by commit `4ff0c77` ("Fix: Aligns the Rust mapping
  with the frontend") after the review snapshot was taken.

## Review Later

- #9 DB mutex poisoning causes cascading panics — needs a considered design for
  centralized DB access (poison recovery vs. `Result`-surfacing helper) across
  ~20 call sites; deferred.
- #11 Server password embedded in the LLM system prompt — agent self-access is
  an intentional feature; replacing the inline credential with a scoped token
  or runtime env lookup needs design work with the OpenCode server.
- #12 TOCTOU race in ephemeral port selection — low practical likelihood;
  proper fix (server binds port 0 itself / bounded retry) is an upstream
  behavior change; deferred.
- #25 Full markdown re-parsed on every streaming delta — performance work
  (throttled flush + plain-text streaming render) with UX implications;
  deferred.
- #26 Rust backend largely untested — broad test-infrastructure effort, not a
  single fix; deferred to its own initiative.

## Out of Scope (this pass)

Low-severity findings #27–#35 were not assessed in this remediation pass.
