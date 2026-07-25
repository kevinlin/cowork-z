---
name: add-tauri-command
description: Use when adding a new Tauri command to Cowork-Z — a new backend capability the React frontend must call, a new `#[tauri::command]` fn, or a new `invoke()` wrapper in tauri-api.ts. Also use when a newly written command returns "Command not found" at runtime.
disable-model-invocation: true
---

# Add a Tauri Command

A command is not usable until it exists in four places. Miss one and it fails at runtime, not at build time — `generate_handler!` takes any path that compiles, and `invoke()` takes any string.

## The four edits

| Order | File | Edit |
|---|---|---|
| 1 | `src-tauri/src/commands/<domain>.rs` | the `#[tauri::command]` fn |
| 2 | `src-tauri/src/commands/mod.rs` | `pub mod <domain>;` — only when the file is new |
| 3 | `src-tauri/src/lib.rs` | one line in `tauri::generate_handler![]`, under the matching `// Domain` comment |
| 4 | `src/lib/tauri-api.ts` | the typed `invoke()` wrapper |

Pick an existing domain file before creating one. There are 22; a new domain is rare.

## Step 1 — the command

Copy [templates/command.rs](templates/command.rs). Two shapes: plain, and path-taking.

**Any command that accepts a caller-supplied path MUST go through `path_guard`.** The renderer is untrusted — an agent will pass whatever path its model produced. Model it on the `validate_path` helper at the top of `src-tauri/src/commands/files.rs`, and validate before any `fs::` call, never after.

Return `Result<T, String>`. `T` must be `Serialize`; shared shapes live in `src-tauri/src/types.rs`.

## Step 2 — register

`lib.rs` groups the handler list by domain with `//` comments. Add the line to its group, not the end of the list.

## Step 3 — the frontend wrapper

Copy [templates/wrapper.ts](templates/wrapper.ts).

Argument names cross the bridge as **camelCase in TS, snake_case in Rust** — Tauri converts them. `invoke('add_workspace', { folderPath })` binds to `folder_path: String`. Get this wrong and the argument silently arrives empty.

The function name is camelCase; the invoke string is the exact Rust fn name.

New return types go in `src/shared/` and must mirror the Rust struct's serde casing (`rename_all = "camelCase"` on the Rust side).

## Step 4 — verify

```bash
cd src-tauri && cargo check     # Rust compiles
pnpm typecheck                  # TS compiles
```

Then check the wiring, which neither compiler sees:

```bash
grep -c '<fn_name>' src-tauri/src/lib.rs src/lib/tauri-api.ts   # both must be >= 1
```

Rust changes need an app restart (`pnpm tauri dev`); the frontend hot-reloads. Do not report the command as working until you have seen it return in the running app or in a test.

## Capabilities

If the command calls a Tauri **plugin** API (shell, dialog, opener, updater, process), the calling window needs the permission in `src-tauri/capabilities/`. Those files are protected — do not edit them. Say which permission is needed and which window needs it, and let the user make the change.

Plain Rust (`std::fs`, `rusqlite`, `reqwest`) needs no capability entry.

## Tests

Rust: `#[cfg(test)] mod tests` in the same file, `cd src-tauri && cargo test`. Pure logic — extract it out of the command body so it is testable without a `State`.

Frontend: `__tests__/` next to the code, `pnpm test --run`.

## Common mistakes

| Symptom | Cause |
|---|---|
| `Command <name> not found` | Step 2 skipped — not in `generate_handler![]` |
| Argument arrives empty or `None` | camelCase/snake_case mismatch between the invoke object and the Rust param |
| Command compiles, never reachable | New file, no `pub mod` line in `commands/mod.rs` |
| Works in dev, fails on a user's machine | Path used without `path_guard` — outside the sandbox roots |
| `unknown permission` at runtime | Plugin API called from a window whose capability file does not grant it |
