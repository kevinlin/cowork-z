# Fix Long-Running Conversations Showing False "Failed" Status

## Root Cause

The `sendMessage` call in `SessionManager.startTask()` and `SessionManager.resumeSession()` is `await`ed with a **10-minute HTTP timeout** (`opencode-client.ts` line 184). OpenCode's `POST /session/{id}/message` endpoint blocks until the **entire agent turn completes** (including tool execution, permission waits, etc.). For complex tasks exceeding 10 minutes, the `AbortController` fires, the fetch throws, and the error propagates:

```
sendMessage timeout (10min)
  -> startTask() throws
    -> handleStartTask() catch block
      -> emits task_error
        -> frontend sets status = 'failed'
```

Meanwhile, the **SSE stream continues delivering events** (`session.status: busy`, `message.part.delta`, etc.) because the OpenCode session is still running on the server. The HTTP timeout only kills the request, not the session.

There is also a **race condition**: if the session completes via SSE *before* `sendMessage` returns, `handleSessionIdle()` calls `cleanup()` (removing session from maps), then `sendMessage` returns/times-out, and the error propagates to the catch block, emitting `task_error` *after* `task_complete` was already sent.

## Fix

The `sendMessage` HTTP response is **not used** for anything — all session lifecycle events (messages, completion, errors) already arrive via SSE. The `await` on `sendMessage` serves no purpose and is actively harmful.

### Changes

#### 1. Fire-and-forget `sendMessage` in `SessionManager` (`session-manager.ts`)

In both `startTask()` and `resumeSession()`, change the `await this.client.sendMessage(...)` to fire-and-forget with local error handling that only logs (no error emission). If the session truly failed, the SSE stream will deliver a `session.error` event.

#### 2. Remove `sendMessage` timeout (`opencode-client.ts`)

Since `sendMessage` is now fire-and-forget, the timeout causes unnecessary abort noise in logs. Updated `request()` to skip the `AbortController` when timeout is `0`, and changed `sendMessage` to pass `{ timeout: 0 }`.

## Files Changed

- `src-tauri/sidecar-opencode/src/session-manager.ts` — fire-and-forget `sendMessage` in `startTask()` and `resumeSession()`
- `src-tauri/sidecar-opencode/src/opencode-client.ts` — support no-timeout mode for fire-and-forget calls
