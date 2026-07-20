# Plan: Typed sidecar event bridge

## Context

`docs/architecture/Architecture review.mhtml`, candidate 1 — *Collapse the sidecar event relay into a typed bridge*:

> The relay from sidecar to UI is a shallow pass-through chain: every module re-declares the event shape it just received, then forwards it. The Rust arm is stringly-typed: a forgotten match arm drops the event with a `println!`, no compile error.

Adding one sidecar event today requires edits in 7 files across 3 runtimes, none of which the toolchain cross-checks:

1. `sidecar-opencode/src/types.ts` — union member + payload interface
2. `session-manager.ts` — untyped `this.emit('kebab-name', …)`
3. `index.ts` — `sessionManager.on(…)` with an inline re-declared type
4. `sidecar.rs:624-683` — string rename arm (snake_case → `namespace:colon`)
5. `src/shared/types/task.ts` — payload type
6. `src/lib/tauri-api.ts` — `listen<inline generic>` + double unwrap + `onX` export
7. `src/lib/tauri-api-interface.ts` — third mirror, already incomplete

Verified failure modes this has already produced:

- **`sidecar.rs:679-682`** — unknown event type → `println!` + `return`. Silent drop, no compile error.
- **`tauri-api.ts:1004`** — listens for `task:update`. Repo-wide grep: nothing emits it. Dead adapter.
- **`tauri-api.ts:1143`** — `onTaskProgress` types the payload as bare `TaskProgress`, but Rust wraps it as `{taskId, payload:{stage}}`. Every field reads `undefined`, so the ThinkingIndicator startup message (`taskStore.ts:1147-1162`) has **never worked**.
- **`taskStore.ts:1141`** — `STARTUP_STAGES` has **zero overlap** with the stages `session-manager.ts` actually emits (`configuring`, `executing`).
- **`tauri-api.ts:1025-1031`** — `onTaskUpdate`'s `task:progress` arm reads `payload.progress`; no such key exists. Never fires.
- **`sidecar.rs:489` vs `:678`** — two incompatible payload shapes on the name `sidecar:error`.
- Zero tests, in either language, assert that sidecar type X produces Tauri event Y.

**Intended outcome:** one generic Rust forwarder (`sidecar:{type}`) + one typed side-effect registry; one typed frontend subscription helper keyed off the sidecar's own union. New event = `types.ts` + one handler. Rename table and payload re-wrap deleted.

**Scope decisions (agreed):** frontend is *rewire-internals-only* — every exported `onX` wrapper in `tauri-api.ts` keeps its signature, so `taskStore` / `Execution.tsx` / `Arena.tsx` / `Home.tsx` / `useMcpRuntime` / `CopilotProviderForm` are untouched. The one exception is the `task_progress` fix, which necessarily reaches `taskStore.ts`.

### Two corrections found during design

- **Partial-line buffering** — `tauri-plugin-shell` already reassembles on `\n` *or* `\r` (`tauri-utils/src/io.rs:24-33`), so a chunk-split JSON object is not the real risk. The real gap is a bare `\r` (progress spinner, dependency terminal output) splitting an object, plus `sidecar.rs:457`'s `if let Ok(…)` swallowing *any* non-JSON stdout without diagnostic. Work item survives, reduced.
- **`task_progress` vocabulary** — three independent stage vocabularies exist. `SetupProgressEvent.isFirstTask` and `.modelName` (`taskStore.ts:24-25`) have no producer anywhere and are permanently `undefined`.

---

## Design

### Rust — `src-tauri/src/sidecar.rs`

**Delete:** `SidecarEvent` struct (`:244-252`), the 22-arm rename table (`:624-683`), the unknown-arm silent drop (`:679-682`), the `{taskId, payload}` re-wrap (`:685-693`).

