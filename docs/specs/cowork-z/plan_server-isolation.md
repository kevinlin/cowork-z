# Implementation Plan: OpenCode Server Isolation (Requirement 8.1)

## Summary

Implements requirement 8.1 (OpenCode Server Isolation) from the Cowork-Z feature requirements. The OpenCode server now binds to a random available port on `127.0.0.1` instead of the fixed port `4096`, and all HTTP/SSE communication is secured with HTTP basic auth using a randomly generated password.

## Changes

### Random Port Binding (Req 8.1.1)

- Added `getAvailablePort()` utility in `process-manager.ts` that uses `node:net` to bind to port `0` on `127.0.0.1`, letting the OS assign an ephemeral port
- `ProcessManager.startServer()` now calls `getAvailablePort()` before spawning `opencode serve`
- The resolved port is passed to `opencode serve --port <port>` and propagated to `OpenCodeClient` and `EventStream`
- Removed hardcoded `OPENCODE_PORT = 4096` constant from `index.ts`

### Random Password Generation (Req 8.1.2)

- Added `generatePassword()` utility in `process-manager.ts` using `node:crypto.randomBytes()` with base64url encoding
- Password is generated once per `ProcessManager` instance (i.e., per sidecar lifecycle)
- Password is set as `OPENCODE_SERVER_PASSWORD` environment variable when spawning the OpenCode server process

### HTTP Basic Auth (Req 8.1.3)

- `OpenCodeClient` now accepts an optional `password` in its constructor options
- When password is set, all HTTP requests include an `Authorization: Basic <base64(opencode:password)>` header
- `EventStream` now accepts an optional `password` in its constructor options
- When password is set, SSE connections pass the auth header via the `eventsource` library's `headers` option

### System Prompt Update

- Converted `SYSTEM_PROMPT` constant to `buildSystemPrompt(serverPort)` function
- The skills-discovery `curl` command now uses the dynamic port instead of hardcoded `4096`
- `SessionManager` constructor now accepts `serverPort` and passes it to `buildSystemPrompt()`

## Files Modified

| File | Changes |
|------|---------|
| `src-tauri/sidecar-opencode/src/process-manager.ts` | Added `getAvailablePort()`, `generatePassword()`, exposed `getPort()`/`getPassword()`, set `OPENCODE_SERVER_PASSWORD` env |
| `src-tauri/sidecar-opencode/src/opencode-client.ts` | Added `password` option, `Authorization` header on all requests |
| `src-tauri/sidecar-opencode/src/event-stream.ts` | Added `password` option, auth headers on SSE connections |
| `src-tauri/sidecar-opencode/src/index.ts` | Removed hardcoded port, wired dynamic port/password |
| `src-tauri/sidecar-opencode/src/config-builder.ts` | Converted `SYSTEM_PROMPT` to `buildSystemPrompt(port)` function |
| `src-tauri/sidecar-opencode/src/session-manager.ts` | Added `serverPort` constructor param, uses `buildSystemPrompt()` |
| `src-tauri/sidecar-opencode/__tests__/opencode-client.test.ts` | Added auth header tests |
| `src-tauri/sidecar-opencode/__tests__/session-manager.test.ts` | Updated for new constructor signature and system prompt mock |
| `src-tauri/sidecar-opencode/__tests__/server-isolation.test.ts` | New: tests for `getAvailablePort()`, `generatePassword()`, `buildSystemPrompt()` |

## No Rust Changes Required

The Rust side (`sidecar.rs`, `lib.rs`) did not need changes. The sidecar manages the OpenCode server entirely — Rust just spawns the sidecar binary and communicates via JSON-line IPC. Port and password are internal to the sidecar process.

## Validation

- `cd src-tauri/sidecar-opencode && pnpm build` — TypeScript compiles cleanly
- `cd src-tauri/sidecar-opencode && pnpm test` — All 44 tests pass (3 suites)
- `pnpm typecheck` — Frontend type check passes
