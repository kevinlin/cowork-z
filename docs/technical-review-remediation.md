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

- [ ] #22 `file://` enrichment links silently stripped (react-markdown default urlTransform)
- [ ] #24 Always-on debug-log listener: unbounded growth + page re-render
- [ ] #20 Duplicate `onTaskUpdate` listeners double-process completion
- [ ] #18 `update_mcp_config` never sends `workingDirectory`
- [ ] #17 Azure Foundry key dropped by sidecar; inconsistent provider id
- [ ] #13 SSE reconnect timer resurrects after disconnect; no backoff
- [ ] #14 `apiKeys` silently ignored after first initialization
- [ ] #4 OpenCode server password leaked to log file and IPC stdout
- [ ] #10 MCP secrets, HTTP bodies, and SSE events logged in plaintext
- [ ] #5 HTML preview executes untrusted agent JS with a sandbox escape
- [ ] #15 Unused shell permissions exposed to webview windows
- [ ] #8 Git PAT persisted to `.git/config` in plaintext
- [ ] #3 Unrestricted filesystem Tauri commands (write / read / trash)
- [ ] #2 Asset protocol scoped to the entire filesystem
- [ ] #1 Content-Security-Policy is fully disabled

## In Progress

(none)

## Fixed

- [x] #19 `respondToPermission` stale-read loop drops folder grants
  - Branch/worktree: `fix/tr-19-folder-grants` (`.worktrees/tr-19`)
  - Commit: (this commit)
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