**Add** a typed side-effect enum covering only the two events Rust acts on. Serde constraints verified against `serde_derive/src/internals/check.rs:150-188` — `#[serde(other)]` needs internally-tagged + unit variant + last position; all three hold.

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
enum SidecarSideEffect {
    RequestApiKeys { payload: RequestApiKeysPayload },
    TaskComplete { task_id: String, payload: TaskCompletePayload },
    #[serde(other)]
    Ignored,
}
```

`status: String` (not an enum) so `map_completion_status` keeps its `_ => "failed"` catch-all rather than turning an unknown status into a decode error.

`handle_sidecar_event(app, value: serde_json::Value)`:

1. Read `type` as `&str`; no `type` → one `eprintln!`, return.
2. `SidecarSideEffect::deserialize(&value)` — `serde_json` impls `Deserializer` for `&Value` (`value/de.rs:817`), so this is a zero-clone decode off the already-parsed line.
   - `RequestApiKeys` → `spawn_api_keys_response(app, request_id)` (the body currently inlined at `:596-621`, lifted verbatim), then **return without forwarding** — unchanged behaviour.
   - `TaskComplete` → `handle_task_completion_internal(app, &task_id, map_completion_status(&payload.status), payload.session_id.as_deref())`. Keep the `:636-640` comment explaining why this must run in Rust (macOS WKWebView throttles the frontend listener when backgrounded).
   - `Ignored` → no-op. **A missing arm can no longer drop an event.**
   - `Err` → loud `eprintln!`, then forward anyway.
3. Forward the **whole original event object**, verbatim, under `sidecar:{type}`. Frontend sees `event.payload.{type,taskId,payload}` — one unwrap.

Extract two pure helpers so they become unit-testable:

- `tauri_event_name(&str) -> Option<String>` — prefixes `sidecar:`, rejecting empty or non-`[A-Za-z0-9_-]` types. Guard mirrors Tauri's own validation (`tauri/src/event/event_name.rs:8-12`) so a malformed `type` yields one diagnostic instead of `Error::IllegalEventName`.
- `map_completion_status(&str) -> &'static str` — `success`→`completed`, `aborted|cancelled|interrupted`→`interrupted`, `_`→`failed`.

**`ready` stays exactly where it is** — set on the `AtomicBool` in the reader loop *before* dispatch, outside the side-effect enum, because `start()` polls it at `:521-527` and must not race the emit.

**Namespace invariant** replaces the `sidecar:error` collision patch:

- `sidecar:{type}` — always a verbatim sidecar event.
- `sidecar:process_*` — always Rust-origin, about the child process.

So `:489` `sidecar:error` → `sidecar:process_error`, and for symmetry `:504` `sidecar:terminated` → `sidecar:process_terminated`. Neither has a frontend listener, so zero churn.

### Rust — line assembly

Extract from the `async` reader loop (currently unreachable from any test):

```rust
struct LineAssembler { carry: String }
enum LineOutcome {
    Pending,                                   // held: looks like a \r-split object
    Event(serde_json::Value),
    Dropped { reason: String, sample: String } // never silent
}
```

`push(&mut self, chunk: &str)`:

- Reject anything not starting with `{` immediately — every sidecar event is `console.log(JSON.stringify(event))` (`index.ts:28-30`). This stops stray stdout being carried over and poisoning the *next* line.
- **Attempt the parse before deciding to hold**, so a `\r`-terminated chunk that already contains a complete object dispatches immediately.
- Hold only when the parse failed *and* the chunk was not `\n`-terminated *and* `carry.len() <= MAX_CARRY_BYTES` (1 MiB).
- Otherwise `Dropped` with a truncated 512-byte sample; clear `carry`.

Call site: one `LineAssembler` declared before `while let Some(event) = rx.recv().await` — owned by the single reader task, no lock. Raw-chunk log write at `:448-455` stays **first and unchanged**, so the log file remains a faithful stdout transcript regardless of assembler grouping. `Dropped` additionally writes a `[stdout-drop]` line.

### Type sharing — path alias, not a fourth mirror

`src-tauri/sidecar-opencode/src/types.ts` is 492 lines of pure `interface`/`type`, zero imports, zero runtime code. Verified it typechecks clean under the *root* tsconfig's flags (`--strict --noUnusedLocals --noUnusedParameters --isolatedModules --moduleResolution bundler …`) → exit 0.

Copying it into `src/shared/types/` would create mirror #4 with no compiler link — the exact failure this refactor exists to end. (`Todo` is *already* duplicated verbatim: `types.ts:163-168` vs `src/shared/types/task.ts:162-167`.)

Add to `tsconfig.json` `paths`, and to `resolve.alias` in **both** `vite.config.ts` and `vitest.config.ts`:

```jsonc
"@sidecar/*": ["src-tauri/sidecar-opencode/src/*"]
```

Notes: `include: ["src"]` needs no change — TS pulls imported files into the program regardless. `import type` is mandatory (`isolatedModules: true`), which erases the runtime import, making the Vite alias strictly optional; add it anyway so a future accidental *value* import fails loudly at resolve time. `server.watch.ignored: ["**/src-tauri/**"]` means no HMR on `types.ts` edits — type-only, so no runtime impact; leave it. Biome/ultracite already covers `src-tauri/sidecar-opencode/`. New coupling to accept: a future sidecar edit can now break `pnpm typecheck` from outside `src/` — note this in the `types.ts` header.

