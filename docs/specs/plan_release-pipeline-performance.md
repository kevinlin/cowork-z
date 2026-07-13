# Plan: Release Pipeline Performance

**Goal:** Reduce the release workflow's end-to-end build time without losing any platform artifact or updater entry.

**Architecture:** Keep the existing four-platform Tauri matrix. Upgrade to the official action version that mitigates parallel updater-manifest races, run the matrix concurrently, and evaluate later candidates against the new critical path one at a time.

**Tech Stack:** GitHub Actions, Tauri 2, `tauri-apps/tauri-action`, pnpm, Rust.

## Baseline

GitHub Actions run `29251298239` uses one four-leg matrix with `max-parallel: 1`. The jobs therefore run in sequence even when runners are available. The preceding completed release run, `29222933810`, took 37 minutes 49 seconds. Its job durations were 7 minutes 43 seconds for macOS ARM64, 6 minutes 10 seconds for macOS x64, 10 minutes 30 seconds for Linux, and 13 minutes 15 seconds for Windows.

Serialization is intentional. Run `28289931502` showed that parallel `tauri-action` v0 jobs can race while replacing the shared `latest.json` release asset. One job failed with a 404 and the updater manifest lost a platform entry.

## Approach

Use the official `tauri-apps/tauri-action` v1 release, which includes randomized retry delays for the shared `latest.json` update race. Remove matrix serialization and set `retryAttempts: 3`. This keeps the existing build, signing, notarization, packaging, and release upload flow while allowing all four platform jobs to run concurrently.

Run each experiment from `codex/release-pipeline-performance` through `workflow_dispatch`. Compare active workflow and job durations, excluding runner queue time when diagnosing step performance. Keep a candidate only when the workflow succeeds, the release contains every expected platform asset, `latest.json` contains every expected platform key, and the measured time does not regress.

## Alternatives Considered

1. Split parallel builds from a serialized custom publish job. This removes the race by construction, but duplicates release and updater-manifest logic already maintained by the Tauri action.
2. Keep serialization and tune setup or cache steps. This is lower risk but cannot remove the roughly 25 minutes spent waiting for earlier matrix legs.

## Implementation Plan

### Task 1 — Restore Safe Matrix Parallelism

Removed the `max-parallel: 1` serialization from `.github/workflows/publish.yml` and upgraded from `tauri-apps/tauri-action@v0` to `@v1` with `retryAttempts: 3`, enabling all four platform builds to run concurrently while the action's built-in retry logic handles the shared `latest.json` upload race.

### Task 2 — Verify Parallelism in GitHub Actions

Pushed the workflow change, dispatched a full release build via `workflow_dispatch`, and verified that all four matrix jobs succeeded concurrently, the draft release contained every expected platform bundle and signature, and `latest.json` contained all four updater platform keys. Compared timings against the serialized baseline runs.

### Task 3 — Optimize the New Critical Path

Inspected the longest job's step durations to identify optimization candidates on the new parallel critical path. The Windows `Install pnpm` step (36 seconds) was the only candidate with a visible critical-path cost and a simple change. Switched to `pnpm/action-setup` standalone mode to install the bundled pnpm executable directly instead of routing through npm.

## Verification

For every accepted candidate:

1. Validate the workflow YAML and its required settings locally.
2. Run the full release workflow through GitHub Actions.
3. Confirm all four matrix jobs succeed.
4. Confirm the draft release has macOS ARM64, macOS x64, Linux, and Windows bundles plus signatures.
5. Download and inspect `latest.json` for `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, and `windows-x86_64` updater entries.
6. Compare end-to-end and critical-path durations with the preceding accepted run.

After parallelism is accepted, inspect the longest job. Test only candidates that remove a visible critical-path cost and do not add a custom subsystem for a small gain.

## Experiment Results

### Safe Matrix Parallelism

Run `29253318261`, attempt 2, completed successfully in 9 minutes 3 seconds. All four matrix jobs ran concurrently. The draft release contained every expected bundle and signature, and `latest.json` contained all required macOS, Linux, and Windows updater entries. This is a 20 minute 37 second reduction from run `29251298239`, which completed in 29 minutes 40 seconds.

The new critical path is Windows. Its 9 minute 3 second job spends 6 minutes 30 seconds in the Tauri build action, including 4 minutes 57 seconds compiling the optimized Rust application. Most remaining time is therefore required compilation and packaging.

### Standalone pnpm Setup Candidate

The Windows `Install pnpm` step takes 36 seconds because the default action path installs pnpm through npm. `pnpm/action-setup` supports a `standalone` mode that installs the bundled pnpm executable. Test this as a separate candidate because it is a one-line supported setting on the critical path. Keep it only if the complete release remains valid and finishes faster than 9 minutes 3 seconds.

Run `29255117833` completed successfully in 8 minutes 29 seconds overall, 42 seconds faster than the accepted parallel run. The Windows critical-path job fell from 9 minutes 3 seconds to 8 minutes 20 seconds, and its pnpm setup step fell from 36 seconds to 27 seconds. The draft release and updater manifest remained complete, so the candidate is accepted.

## Stop Decision

The remaining critical path spends 6 minutes 6 seconds in the Tauri action. The preceding run showed that 4 minutes 57 seconds of this is optimized Rust compilation, followed by the required MSI and NSIS packaging, signing, and uploads. Other Windows setup steps are each 27 seconds or less. Linux dependency installation varied to 1 minute 31 seconds but did not become the critical path.

Further reductions would require changing compilation, caching, or release packaging architecture for a smaller and less certain gain. Installing only one Rust target in each macOS matrix leg would not affect the Windows critical path. Prebuilding the frontend or replacing Tauri's release publishing would add artifact coordination and duplicate maintained action logic. There is no remaining obvious candidate with a measured critical-path cost and a simple, reliable change.

## Critical Files — Summary

| Path | Role |
|------|------|
| `.github/workflows/publish.yml` | Release workflow (matrix strategy, action version, retry config, pnpm setup) |

## Changelog

- 2026-07-14 — **Merged design + plan and compacted post-implementation.** Combined `design_release-pipeline-performance.md` and `plan_release-pipeline-performance.md` into a single plan file. Removed step-by-step implementation tasks, code blocks, file-by-file diffs, and verification command lists now that the feature has shipped. Preserved Goal, Baseline, Approach, Alternatives, Experiment Results, Stop Decision, and Critical Files summary. Original documents are recoverable via git history.
