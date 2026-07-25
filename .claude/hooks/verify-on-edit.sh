#!/usr/bin/env bash
# PostToolUse hook: route an edited file to the compiler check that covers it.
#
# CLAUDE.md requires `pnpm typecheck` after TS edits and `cargo check` after Rust
# edits before reporting completion. This makes that mechanical.
#
# Silent on success. On failure, prints the tail of the compiler output on stderr
# and exits 2, which feeds the errors back to Claude to fix immediately.
#
# The three TS/Rust roots are checked separately because they do not overlap:
#   src/**                              -> root tsconfig (include: ["src"])
#   src-tauri/sidecar-opencode/src/**   -> sidecar tsconfig (NOT in root typecheck)
#   src-tauri/src/**                    -> cargo

set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"
file=$(jq -r '.tool_input.file_path // empty')

# No path in the payload, or an edit outside this repo: nothing to check.
[ -n "$file" ] || exit 0
case "$file" in
  "$root"/*) ;;
  *) exit 0 ;;
esac

rel="${file#"$root"/}"

fail() {
  printf '%s\n' "$1" | tail -30 >&2
  exit 2
}

case "$rel" in
  src-tauri/src/*.rs)
    out=$(cd "$root/src-tauri" && cargo check --message-format short 2>&1) || fail "$out"
    ;;
  src-tauri/sidecar-opencode/src/*.ts)
    out=$(cd "$root/src-tauri/sidecar-opencode" && pnpm exec tsc --noEmit 2>&1) || fail "$out"
    ;;
  src/*.ts | src/*.tsx)
    out=$(cd "$root" && pnpm typecheck 2>&1) || fail "$out"
    ;;
esac

exit 0