### Frontend — `src/lib/sidecar-bridge.ts` (new)

```ts
import type { SidecarEvent } from '@sidecar/types';

export type SidecarEventType = SidecarEvent['type'];
export type SidecarEventOf<K extends SidecarEventType> = Extract<SidecarEvent, { type: K }>;

export function onSidecarEvent<K extends SidecarEventType>(
  type: K,
  handler: (event: SidecarEventOf<K>) => void
): Promise<UnlistenFn> {
  return listen<SidecarEventOf<K>>(`sidecar:${type}`, (e) => handler(e.payload));
}
```

`Extract<SidecarEvent, { type: K }>` is the load-bearing piece: a new union member in `types.ts` is immediately a legal `K` with a typed payload, and nothing in this file needs touching. Works identically for the three members that inline their payload literal (`pong`, `mcp_tools_changed`, `request_api_keys`).

The handler receives the **whole event**, not just `payload`, because `taskId` is a *sibling* of `payload` on 10 of 22 members — `{ taskId, payload }` destructuring at the call site beats two accessors.

Representative rewrites in `tauri-api.ts` (signatures unchanged):

```ts
// onTodoUpdated — 9 lines to 3, todos now typed from the sidecar
return onSidecarEvent('todo_updated', ({ taskId, payload }) => {
  callback({ taskId, todos: payload.todos });
});
```

`onTaskUpdate` keeps its aggregator API but drops from 6 listeners to **4** — `task:update` deleted (nothing emits it), `task:progress` deleted (arm never fired; the only downstream reader is a dedup-key branch at `taskStore.ts:780`, so reviving it would add churn and no behaviour). Keep the defensive runtime guards in the hot-path wrappers (`onTaskMessagePartial`) and the `task_error` stringify fallback — the wire stays untrusted regardless of what the types claim.

### Frontend — `task_progress` fix: adopt the sidecar vocabulary

`session-manager.ts` emits only `configuring` (`:351`, `:413`) and `executing` (`:93`, `:375`, `:432`). Rather than add a translation table between two vocabularies — the pattern this refactor deletes — make the sidecar's union the single source of truth:

1. `src/shared/types/task.ts:86-93` — `StartupStage` becomes the sidecar's `'starting'|'connecting'|'configuring'|'executing'|'completing'`.
2. `taskStore.ts:1141` — `STARTUP_STAGES = ['starting', 'configuring', 'connecting']`.
3. `taskStore.ts:1157` — clear-trigger changes from `'tool-use'` to `'executing'`.
4. `tauri-api.ts:1142-1144` — fix the unwrap, synthesise the `taskId` the store expects.
5. `taskStore.ts:20-26` — delete `isFirstTask` and `modelName` from `SetupProgressEvent`; no producer exists.
6. `ThinkingIndicator.tsx:58` — the `isFirstTask && stage === 'browser'` branch becomes provably unreachable. Delete it, and call it out in review rather than folding it in silently.

Net: `configuring` finally lights the startup message, `executing` clears it. First time this feature will have worked.

---

## Tasks

Sequenced so the wire format changes exactly once, at step 4. Each step compiles independently.

| # | Task | Verify |
|---|---|---|
| 1 | Extract `LineAssembler` / `LineOutcome` into `sidecar.rs`; rewire the reader loop (`:445-464`). Leave the old `SidecarEvent` + rename path intact, called via `serde_json::from_value`. | `cargo check`; new tests group D pass; app runs end-to-end — no wire change yet |
| 2 | Add `SidecarSideEffect` + payload structs + `map_completion_status` + `tauri_event_name`. Extract `spawn_api_keys_response`. Not yet wired. | `cargo check`; tests groups A–C |
| 3 | Rename `:489` → `sidecar:process_error`, `:504` → `sidecar:process_terminated`. | `grep -rn "sidecar:error\|sidecar:terminated" src/` → empty |
| 4 | **Wire change.** Replace `handle_sidecar_event` body; delete `SidecarEvent` (`:244-252`) + rename table (`:624-683`). | `cargo check && cargo test`; frontend intentionally red |
| 5 | Add `@sidecar/*` to `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`. Create `src/lib/sidecar-bridge.ts`. | `pnpm typecheck` (watch `noUnusedLocals`) |
| 6 | Rewrite all 18 `onX` bodies in `tauri-api.ts` on `onSidecarEvent`. Delete the `task:update` and `task:progress` arms from `onTaskUpdate`. | `pnpm typecheck && pnpm test`; `grep -n "payload?.payload" src/lib/tauri-api.ts` → empty; no raw `'task:'`/`'mcp:'`/`'copilot:'` listen strings remain |
| 7 | `task_progress` vocabulary fix, steps 1-6 above. | `pnpm typecheck && pnpm test` incl. `taskStore.test.ts` |
| 8 | Backfill `tauri-api-interface.ts` — add the four missing methods (`onQuestionRequest`, `onTaskMessagePartial`, `onTaskMessageComplete`, `onTodoUpdated`) + `toSyncUnlisten` adapters (`:359-378`). | `pnpm typecheck` |
| 9 | Docs — see below. | links resolve; `/spec-lint` clean |
| 10 | Full gate + manual smoke. | see Verification |

