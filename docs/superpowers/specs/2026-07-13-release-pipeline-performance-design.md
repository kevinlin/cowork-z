# Release Pipeline Performance Design

## Goal

Reduce the release workflow's end-to-end build time without losing any platform artifact or updater entry.

## Baseline

GitHub Actions run `29251298239` uses one four-leg matrix with `max-parallel: 1`. The jobs therefore run in sequence even when runners are available. The preceding completed release run, `29222933810`, took 37 minutes 49 seconds. Its job durations were 7 minutes 43 seconds for macOS ARM64, 6 minutes 10 seconds for macOS x64, 10 minutes 30 seconds for Linux, and 13 minutes 15 seconds for Windows.

Serialization is intentional. Run `28289931502` showed that parallel `tauri-action` v0 jobs can race while replacing the shared `latest.json` release asset. One job failed with a 404 and the updater manifest lost a platform entry.

## Approach

Use the official `tauri-apps/tauri-action` v1 release, which includes randomized retry delays for the shared `latest.json` update race. Remove matrix serialization and set `retryAttempts: 3`. This keeps the existing build, signing, notarization, packaging, and release upload flow while allowing all four platform jobs to run concurrently.

Run each experiment from `codex/release-pipeline-performance` through `workflow_dispatch`. Compare active workflow and job durations, excluding runner queue time when diagnosing step performance. Keep a candidate only when the workflow succeeds, the release contains every expected platform asset, `latest.json` contains every expected platform key, and the measured time does not regress.

## Alternatives Considered

1. Split parallel builds from a serialized custom publish job. This removes the race by construction, but duplicates release and updater-manifest logic already maintained by the Tauri action.
2. Keep serialization and tune setup or cache steps. This is lower risk but cannot remove the roughly 25 minutes spent waiting for earlier matrix legs.

## Verification

For every accepted candidate:

1. Validate the workflow YAML and its required settings locally.
2. Run the full release workflow through GitHub Actions.
3. Confirm all four matrix jobs succeed.
4. Confirm the draft release has macOS ARM64, macOS x64, Linux, and Windows bundles plus signatures.
5. Download and inspect `latest.json` for `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, and `windows-x86_64` updater entries.
6. Compare end-to-end and critical-path durations with the preceding accepted run.

After parallelism is accepted, inspect the longest job. Test only candidates that remove a visible critical-path cost and do not add a custom subsystem for a small gain.
