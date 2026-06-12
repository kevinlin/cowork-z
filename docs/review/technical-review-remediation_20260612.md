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

CI / repo hygiene:

- [ ] #31 CI gaps: no typecheck, no production build
- [ ] #33 Husky pre-commit hook skips all `.tsx` files
- [ ] #32 No dependency-audit automation; `.gitignore` lacks `.env`
- [ ] #34 Floating versions on security-sensitive build dependencies

Filesystem sandbox:

- [ ] #2 Unscoped `read_directory` allows arbitrary filesystem enumeration
- [ ] #3 Workspace permission grants persisted without path validation
- [ ] #4 Path traversal in `skills_delete_installed` via unsanitized `skill_id`
- [ ] #15 Workspace validator allows any non-home path without canonicalization
- [ ] #10 Agent-triggered file previews bypass `isPathSafe`
- [ ] #30 Opener capability still grants `$HOME/**`

Secret handling:

- [ ] #6 API keys escape redaction into plaintext logs
- [ ] #13 `get_api_key` command returns the full keychain secret to the webview
- [ ] #28 Streaming debug logs write full message text in production
- [ ] #5 All provider API keys sent in bulk over sidecar IPC on every task start
- [ ] #1 OpenCode server password embedded in every LLM system prompt (CRITICAL)

Sidecar lifecycle:

- [ ] #8 Unserialized concurrent stdin command handling in the sidecar
- [ ] #18 Sidecar marked ready immediately after spawn (no handshake)
- [ ] #9 `sendMessage` failures swallowed — tasks hang with no error surfaced
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

- [x] #7 CI lint failures still silently discarded (remediation regression)
  - Branch/worktree: `fix/tr2-07-ci-lint` (`.worktrees/tr2-07`)
  - Commit: (this commit)
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