### Step 9 — documentation

- **New:** `docs/specs/opencode-integration/plan_typed-sidecar-bridge.md` — this plan, project-formatted.
- **`docs/specs/chat-ux/design_chat-ux.md`:**
  - *Layer 3: Rust IPC Bridge* (`:126-140`) — replace the rename table with the generic forwarder + side-effect registry; add a `> **Plan:**` link.
  - *Layer 4: Frontend Event Listeners* (`:142-166`) — new `sidecar:{type}` names, single unwrap, `sidecar-bridge.ts`.
  - *Complete Data Flow Diagram* (`:173-234`) — update edge labels to `sidecar:task_message_partial` etc.
  - *Thinking Indicator* (`:534-553`) — startup-stage priority now actually fires; correct the stage vocabulary.
  - *Key Source Locations* (`:712-731`) — add `src/lib/sidecar-bridge.ts`.
  - *Resolved Issues* — add **Startup Stage Indicator Never Displayed** (root cause: double-wrap mismatch + zero-overlap vocabulary).
- **`docs/specs/requirements.md`** — add the plan to the Implementation Plans Index; §911.3 (`task_complete` handled synchronously in Rust) still holds, but reword to name the side-effect registry.
- **`UPDATE_LOG.md`** — under `## v0.8.6`, user-facing framing:
  > **Typed sidecar event bridge** — Reworked how events travel from the agent process to the UI. Previously each event had to be hand-registered in seven places across three languages, and a missed registration dropped the event silently. Events are now forwarded generically and typed end to end, so a mismatch is a build error instead of a feature that quietly does nothing. Along the way this fixed the startup progress message ("Starting OpenCode server…"), which had never displayed, and removed two dead event listeners. Sidecar output that can't be parsed is now logged instead of discarded.

---

## Verification

**Gate:** `pnpm typecheck && pnpm test --run && pnpm ultracite:check` and `cd src-tauri && cargo check && cargo test && cargo clippy`.

**New tests** — there is currently *zero* coverage asserting sidecar type X → Tauri event Y in either language.

Rust, extending the existing `mod tests` (`sidecar.rs:859-908`):

- **A. `tauri_event_name`** — `task_message_partial` → `sidecar:task_message_partial`; rejects `""`, `"evil name"`, `"../x"`, `"a:b"`.
- **B. `map_completion_status`** — table over `success|error|cancelled|aborted|interrupted|""|garbage`. This is one of three copies (see Risks); pin it.
- **C. `SidecarSideEffect` decode** — `task_complete` full / without `sessionId` (→ `None`, not an error) / `request_api_keys` / `task_message_partial` → `Ignored` / **`{"type":"a_brand_new_event"}` → `Ignored`**. That last one is *the* regression test for the review's complaint.
- **D. `LineAssembler`** — `\n`-terminated object → `Event`; object split by bare `\r` → `Pending` then `Event`; `\r`-terminated *complete* object → `Event` immediately; plain text → `Dropped` + carry cleared; garbage then valid object → `Dropped` then `Event` (proves no poisoning); over-cap → `Dropped`.

Frontend, `src/lib/__tests__/sidecar-bridge.test.ts` (mock `listen`, following `src/hooks/__tests__/useMcpRuntime.test.ts`):

- `onSidecarEvent('todo_updated', h)` subscribes to exactly `'sidecar:todo_updated'`.
- A Tauri envelope `{payload:{type,taskId,payload}}` delivers `{type,taskId,payload}` — the **single-unwrap** assertion.
- Compile-time exhaustiveness guard: `const ALL_EVENT_TYPES: Record<SidecarEventType, true> = { … }`. Adding a union member to `types.ts` now breaks this test's compilation — the closest thing to Rust match exhaustiveness that TS offers, and the payoff for the `@sidecar` alias. Drive the name-derivation assertions off its keys.

