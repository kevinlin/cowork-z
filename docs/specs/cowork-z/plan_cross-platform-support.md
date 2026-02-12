# Plan: Cross-Platform Support

## Context

Section 5 of `requirements.md` contains 3 subsections. Two features are fully implemented (5.2.1 Server Isolation, 5.2.3 Credential Security, 5.3 Error Handling) and one sub-feature is done (5.1.4 PATH Resolution). The remaining unimplemented features are:

| Req | Feature | Status |
|-----|---------|--------|
| 5.1.1–5.1.3 | Cross-Platform Support | Partially done — CI/sidecar has bugs |
| 5.2.2 | Database Encryption | Not started |
| 5.3.3 | Missing OpenCode CLI Detection | Backend exists, no frontend UI |

---

## Feature A: Cross-Platform Fixes (Req 5.1.1, 5.1.2, 5.1.3)

These are bug fixes and completions to existing infrastructure — no new architecture needed.

### A1. Fix CI/CD workflow sidecar path

**File:** `.github/workflows/publish.yml` (lines 64, 69, 74, 79, 84, 89)

Replace all 6 occurrences of:
```yaml
working-directory: src-tauri/sidecar
```
with:
```yaml
working-directory: src-tauri/sidecar-opencode
```

### A2. Add cross-platform sidecar binary resolution

**File:** `src-tauri/src/sidecar.rs` (lines 275–279)

Current code only lists macOS binary names. Replace the static array with platform-aware candidates:

```rust
let candidate_names: Vec<&str> = if cfg!(target_os = "macos") {
    vec![
        "sidecar-opencode-aarch64-apple-darwin",
        "sidecar-opencode-x86_64-apple-darwin",
        "sidecar-opencode",
    ]
} else if cfg!(target_os = "windows") {
    vec![
        "sidecar-opencode-x86_64-pc-windows-msvc.exe",
        "sidecar-opencode.exe",
    ]
} else {
    // Linux
    vec![
        "sidecar-opencode-aarch64-unknown-linux-gnu",
        "sidecar-opencode-x86_64-unknown-linux-gnu",
        "sidecar-opencode",
    ]
};
```

Note: This is diagnostic-only code (for logging binary resolution). The actual sidecar spawn at line 319 uses `shell.sidecar("sidecar-opencode")` which relies on Tauri's built-in platform resolution via `tauri.conf.json` `externalBin` — that part already works correctly.

### A3. Fix `check_opencode_cli` for Windows

**File:** `src-tauri/src/lib.rs` (line 1196)

Replace `which` with platform-appropriate command:
```rust
let output = if cfg!(target_os = "windows") {
    std::process::Command::new("where").arg("opencode").output()
} else {
    std::process::Command::new("which").arg("opencode").output()
};
```

### Verification
- `cd src-tauri && cargo check` — confirms Rust compiles
- Manual review of CI workflow diff

---

## Post-Implementation

- Mark 5.1.1, 5.1.2, 5.1.3 with checkmarks in `requirements.md`
- Update Outstanding Feature TODO checklist
- Add plan reference to Implementation Plans Index table
- Add entry to `UPDATE_LOG.md`
