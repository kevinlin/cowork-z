# Plan: OpenCode v2 Migration

**Status:** Phase 0 shipped in 0.9.3 (`5be5708`). Spike (task 1.0) done, see section 6. Phases 1–3 next · **Date:** 2026-10-27 · **Releases:** 0.9.3 (hotfix), 1.0.0 (migration)
**Requirements:** 1.2.1, 1.2.2 (same as [Sidecar OpenCode Rewrite](opencode-integration/plan_sidecar-opencode-rewrite.md))
**Contract snapshot:** [`opencode-api-v2.json`](opencode-api-v2.json), taken from `opencode serve` 2.2.0 `GET /openapi.json`
**Upstream guide:** <https://opencode.ai/v2/docs/migrate-v1/>
**Review:** independent spec review on 2026-10-27 found 9 blocking and 3 advisory findings. All are accepted and folded in below.

Decisions already made:

- Cowork-Z supports **OpenCode v2 only** after 1.0.0. v1 gets a clear error with an install hint.
- A small **Phase 0 hotfix (0.9.3)** ships first so v2 users get a clear message instead of a 15 s timeout.

---

## 1. Symptom and root cause

Symptom: once the global `opencode` CLI is v2.2.0 (`@opencode/cli`), every task fails with:

```
OpenCode server failed to start after 15000ms. Last error: Cannot read properties of null (reading 'version')
```

Source: `~/.local/share/opencode/log/2026-10-27_22-49-11_TS.log`.

Root cause, confirmed against a throwaway `opencode serve` 2.2.0:

- v2 replaced the whole HTTP API. Every v1 route is gone and the v2 API lives under `/api/*`.
- v2 serves its web UI for unknown paths, so `GET /global/health` comes back as **HTTP 200 `text/html`**.
- `OpenCodeClient.request()` ([opencode-client.ts:57](../../src-tauri/sidecar-opencode/src/opencode-client.ts#L57)) turns the failed `.json()` parse into `null`. `waitForServer()` ([process-manager.ts:616](../../src-tauri/sidecar-opencode/src/process-manager.ts#L616)) then reads `health.version` from that `null` 30 times and gives up.
- Every other v1 call fails the same silent way. The log shows `GET /session/…/todo -> 200` followed by `todos: null`, and `POST /global/dispose` gets a 405.
- Behind the startup failure sit more breaks (SSE, prompt, permissions, questions, config). Each one would fail as soon as the previous one was fixed. Section 2 lists them all.

Still the same in v2:

- Basic auth `opencode:$OPENCODE_SERVER_PASSWORD` (a request without it gets 401).
- `serve --port --hostname`.
- The `OPENCODE_CONFIG_CONTENT` and `OPENCODE_CONFIG` env vars.
- SSE frames are plain `data:` lines with no named `event:`, so the `eventsource` `onmessage` handler still fires.

Packaging constraint: the official `@opencode/client` 2.2.0 is ESM-only. The sidecar is CommonJS bundled with `pkg`, so keep the hand-rolled fetch client.

---

## 2. v1 → v2 contract map

This table covers only the calls and events Cowork-Z uses today. Every OpenCode HTTP call goes through [opencode-client.ts](../../src-tauri/sidecar-opencode/src/opencode-client.ts), and SSE goes through [event-stream.ts](../../src-tauri/sidecar-opencode/src/event-stream.ts). Rust and the frontend never call OpenCode directly.

| Concern | v1 (today) | v2.2.0 |
|---|---|---|
| Health | `GET /global/health` → `{version}` | `GET /api/info` → `{version, pid, urls, paths}` |
| Shutdown | `POST /global/dispose` | No equivalent. SIGTERM only |
| Event stream | `GET /global/event`. Frame `{directory, payload:{type, properties}}` | `GET /api/event`. Frame `{id, created, type, location?:{directory}, data}`. **Volatile by contract:** events sent while the stream is down are lost, and a slow consumer kills the stream |
| Workspace scoping | `?directory=` on most calls | `location:{directory}` in the session-create body. Location-scoped GETs take a `deepObject` query parameter, so the wire format is **`?location[directory]=<encoded path>`**. Session routes need no scoping |
| Create session | `POST /session {title}` | `POST /api/session {location, model:{providerID,id}, permissions}` → `{data: Session}` |
| Update session | `PATCH /config` with permissions | `PATCH /api/session/{id} {permissions}` replaces a session's rules (also accepts `title`, `metadata`, `archived`) |
| Send a turn | `POST /session/{id}/message {parts, model, system}`. Blocks until the turn ends | `POST /api/session/{id}/prompt {text}` → `{data: inbox message}`. The server "durably admits" the input and then schedules the run. **No `system` field and no `model` field** |
| Model per task | Sent with each message | Session-level: in the create body, or `POST /api/session/{id}/model {model}` |
| System prompt | `system` field on each message | Candidate: `PUT /api/experimental/session/{id}/instructions/entries/{key} {value}` (a 12 KB value was accepted). Needs the spike in task 1.0 |
| Runtime config | `PATCH /config` with permission, model, mcp, provider | `PATCH /api/experimental/config` accepts `{shell}` only. Use per-session `permissions`, the MCP runtime routes, and on-disk or env config |
| Permission rules | Map `{edit:{pattern: action}}`; `bash` | Ordered array `[{action, resource, effect}]`; the last matching rule wins. Renames: `bash`→`shell`, `task`→`subagent`, `write`/`patch`→`edit`. No `doom_loop`. **`external_directory` is allow by default.** **Workspace files are matched by location-relative path** (`Output/a.txt`). External files: `external_directory` checks `<dir>/*`, then `read`/`edit` check the absolute path |
| Permission ask | `permission.asked {permission, patterns, metadata}` | `permission.asked` with `data {id, sessionID, action, resources, metadata, message?}`. Pending asks can be listed with `GET /api/session/{sid}/permission` |
| Permission reply | `POST /permission/{id}/reply {reply}` | `POST /api/session/{sid}/permission/{rid}/reply {decision, message?}` |
| Questions | `question.asked {questions[]}`. Reply `POST /question/{id}/reply {answers: string[][]}` | Forms. `form.created` with `data {form:{id, sessionID, title, fields[]}}`. Field types: `string` (optional `options`, `custom`), `multiselect` (`options`, `custom`), `number`, `integer`, `boolean`, `external`. Reply `POST /api/session/{sid}/form/{fid}/reply {answer:{[field.key]: value}}`. Pending forms: `GET /api/session/{sid}/form` |
| Abort | `POST /session/{id}/abort` | `POST /api/session/{id}/interrupt` → `{interrupted}` |
| Streaming text | `message.updated` + `message.part.delta` | `session.text.delta {assistantMessageID, ordinal, delta}`, then `session.text.ended {text}` |
| Tool calls | `message.part.updated` with `part.type==='tool'`, `part.tool`, `part.state` | `session.tool.input.started {id, name}` → `session.tool.called {id, input}` → `session.tool.success {content: [text/file items]}` or `session.tool.failed {error:{type, message}}`. **The tool name is only in `input.started`** |
| Turn lifecycle | `session.status` busy/idle, `session.error` | `session.execution.started`, `.succeeded`, `.failed {error:{type, message}}`, `.interrupted {reason}`. The spike saw **no** `session.idle` or `session.status` events. Rejecting a permission ends the turn with `.interrupted` (reason `shutdown`) |
| Compaction | `session.compacted` | `session.compaction.ended` |
| Todos | `todo.updated` event and `GET /session/{id}/todo` | Both removed. With `experimental.todo: true` the agent gets a `todowrite` tool whose input is `{todos: [{content, status}]}` (no `id`, no `priority`) |
| MCP | `GET /mcp` (record), `POST /mcp/{name}/connect`, `/disconnect`, `GET /experimental/tool/ids`, `PATCH /config {mcp}` | `GET /api/mcp` → `{location, data: [{name, status: {status, error?}}]}`. Seen values: `disabled`, `failed`. The list also includes servers from the user's global `~/.config/opencode` config. `PUT /api/experimental/mcp/{name}` adds or replaces a server at runtime and connects it. `DELETE /api/experimental/mcp/{name}`. `POST …/{name}/connect`, `/disconnect`. **No tool-ids route** |
| Copilot OAuth | `POST /provider/{id}/oauth/authorize`, then a blocking `/callback` | Integration `github-copilot`, method `device`. `POST /api/integration/github-copilot/connect/oauth {methodID: 'device', answer: {deploymentType: 'github.com'}}`, or for enterprise `{deploymentType: 'enterprise', enterpriseUrl}` → `{attemptID, url, instructions, mode}`. Poll `GET …/{attemptID}` (pending, complete, failed, expired). `POST …/{attemptID}/complete {code?}`. v2 has one provider, `github-copilot`, for both deployment types |
| Copilot models and logout | `GET /provider` (`all[].models`), `DELETE /auth/{id}` | `GET /api/model` → `data[] {id, modelID, providerID, name, enabled, status}`. Logout: the connection ids from `GET /api/integration` (no secrets), then `DELETE /api/credential/{id}`. **Never call `GET /api/credential`: it returns every stored secret** |
| Config file keys | `mcp`, `provider`, `small_model`, `enabled_providers`, `disabled_providers` | `mcp.servers` (with `enabled` inverted to `disabled`), `providers`, `agents.title.model`, `policies`. Verified: v1 `small_model` and `mcp` sent through `OPENCODE_CONFIG_CONTENT` are normalised, and that env config reaches every location. **`opencode.json` in the server's cwd is not read** |
| Install | `npm i -g opencode-ai` (npm still has 1.19.4) | `npm i -g @opencode/cli`, or the curl installer. Both packages install an `opencode` binary |

---

## 3. Strategy

- **Keep the IPC contract.** `SidecarEvent` and `SidecarCommand` keep their shape. The sidecar handles the v2 differences, so `sidecar.rs` and the Rust mirror need no edits.
  - The one exception is an additive optional `custom` flag on question payloads (task 1.3). Rust passes that payload through untyped.
- **Rebuild the v1 tool part in the sidecar.** The frontend reads tool calls through `normalizeOpenCodeMessage` ([tauri-api.ts:890-946](../../src/lib/tauri-api.ts#L890-L946)), which expects `tool`, `callID`, `messageID` and `state.{status, input, output}`. The normaliser keeps `output` only when it is a string ([tauri-api.ts:929](../../src/lib/tauri-api.ts#L929)). The sidecar builds that shape from the v2 tool events, so the chat UI needs no change.
- **Treat the event stream as lossy.** v2 drops events sent while the stream is down. Whenever the stream reconnects, the sidecar rebuilds session state over REST (task 1.2).
- **v2 only.** Detect v1 at startup and fail fast with an install hint.
- **One shared guard.** HTML-200 detection lives in `request()`, so every caller gets it.

Expected frontend touch points, all small:

- The install hint in Rust ([opencode_cli.rs](../../src-tauri/src/commands/opencode_cli.rs)).
- Copilot device-code parsing, if v2 changed the `instructions` text ([CopilotProviderForm.tsx:73-85](../../src/components/settings/providers/CopilotProviderForm.tsx#L73-L85)).
- `QuestionDialog.tsx` shows its "Others" option only when the new `custom` flag isn't `false` ([QuestionDialog.tsx:51-56](../../src/components/chat/QuestionDialog.tsx#L51-L56)).

---

## 4. Tasks

### Phase 0: hotfix on the current v1 code (release 0.9.3)

**0.1 Fail on HTML 200.**
- File: [opencode-client.ts](../../src-tauri/sidecar-opencode/src/opencode-client.ts) `request()`.
- When a 2xx response is `text/html`, throw `Error('OpenCode route not found: <method> <path> (unsupported OpenCode version?)')` instead of returning `null`.
- Leave empty and JSON bodies alone (`disconnectMcpServer` returns no body). v1 declares JSON for every call this client makes, so a healthy v1 server never trips the guard.

**0.2 Fail fast on v2.**
- File: [process-manager.ts](../../src-tauri/sidecar-opencode/src/process-manager.ts) `waitForServer()`.
- When 0.1's error comes back, probe `GET /api/info` once.
- Only a JSON body with a `version` whose major is 2 or more counts as v2. In that case throw `UnsupportedOpenCodeVersionError`: `OpenCode <version> isn't supported by this Cowork-Z version. Run: npm uninstall -g @opencode/cli && npm install -g opencode-ai@1`.
- Every other probe outcome keeps today's polling and generic error: HTML, JSON 404, malformed JSON, 401, connection failure.
- **The version error must get past the loop's own `catch`.** Today every error inside the loop is caught and retried ([process-manager.ts:615-627](../../src-tauri/sidecar-opencode/src/process-manager.ts#L615-L627)). Rethrow the typed error at once.
- The error reaches the UI through the existing `task_error` path.

**0.3 Kill the child when startup fails.**
- `startServer()` ([process-manager.ts:599](../../src-tauri/sidecar-opencode/src/process-manager.ts#L599)) leaves the spawned process running when `waitForServer()` throws.
- `doInitialize()` ([index.ts:152-178](../../src-tauri/sidecar-opencode/src/index.ts#L152-L178)) then builds a new `ProcessManager` on the next task, and the reference to the old server is lost. With a fast-failing gate, every retry leaks one `opencode serve`.
- Fix: terminate the child in `startServer()` before rethrowing.

**0.4 Tests (Jest).**
- HTML 200 → `request()` throws.
- A v2 `/api/info` response → `waitForServer()` rejects with `UnsupportedOpenCodeVersionError` on the first health poll, without running the 30-attempt loop.
- HTML, 404 JSON, malformed JSON, 401 and connection-refused probes → no version error.
- After a startup failure, the child process got a kill signal.

**0.5 Release 0.9.3.**
- Bump `0.9.2` → `0.9.3` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then run `cargo check` to refresh `Cargo.lock`. These are the same files the past bumps touched (`828ec59`, `30e01f2`).
- Add a `## v0.9.3` entry to `UPDATE_LOG.md`: "Clear error when OpenCode 2.x is installed; stay on 1.x until Cowork-Z 1.0."

### Phase 1: core task flow on v2 (part of release 1.0.0)

**1.0 Spike.** Done on 2026-10-27 against OpenCode 2.2.0 with Copilot `claude-haiku-5.5`. Answers are in section 6. The raw captures, with machine paths replaced, are in `src-tauri/sidecar-opencode/__tests__/fixtures/v2/`:
- `turn-tools-form-todo.events.jsonl`: identity, todowrite, a question form, three writes, an external read, then an interrupted second turn
- `turn-permissions-reject.events.jsonl`: the task 1.4 ruleset, two rejects that end the turn, and a permissions `PATCH`
- `session-messages.json`: the message history

Capture raw `/api/event` output as JSONL into `src-tauri/sidecar-opencode/__tests__/fixtures/v2/` for one turn that includes:
- a tool call
- a permission ask
- a `question`-tool form
- a todowrite

Also capture one `GET /api/session/{sid}/message` response. Write the answers to the questions below into section 6 of this spec:

1. Does an instructions entry reach the model? Check three things: the identity answer ("Cowork-Z"), a marker string from the user's custom prompt, and that a changed entry takes effect on resume.
   - Fallback 1: a custom agent `agents.cowork-z.system` set via `OPENCODE_CONFIG_CONTENT`, with `agent` set on session create. The prompt is then static per server, so the per-task parts (workspace path, user prompt) need another route.
   - Fallback 2: prepend the system prompt to the first prompt text.
2. Does `prompt` return as soon as the input is admitted? A clear server rejection (4xx or 5xx with an error body) means the turn didn't start. A transport failure (timeout, socket reset) is ambiguous, because the input may already be admitted. Decide how to resolve that case: check `GET /api/session/{id}` and the inbox, then either keep tracking the session or interrupt it.
3. Permission rules:
   - Does the last matching rule win?
   - What are the exact action names: `read`, `edit`, `shell`, `external_directory`, and does `doom_loop` still exist?
   - What is the resource pattern syntax?
   - Does `ask` on `external_directory` emit `permission.asked`?
4. Todos: with `experimental.todo: true`, how do todos appear (probably as todowrite tool input)? Is the tool still called `todowrite`? Are past todowrite inputs in the message history?
5. Config topology: the server's cwd is the app data dir, and each session's location is the user's workspace.
   - Which config files does a location load?
   - Does `OPENCODE_CONFIG_CONTENT` apply to every location?
   - Are v1-shaped keys normalised (`mcp`, `provider`, `small_model`, `disabled_providers`)?
   - Is `OPENCODE_CONFIG=<path>` needed?
6. Resuming a session created under v1: does `GET /api/session/{id}` return 404? Check `GET /api/experimental/migration/v1`.
7. Does the `question` tool still exist under that name? Which field types does it produce in practice?
8. Does the message history carry tool names, so a tool whose `input.started` event was missed can be named later?

**1.1 Client.** File: [opencode-client.ts](../../src-tauri/sidecar-opencode/src/opencode-client.ts).
- Point the client at `/api/*`. Unwrap `{data}` in the callers that need it.
- The query serialiser writes object parameters as deepObject: `location[directory]=…`. Today it only sets flat strings ([opencode-client.ts:30-38](../../src-tauri/sidecar-opencode/src/opencode-client.ts#L30-L38)).
- Methods: `info`, `createSession({directory, model, permissions})`, `updateSession(sid, {permissions})`, `getSession`, `prompt(sid, text)`, `switchModel`, `putInstructions(sid, key, value)`, `interrupt`, `listSessionPermissions(sid)`, `listSessionForms(sid)`, `replyPermission(sid, rid, decision, message?)`, `replyForm(sid, fid, answer)`, `cancelForm(sid, fid, message)`.
- `request()` takes a `logBody: false` option. Any method that returns secrets passes it (task 2.2).
- Delete these v1 methods, which nothing calls: `disposeInstance`, `getConfig`, `listSessions`, `deleteSession`, `getMessages`, `listPermissions`, `listQuestions`, `rejectQuestion`.
- Delete `disposeGlobal` together with task 1.5.
- **`updateConfig` still has callers.** It is used at [session-manager.ts:347](../../src-tauri/sidecar-opencode/src/session-manager.ts#L347) and [:410](../../src-tauri/sidecar-opencode/src/session-manager.ts#L410), [index.ts:390](../../src-tauri/sidecar-opencode/src/index.ts#L390) (MCP) and [index.ts:471](../../src-tauri/sidecar-opencode/src/index.ts#L471) (Copilot enterprise). Delete it only after tasks 1.3, 2.1 and 2.2 have replaced those calls.

**1.2 Event stream.** File: [event-stream.ts](../../src-tauri/sidecar-opencode/src/event-stream.ts).
- URL becomes `/api/event`.
- Parse `{type, location, data}`.
- Filter on `location?.directory` with today's rule: events without a location pass, and workspace events are dropped when the stream has no directory.
- `emit(type, data)`.
- **Readiness.** `connect()` returns a promise that resolves on the first `server.connected` frame. `doInitialize()` awaits it before any task can start. Today it calls `connect()` and moves on ([index.ts:315](../../src-tauri/sidecar-opencode/src/index.ts#L315)), so the first events of a turn can be lost.
- **Recovery after a reconnect.** Emit `reconnected`. The session manager then rebuilds each active session from REST:
  - `GET /api/session/{id}`: if the session finished during the gap, emit completion.
  - `GET /api/session/{sid}/permission` and `GET /api/session/{sid}/form`: re-emit any pending ask the UI hasn't seen yet, deduplicated by request id.
  - Missing tool names: read them out of the message history (spike item 8). If that fails, use the name `tool`.
- Don't rely on the event envelope's `durable` metadata for replay. The API offers no replay.

**1.3 Session manager.** File: [session-manager.ts](../../src-tauri/sidecar-opencode/src/session-manager.ts). It emits the same `SidecarEvent`s as today.

| v2 event | Sidecar action |
|---|---|
| `session.execution.started` | `progress {stage: executing}` |
| `session.text.delta` | Append to the text accumulator → `message_partial`. A new `assistantMessageID` first flushes the previous text as `message_complete` |
| `session.tool.input.started` | Store `name` by call `id` |
| `session.tool.called` / `.success` / `.failed` | `task_message` tool_use carrying the rebuilt v1 part `{type:'tool', tool, callID, messageID, state:{status: running/completed/error, input, output}}` |
| `session.execution.succeeded` | Flush text, then `complete {status: success}` |
| `session.execution.failed` | `task_error(error.message)`, then cleanup |
| `session.execution.interrupted` | **When a local abort is pending** (the session is marked `completing` or already cleaned up), ignore it: `abortSession` already emitted `complete {status: aborted}`. **Otherwise**, for example after the user rejected a permission (which v2 reports with reason `shutdown`): flush text, then `complete {status: success}`, then cleanup. This matches v1, where a rejected permission ended the turn and the task finished. Log the reason |
| `permission.asked` | `permission_request {permission: action, patterns: resources, metadata}`. Map `shell` back to `bash` for the UI |
| `form.created` | `question_request` (mapping below). Keep `form.fields` per request id |
| `session.compaction.ended` | Compaction loop counter (unchanged threshold of 3) |
| `session.tool.called` with name `todowrite` | Also emit `todo_updated`, mapping `input.todos` to `Todo {id: String(index), content, status, priority: 'medium'}`. Keep the list as the session's last-seen todos (task 2.3) |

- Tool part conversion:
  - Output: join the text items of `content` into one string, and write each file item as `[file: <name or uri>]`. A failure becomes `error.message`. The frontend only keeps string output.
  - Tool names, mapped back to the v1 names the frontend expects: `shell` → `bash` (artifact extraction only recognises `bash`, [taskStore.ts:276](../../src/stores/taskStore.ts#L276)) and `subagent` → `task`.
- Form → question mapping:

  | Form field | Question |
  |---|---|
  | `string` with `options` | Single select |
  | `string` without `options` | Free text |
  | `multiselect` | `multiSelect: true` |
  | `boolean` | Yes/No options → `true`/`false` |
  | `number`, `integer` | Free text, parsed. If the server rejects the answer (`FormInvalidAnswerError`), surface it and ask again |
  | `external` | Unsupported: cancel the form with `DELETE /api/session/{sid}/form/{fid}?message=…` and log it |
  | `hidden` | Skipped |

  - Every question carries `custom: field.custom ?? true`. `custom` is a new optional property on `QuestionInfo` (sidecar `types.ts` and the frontend type). `QuestionDialog` adds "Others" only when `custom !== false`.
  - Skip fields with `when` conditions unless the spike shows the `question` tool emits them.
- Form reply:
  - Map option labels back to option values.
  - Single select or free text: `answer[key]` is the chosen value or the typed text.
  - Multiselect: `answer[key]` is an array of the selected values, plus the custom text when it's allowed and filled in.
- `startTask`: create the session with `location`, `model` and `permissions`, write the instructions entry, then `prompt`.
- `resumeSession`, in this order:
  1. `getSession`. A 404 means the session predates the upgrade: v1 ids return 404 even though `GET /api/experimental/migration/v1` reports `completed`. In that case, create a new session in the same task the way `startTask` does, and skip to step 4.
  2. **`PATCH /api/session/{id} {permissions}` with the resume payload's `folderPermissions`.** Without it, a revoked or changed folder grant has no effect on a session that already exists, and a session migrated from v1 never gets the leading `external_directory` ask rule. Today's resume reapplies permissions through `PATCH /config` ([session-manager.ts:407-411](../../src-tauri/sidecar-opencode/src/session-manager.ts#L407-L411)).
  3. `switchModel` when the model changed.
  4. Refresh the instructions entry.
  5. `prompt`.
- Remove the `PATCH /config` calls ([session-manager.ts:347](../../src-tauri/sidecar-opencode/src/session-manager.ts#L347), [:410](../../src-tauri/sidecar-opencode/src/session-manager.ts#L410)).
- Remove the arena `skipConfig` path. Permissions are per session now, so each arena session carries its own.
- `prompt` returns within milliseconds (spike), so it no longer needs `timeout: 0`.
  - An HTTP error response (4xx or 5xx) means the turn didn't start. Emit `task_error` and clean up, whatever `turnConfirmed` says.
  - A transport failure (no HTTP status) stays ambiguous. Keep today's `turnConfirmed` check in `handleSendMessageFailure` ([session-manager.ts:461-497](../../src-tauri/sidecar-opencode/src/session-manager.ts#L461-L497)) for that case only.

**1.4 Config builder.** File: [config-builder.ts](../../src-tauri/sidecar-opencode/src/config-builder.ts).
- Replace `buildSessionConfig` with `buildSessionPermissions(folderPermissions): Rule[]`.
- Keep the current order: general rules first, overrides after.
- **Always start with `{action: 'external_directory', resource: '*', effect: 'ask'}`.** v2 allows external directories by default, so without this rule the sandbox opens up.
- Carry every existing category over unchanged ([config-builder.ts:168-221](../../src-tauri/sidecar-opencode/src/config-builder.ts#L168-L221)):
  - the general `edit * ask` rule
  - workspace rules: `Input/` deny, `Output/` allow, `Misc/` and `Artefacts/` ask
  - non-workspace folders: read-only → deny, read-write → ask, adhoc → allow, each with `external_directory` and `read` allow
- **Resource format, verified in spike run 3:**
  - Workspace rules use location-relative patterns: `Input/*`, `Output/*`, `Misc/*`, `Artefacts/*`. Absolute workspace patterns never match, so with them the `Input/` deny silently does nothing (spike run 2 wrote `Input/c.txt`).
  - Folder rules use the absolute folder path with forward slashes plus `/*` for `external_directory`, `read` and `edit`. On Windows, turn backslashes into slashes first, since v2 normalises paths that way.
  - Drop `doom_loop`; v2 has no such action.
  - The ruleset that passed the spike (`<F>` is a read-only external folder):

    ```
    external_directory *        ask
    edit               *        ask
    edit               Input/*  deny
    edit               Output/* allow
    edit               Misc/*   ask      (and Artefacts/* ask)
    external_directory <F>/*    allow
    read               <F>/*    allow
    edit               <F>/*    deny
    ```
- Known limit, unchanged by this migration: edit rules don't cover shell commands. The system prompt already says so ([config-builder.ts:64](../../src-tauri/sidecar-opencode/src/config-builder.ts#L64)), and upstream calls shell path detection best effort.
- System prompt changes:
  - In `<server-access>`, change `/doc` → `/openapi.json` and `/skill` → `/api/skill`.
  - In the tools table, rename `task` → `subagent`, and update `todowrite`/`todoread` per spike item 4.
  - Remove the 1.1.48 comments.

**1.5 Process manager and health.** Files: [process-manager.ts](../../src-tauri/sidecar-opencode/src/process-manager.ts), [index.ts:675](../../src-tauri/sidecar-opencode/src/index.ts#L675).
- `health()` → `info()` in both `waitForServer` and `handleCheckServer`.
- Version gate: when `/api/info` isn't JSON but `/global/health` is, the server is v1. Throw `UnsupportedOpenCodeVersionError`: `Cowork-Z needs OpenCode 2.x. Run: npm uninstall -g opencode-ai && npm install -g @opencode/cli`. It reuses Phase 0's typed error and its path out of the retry loop.
- Remove `disposeGlobal`. `stopServer` just terminates.
- Config travels only through `OPENCODE_CONFIG_CONTENT`, because v2 doesn't read `opencode.json` from the server's cwd (spike).
  - Delete `writePreStartConfig` and its `opencode.json`/`config.json` writes, along with `updateMcpConfig`.
  - Add `experimental: {todo: true}` to the env config.
  - Keep the v1-shaped OpenRouter overlay, since v1 keys are normalised. During implementation, confirm that `disabled_providers` and `provider` show up in `GET /api/config`.
  - `updateModelConfig` (called from [index.ts:335](../../src-tauri/sidecar-opencode/src/index.ts#L335) and [:359](../../src-tauri/sidecar-opencode/src/index.ts#L359)) can no longer change a running server. When a task switches into or out of an OpenRouter model, restart the server the way a key change does; otherwise drop the call.
- Log `info.version` on startup.

**1.6 Types.** File: [types.ts](../../src-tauri/sidecar-opencode/src/types.ts).
- Replace the v1 OpenCode types (`Session`, `PartUpdate`, `PermissionRequest`, `QuestionRequest`, `Config`, `PermissionConfig`, the `OpenCodeEvent` union, `HealthResponse`) with the v2 subset actually used.
- Add the optional `custom` property to `QuestionInfo`.
- Leave `SidecarEvent` and `SidecarCommand` otherwise untouched.

**1.7 Tests (Jest, sidecar).**
- Rewrite `opencode-client.test.ts`, `event-stream.test.ts` and `session-manager.test.ts` against the spike fixtures. Cover:
  - the deepObject query
  - readiness and reconnect recovery, including a missed completion and a missed permission ask
  - `execution.interrupted` with and without a local abort
  - form mapping and reply shapes for each field type
  - resume reapplying permissions
- Update the `health` mock in `process-manager.test.ts`.
- Update the `/skill` assertion in `server-isolation.test.ts`.
- `config-builder.test.ts`: compare the **full** rule list for each folder category (workspace, read-only, read-write, adhoc) plus the leading `external_directory` ask rule. Checking only the first rule doesn't catch a widened permission.

### Phase 2: secondary features (part of release 1.0.0)

**2.1 MCP.** File: [index.ts](../../src-tauri/sidecar-opencode/src/index.ts) `handleMcp*` and `handleUpdateMcpConfig`.
- Config changes: `handleUpdateMcpConfig` ([index.ts:377-400](../../src-tauri/sidecar-opencode/src/index.ts#L377-L400)) applies changes at runtime, so no restart is needed:
  - `PUT /api/experimental/mcp/{name}` for each added or changed server
  - `DELETE /api/experimental/mcp/{name}` for each removed one
  - Nothing is written to disk. The next spawn gets the set from the task payload through `OPENCODE_CONFIG_CONTENT`.
  - Pass `location[directory]` so the change lands on the workspace's location. The spike saw a runtime-added server appear in `GET /api/mcp` at once.
- Status: call `GET /api/mcp?location[directory]=…`, read `data[]`, and convert each `{name, status: {…}}` into the `Record<name, {status, error}>` the UI expects. The UI knows the statuses `connected|disabled|failed|needs_auth|needs_client_registration` ([mcpSettings.ts:20](../../src/shared/types/mcpSettings.ts#L20)). Map v2 values onto those.
- Connect and disconnect go through the experimental routes.
- `mcp_tools` has no v2 route. Find another source (agent or tool listing), or show servers without tool lists.

**2.2 Copilot.** Files: [index.ts:459-592](../../src-tauri/sidecar-opencode/src/index.ts#L459-L592) and `CopilotProviderForm.tsx`.
- **Secrets first.** `GET /api/credential` returns secrets in fields named `key`, `access` and `refresh`, and the current redaction pattern doesn't catch them ([redact.ts:8](../../src-tauri/sidecar-opencode/src/redact.ts#L8)). With payload logging on, `httpResponse` would write them to the log file and the debug panel ([logger.ts:118](../../src-tauri/sidecar-opencode/src/logger.ts#L118)).
  - The client gets no method for `GET /api/credential`.
  - Every credential route it does call passes `logBody: false` (task 1.1).
  - Add a test proving no credential value reaches the log.
- Connect: `POST /api/integration/github-copilot/connect/oauth` with:
  - body `{methodID: 'device', answer: {deploymentType: 'github.com'}}`
  - or, when an enterprise URL is given, `{deploymentType: 'enterprise', enterpriseUrl}`. This replaces the `PATCH /config` at [index.ts:471](../../src-tauri/sidecar-opencode/src/index.ts#L471).
  - Emit `copilot_oauth_result` from the attempt's `url` and `instructions`, poll `GET …/{attemptID}` every 2 s until `complete` / `failed` / `expired` (10-minute cap), then emit `copilot_oauth_complete`.
- Provider ids: v2 has one provider, `github-copilot`, for both deployment types.
  - Map stored app model ids `github-copilot-enterprise/<m>` to `github-copilot/<m>` before they reach OpenCode.
  - Drop the `enabled_providers` overlay in `config-builder.ts:243-247`.
- Models: `GET /api/model?location[directory]=…`. Keep `providerID === 'github-copilot' && enabled`, mapped to `{id: 'github-copilot/<modelID>', name}`.
- Logout: read the connection ids of the `github-copilot` integration from `GET /api/integration` (that response carries no secrets), then `DELETE /api/credential/{id}` for each. Confirm during implementation that a connection id is a credential id.
- Check that the `instructions.replace('Enter code: ', '')` parsing still matches the v2 text.

**2.3 Todos.**
- `get_session_todos` ([index.ts:769](../../src-tauri/sidecar-opencode/src/index.ts#L769)) has no server route anymore. Serve it from the sidecar's last-seen todos for that session.
- **Cold cache:** after a sidecar restart, opening an existing task asks for its todos ([Execution.tsx:323](../../src/pages/Execution.tsx#L323)). Rebuild them from the message history:
  - `GET /api/session/{id}/message` returns the newest message first.
  - The first content item with `{type: 'tool', name: 'todowrite'}` holds the list in `state.input.todos`.
  - Map it as in task 1.3. If no such item exists, return `todos: null`, which the UI already handles.
- `experimental.todo` is enabled by task 1.5.

**2.4 Bundled skill.**
- Rewrite [opencode-server-api/SKILL.md](../../src-tauri/resources/skills/opencode-server-api/SKILL.md) for the v2 routes.
- Confirm v2 still loads skills from `~/.config/opencode/skills/`. The upstream guide prefers `.opencode/skills/<id>/SKILL.md`, and [lib.rs:78-100](../../src-tauri/src/lib.rs#L78-L100), `skills.rs:109` and `skill_repos.rs:75` depend on the global folder.

### Phase 3: install hint, docs, release 1.0.0

**3.1 Install hint.** In [opencode_cli.rs](../../src-tauri/src/commands/opencode_cli.rs), change the install command to `npm install -g @opencode/cli`.

**3.2 Docs.**
- Move [`opencode-api-v2.json`](opencode-api-v2.json) over [`opencode-integration/opencode-api.json`](opencode-integration/opencode-api.json).
- Update `CLAUDE.md`: the endpoint list, the `?directory` wording and the "OpenCode must be installed globally" gotcha.
- Update [`design_opencode-integration.md`](opencode-integration/design_opencode-integration.md) and `docs/architecture/architecture.md`.

**3.3 Release 1.0.0.**
- Phases 1–3 ship together. Requiring OpenCode 2.x is a breaking change for users.
- Bump `0.9.3` → `1.0.0` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then run `cargo check` for `Cargo.lock`.
- Add a `## v1.0.0` entry to `UPDATE_LOG.md` covering:
  - OpenCode 2.x is now required.
  - Upgrade with `npm uninstall -g opencode-ai && npm install -g @opencode/cli`.
  - What happens to task history from before the upgrade (per spike item 6).

---

## 5. Risks

- **Experimental routes.** Instructions, MCP add/connect and config all sit under `/api/experimental/*` and can change in minor releases. Put the tested version in the gate message and log `info.version` on every start.
- **Lossy events.** v2 makes no delivery promise on `/api/event`. The reconnect recovery in task 1.2 is required for correctness.
- **Autoupdate.** v2 may update its own binary while the app is running. Consider setting `OPENCODE_DISABLE_AUTOUPDATE=1` on spawn, and decide after the spike.
- **Old session ids.** Task history stores v1 session ids. Resume behaviour depends on spike item 6. Starting a new session in the same task is the simple fallback.
- **Sandbox.** v2's allow-by-default `external_directory` is the one regression that fails silently. The leading `ask` rule, permissions reapplied on resume, and the full-rule-list tests cover it. Shell commands bypassing edit rules is a known limit from before this migration.
- **Secrets in logs.** Only the credential routes return secrets. They never log a body (task 2.2).

---

## 6. Spike findings

Probed on 2026-10-27 against `opencode serve` 2.2.0. Server cwd was an empty app dir. The session location was a scratch workspace holding the four convention folders. Model: `github-copilot/claude-haiku-5.5`. Numbers match the questions in task 1.0.

1. **Instructions entry: works.** `PUT …/instructions/entries/cowork-z` returned 204. The agent's first words were "ZEBRA-42. I'm Cowork-Z, a desktop agent…", which is both the marker and the identity from the entry. A refresh on resume wasn't tested; the PUT replaces the entry by key.
2. **`prompt` admits and returns:** 66 ms, 253 ms and 1–2 ms, with `{data: {id: msg_…, type: 'user', payload, delivery}}`. Lifecycle events follow on SSE: `session.inbox.enqueued`, then `.inbox.delivered`, then `.execution.started`, … `.succeeded`.
3. **Permissions:**
   - The last matching rule wins. Session `permissions` given on create are applied and echoed back.
   - `edit` resources for workspace files are location-relative (`Output/a.txt`), so absolute patterns don't match.
   - An external read asks `external_directory` with resource `/etc/*`. After that, `read`/`edit` use the absolute path.
   - `PATCH /api/session/{id} {permissions}` takes effect on the next tool call.
   - An edit ask carries `save: ['*']`, so an `always` reply would allow every edit in the project. Cowork-Z only sends `once` and `reject` ([tasks.rs:598-600](../../src-tauri/src/commands/tasks.rs#L598-L600)); keep it that way.
   - Rejecting a permission aborts the pending tool calls ("The user declined this tool call") and ends the turn with `session.execution.interrupted`, reason `shutdown`.
   - The ruleset in task 1.4 enforced what it should: Output silent, Misc ask, Input denied, root file ask, read-only external folder readable but not writable, `/etc` ask.
4. **Todos:**
   - `experimental.todo: true` in `OPENCODE_CONFIG_CONTENT` enables a `todowrite` tool with input `{todos: [{content, status}]}`.
   - Its success content is a text summary.
   - The message history holds the same input under `state.input.todos` (and `state.metadata.todos`).
5. **Config:**
   - `GET /api/config?location[directory]=…` returns the list of config sources.
   - `OPENCODE_CONFIG_CONTENT` shows up as a path-less document and reaches the workspace location.
   - v1 `small_model` became `agents.title.model {providerID, model}`, and v1 `mcp.{name}.enabled: false` became `mcp.servers.{name}.disabled: true`.
   - A marker `opencode.json` placed in the server's cwd was **not** among the sources.
   - The user's global `~/.config/opencode/opencode.json` is loaded too, so its MCP servers show up in Cowork-Z.
6. **v1 sessions:** `GET /api/session/<v1 id>` returns 404 `SessionNotFoundError`, while `GET /api/experimental/migration/v1` reports `{status: 'completed'}`.
7. **Question tool → form:**
   - One form per `question` call: `{title: 'Questions', metadata: {kind: 'question', tool: {messageID, id}}, fields: [{key: 'q0', title: <header>, description: <question>, type: 'string', options: [{value, label, description}], custom: true}]}`.
   - The reply `{answer: {q0: 'red'}}` returned 204, and the tool result text quotes the answer back to the model.
8. **Message history:**
   - `GET /api/session/{id}/message` returns `{data, cursor}`, newest first.
   - Assistant content items include `{type: 'tool', id, name, state: {status, input, content, metadata}}`, so tool names can be recovered after a missed `tool.input.started`.

Other observations:
- Events seen in a turn:
  - lifecycle: `session.execution.*`, `session.inbox.*`
  - streaming: `session.text.started/delta/ended`, `session.reasoning.*`, `session.step.started/streamed/ended`
  - tools: `session.tool.input.started/ended`, `session.tool.called/success/failed`
  - asks: `permission.asked/replied`, `form.created/replied`
  - other: `session.usage.updated`, `session.renamed`
  - No `session.idle` and no `session.status`.
- Tool success `content` is `[{type: 'text', text}]`. A tool failure gives `error: {type: 'permission.rejected' | 'aborted', message}`.
- `POST /api/session/{id}/interrupt` → `{interrupted: true}`, then `session.execution.interrupted` with reason `user`.
- `GET /api/mcp` items look like `{name, status: {status: 'disabled' | 'failed', error?}}`. `PUT /api/experimental/mcp/{name} {config: {type, command, disabled}}` returned 204, and the server was listed straight away.
- Copilot integration (`GET /api/integration`): id `github-copilot`.
  - Methods: `env` (`GITHUB_TOKEN`) and `device` (oauth).
  - The `device` form has `deploymentType` (`github.com` or `enterprise`) and, when `enterprise` is chosen, `enterpriseUrl`.
  - Connections are `{id, label, method, type}`, with no secrets.
- `GET /api/model` lists Copilot models as `providerID: 'github-copilot'`.

---

## 7. Verification

Root checks run from the repo root: `pnpm typecheck` and `pnpm test --run` (Vitest). Sidecar checks run from `src-tauri/sidecar-opencode`: `pnpm test` (Jest) and `pnpm build`. Rust checks run from `src-tauri`: `cargo check`.

**Phase 0**
- Run the sidecar `pnpm test` and `pnpm build`.
- Jest proves that with a v2 server the gate rejects on the first health poll and kills the child.
- Manual check with v2 installed, `pnpm tauri dev`: starting a task shows the "not supported" error in the chat. No 15 s spinner, and `ps` shows no leftover `opencode serve` after three tries.
- The About panel shows 0.9.3.

**Phase 1**
- All the checks listed above.
- Manual run in `pnpm tauri dev` with v2 installed:
  - Start a task and see streaming text and a tool card with output.
  - Approve one permission and deny another.
  - Answer a single-select question, a multi-select question, and a question with a custom answer.
  - Stop a running task: you get one completion, not two.
  - Resume a task after revoking a folder grant: an edit in that folder now prompts or is denied.
  - The `write` and `edit` tools are denied in `Input/` and allowed in `Output/`. A `read` outside the workspace and outside any granted folder prompts.
  - Restart the OpenCode server process during a permission prompt: the prompt is still answerable, and the task finishes.
  - Arena: three models run in parallel.

**Phase 2**
- Add an MCP server while a task runs: it connects without a restart. Disconnect it.
- Connect Copilot and disconnect it. With payload logging on, the sidecar log holds no credential value.
- The todo panel updates during a task and shows todos (or the empty state) after a sidecar restart.

**Release 1.0.0**
- With v1 installed, you get the "needs 2.x" error.
- All four version strings read `1.0.0` and `cargo check` passes.