Plus, in `tauri-api` tests:

- `onTaskUpdate` + `sidecar:task_complete` `{status:'aborted'}` → `{type:'complete', result:{status:'interrupted'}}`.
- `onTaskProgress` + `sidecar:task_progress` `{stage:'configuring'}` → `{taskId, stage:'configuring'}`. **Write this first and watch it fail** — it is the proof bug (a) was real.

**Manual smoke** (`pnpm tauri dev`) — nothing automated crosses the process boundary, so this is load-bearing. One pass per event family: start a task (`task_started`, `task_progress` → confirm the startup message now renders, streaming partial/complete), a tool needing approval (`permission_request`), a question (`question_request`), a todo write (`todo_updated`), completion (check the DB row is `completed`/`interrupted`/`failed`), an automation run end-to-end (the `task_complete` side effect — background the app to exercise the WKWebView-throttling case), MCP connect (`mcp_status`/`mcp_tools`/`mcp_tools_changed`), Copilot OAuth (all three), the debug panel (`sidecar:log`), and a provider key change (`request_api_keys`).

---

## Risks

**Can break silently at runtime:**

1. **The 18 event-name changes have no compile-time link.** Rust emits a string template; the frontend subscribes with another. If step 4 lands and step 6 misses a wrapper, that feature goes dead with no error in either language — the same failure class the refactor removes, concentrated into one deploy. Mitigation: 4 and 6 ship together; the step-6 greps are the checklist; the `Record<SidecarEventType, true>` guard catches *additions* but not *omissions*, so the manual smoke matters.
2. **The unwrap change is invisible to TypeScript.** `e.payload` is whatever Tauri deserialised; typing it `SidecarEventOf<K>` is an assertion. Most stale `.payload.payload` reads become type errors, but not all. Grep after step 6, expect zero hits.
3. **Reviving `task_progress` makes a dead path live.** The ThinkingIndicator will render text it has never rendered in production. Blast radius is small (`addTaskUpdate` only used progress for a dedup key) but eyeball it.

**Flagged, out of scope — do not fix here:**

4. **Completion status is mapped in three places with three vocabularies:** `sidecar.rs:649-653` → `completed|interrupted|failed`; `tauri-api.ts:977-995` → `success|interrupted|error`; `taskStore.ts:889-897` → back to `completed|interrupted|failed`. They disagree: Rust maps `interrupted`→`interrupted`, the frontend has no such case and falls through to `error`. This refactor moves copy #1 into a tested `map_completion_status`, which makes the divergence *visible* but does not resolve it. Own issue.
5. **`taskStore.ts:822-827` calls `api.completeTask`, duplicating the Rust DB write** (`commands/tasks.rs:486-494`). Both run every completion; last write wins. The Rust path exists *because* the frontend one is unreliable when backgrounded, so the frontend call is now pure redundancy — but removing it is a behaviour change needing its own verification.
6. **`tauri-api-interface.ts` stays a hand-maintained mirror** even after step 8. Deriving it (`type TauriAPI = { [K in keyof typeof tauriApi]: … }`) would delete ~120 lines and make `toSyncUnlisten` a mapped type. Obvious follow-up; note in the PR.
7. **`rename_all_fields` needs serde ≥ 1.0.181.** `Cargo.lock` pins 1.0.228; `Cargo.toml:25` says `"1"`. A lockfile-less build on old serde fails loudly, not silently. Consider tightening the constraint.

---

## Critical files

- `src-tauri/src/sidecar.rs` — forwarder, side-effect registry, line assembly
- `src/lib/sidecar-bridge.ts` — **new**, typed subscription helper
- `src/lib/tauri-api.ts` — 18 wrapper bodies rewritten, signatures frozen
- `src-tauri/sidecar-opencode/src/types.ts` — becomes the single source of truth (read-only in this change)
- `src/stores/taskStore.ts`, `src/shared/types/task.ts`, `src/components/chat/ThinkingIndicator.tsx` — `task_progress` fix only
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` — `@sidecar` alias
- `docs/specs/chat-ux/design_chat-ux.md`, `docs/specs/opencode-integration/plan_typed-sidecar-bridge.md`, `docs/specs/requirements.md`, `UPDATE_LOG.md`
