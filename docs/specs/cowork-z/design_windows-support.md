# Windows Support — Design

## Goal

Make Cowork-Z fully production-ready on Windows (x64) via a phased rollout: runtime fixes first, CI hardening second, code signing third.

## Approach

**Phased Rollout** — ship a working unsigned Windows build immediately, then add CI hardening and code signing in parallel without blocking the release.

---

## Phase 1: Runtime Fixes (Immediate) ✅

### 1. Log Directory Path

**File:** `src-tauri/src/sidecar.rs` (lines 197-202)

**Problem:** Hardcoded `~/.local/share/opencode/log` — a Unix-only path that doesn't exist on Windows.

**Fix:** Use `cfg!(target_os = "windows")` to branch:
- Windows: `dirs::data_local_dir()?.join("opencode/log")` → `%LOCALAPPDATA%\opencode\log`
- macOS/Linux: Keep existing `~/.local/share/opencode/log`

### 2. PATH Resolution

**File:** `src-tauri/src/lib.rs` (lines 1200-1280)

**Problems:**
- PATH separator hardcoded as `:` (Unix). Windows uses `;`.
- Well-known fallback directories are all macOS/Linux paths (Homebrew, `/usr/local/bin`, etc.).
- Deduplication is case-sensitive; Windows paths are case-insensitive.

**Fix — three sub-changes:**

1. **Separator**: Extract a constant `PATH_SEPARATOR` via `cfg!` — `;` on Windows, `:` on Unix. Apply to both `split()` (line 1206, 1224) and `join()` (line 1279).

2. **Well-known directories**: Use `cfg!` to select platform-specific lists:
   - **Windows:** `%APPDATA%\npm`, `%ProgramFiles%\nodejs`, `%LOCALAPPDATA%\Volta\bin`, `~\scoop\shims`, `C:\ProgramData\chocolatey\bin`, `%LOCALAPPDATA%\Yarn\bin`, `%LOCALAPPDATA%\pnpm`, nvm-windows version directories
   - **macOS/Linux:** Keep existing list (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, etc.)

3. **Case-insensitive dedup on Windows**: Normalize to lowercase before deduplicating on Windows.

### 3. Dev Command Platform Detection

**File:** `tauri.conf.json` (line 7)

**Problem:** `beforeDevCommand` always runs `pnpm build:binary` (macOS ARM64 target), which fails on Windows.

**Fix:** Replace the inline command with a cross-platform Node.js script (`scripts/build-sidecar.mjs`) that detects `process.platform` and `process.arch`, then runs the correct `pnpm build:binary:<target>` command. Update `beforeDevCommand` to: `cd src-tauri/sidecar-opencode && pnpm install && node ../../scripts/build-sidecar.mjs && cd ../.. && pnpm dev`.

### 4. Sidecar Process Management Verification

**File:** `src-tauri/src/sidecar.rs`

**Concern:** Windows doesn't have Unix signals (SIGTERM/SIGINT). Tauri's `kill()` on Windows maps to `TerminateProcess`, which is a hard kill — no graceful shutdown.

**Action:** Verify the sidecar handles abrupt termination correctly (no orphaned OpenCode server processes). If needed, add a Windows-specific shutdown sequence: send a `shutdown` command via stdin before calling `kill()`.

---

## Phase 2: CI Hardening

### 5. Windows Smoke Tests in CI

Add to the existing CI workflow (or a new `test.yml` workflow):
- Run `cargo test` on `windows-latest`
- Run `pnpm test --run` (Vitest frontend tests) on `windows-latest`
- Run `cd src-tauri/sidecar-opencode && pnpm test` on `windows-latest`

### 6. Installer Verification

Tauri generates NSIS (`.exe`) and MSI (WiX) installers by default with `"targets": "all"`.

Verify:
- NSIS installer creates Start Menu shortcuts
- MSI installer registers properly in Programs & Features
- Uninstall removes app cleanly
- Optional: customize installer branding via `tauri.conf.json > bundle > windows > nsis`

---

## Phase 3: Code Signing

### 7. Certificate Acquisition

- **Standard OV (Organization Validation):** ~$100-300/year from Sectigo, DigiCert, or Comodo. Builds SmartScreen reputation over time.
- **EV (Extended Validation):** ~$300-500/year. Immediate SmartScreen trust, no "unknown publisher" warnings.
- **Recommendation:** Start with OV; upgrade to EV when user volume justifies the cost.

### 8. CI Signing Integration

Wire into `.github/workflows/publish.yml`:
1. Store certificate (`.pfx`) as base64 GitHub secret: `WINDOWS_CERTIFICATE`
2. Store password as: `WINDOWS_CERTIFICATE_PASSWORD`
3. Add a CI step on `windows-latest` to decode and import the certificate
4. Tauri v2 auto-signs when it detects the cert in the environment, or use `signCommand` in `tauri.conf.json > bundle > windows`

---

## Requirements Update

Update `docs/specs/cowork-z/requirements.md`:
- Add "Windows Production Readiness" as the **top item** in the Outstanding Feature TODO section
- Reference this design doc from the Implementation Plans Index
- Keep the existing cross-platform requirement structure (5.1.1-5.1.4) — the fixes fill in what's already specified but not fully working

---

## Files Changed

| Phase | File | Change |
|-------|------|--------|
| 1 | `src-tauri/src/sidecar.rs` | Platform-aware log directory |
| 1 | `src-tauri/src/lib.rs` | PATH separator, well-known dirs, case-insensitive dedup |
| 1 | `scripts/build-sidecar.mjs` | New cross-platform build script |
| 1 | `tauri.conf.json` | Updated `beforeDevCommand` |
| 2 | `.github/workflows/publish.yml` or new `test.yml` | Windows test jobs |
| 3 | `.github/workflows/publish.yml` | Windows cert import + signing env vars |
| 3 | `tauri.conf.json` | Optional `signCommand` config |
| — | `docs/specs/cowork-z/requirements.md` | Updated TODO, plan reference |
| — | `UPDATE_LOG.md` | Feature entry |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| SmartScreen warns on unsigned builds | Planned: Phase 3 adds signing. Interim: users can click "More info > Run anyway" |
| Orphaned OpenCode processes on Windows | Phase 1 verifies shutdown; add stdin shutdown command if needed |
| PATH expansion misses Windows tools | Requirements already specify well-known dirs; test on Windows CI |
| Certificate acquisition delay | Phases 1-2 ship independently of signing |
