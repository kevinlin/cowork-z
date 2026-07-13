# Release Pipeline Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the release workflow's end-to-end duration while preserving all release artifacts and updater metadata.

**Architecture:** Keep the existing four-platform Tauri matrix. Upgrade to the official action version that mitigates parallel updater-manifest races, run the matrix concurrently, and evaluate later candidates against the new critical path one at a time.

**Tech Stack:** GitHub Actions, Tauri 2, `tauri-apps/tauri-action`, pnpm, Rust.

## Global Constraints

- Change one performance hypothesis per GitHub Actions experiment.
- Revert any candidate that regresses the preceding accepted build.
- Do not accept a run unless all four platform jobs, release assets, and updater entries are complete.
- Run `pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/` after code changes, plus `pnpm typecheck` and `cd src-tauri && cargo check` before completion.

---

### Task 1: Restore Safe Matrix Parallelism

**Files:**
- Modify: `.github/workflows/publish.yml`
- Test: one-off `yq` assertions against `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: Tauri v2 project configuration and the existing four matrix entries.
- Produces: A parallel release matrix using `tauri-apps/tauri-action@v1` with three retries.

- [ ] **Step 1: Verify the current workflow fails the desired-state assertion**

Run:

```bash
yq -e '(.jobs.publish-tauri.strategy | has("max-parallel") | not) and ([.jobs.publish-tauri.steps[] | select(.uses == "tauri-apps/tauri-action@v1")] | length == 1) and (.jobs.publish-tauri.steps[] | select(.uses == "tauri-apps/tauri-action@v1") | .with.retryAttempts == 3)' .github/workflows/publish.yml
```

Expected: exit 1 because the workflow is serialized and uses `tauri-action@v0`.

- [ ] **Step 2: Apply the minimal workflow change**

Remove `max-parallel` and its obsolete serialization comment. Change the action step to:

```yaml
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          tagName: v__VERSION__
          releaseName: 'App v__VERSION__'
          releaseBody: 'See the assets to download this version and install.'
          releaseDraft: true
          prerelease: false
          retryAttempts: 3
          args: ${{ matrix.args }}${{ startsWith(matrix.platform, 'macos') && ' --verbose' || '' }}
```

- [ ] **Step 3: Verify the desired-state assertion passes**

Run the Step 1 command again.

Expected: exit 0.

- [ ] **Step 4: Validate formatting and repository checks**

Run:

```bash
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm typecheck
cd src-tauri && cargo check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the candidate**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: parallelize release builds safely"
```

### Task 2: Verify Parallelism in GitHub Actions

**Files:**
- Inspect: `.github/workflows/publish.yml`
- Inspect: GitHub Actions run and draft release for version `0.8.4`

**Interfaces:**
- Consumes: The committed Task 1 workflow.
- Produces: Measured timing, four successful platform builds, complete assets, and complete updater metadata.

- [ ] **Step 1: Push the experiment branch and dispatch the workflow**

```bash
git push -u origin codex/release-pipeline-performance
gh workflow run publish.yml --repo kevinlin/cowork-z --ref codex/release-pipeline-performance
```

- [ ] **Step 2: Wait for the dispatched run to complete**

Use `gh run list` to identify the run, then `gh run watch RUN_ID --repo kevinlin/cowork-z --exit-status`.

Expected: all four matrix jobs succeed.

- [ ] **Step 3: Verify release assets and updater metadata**

List draft-release assets with the GitHub API. Download `latest.json` and assert the keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, and `windows-x86_64` exist.

Expected: each platform has its bundle and signature, and all four updater keys are present.

- [ ] **Step 4: Compare timings**

Compare workflow active duration and each job's active duration with runs `29251298239` and `29222933810`.

Expected: end-to-end active duration is lower than the serialized baseline. If it regresses or release validation fails, revert Task 1 and commit the revert before considering another candidate.

### Task 3: Optimize the New Critical Path

**Files:**
- Modify only the workflow file required by an evidence-backed candidate.
- Inspect the accepted GitHub Actions run logs.

**Interfaces:**
- Consumes: The accepted parallel workflow and its step timings.
- Produces: Additional accepted improvements or an evidence-backed stop decision.

- [ ] **Step 1: Rank critical-path steps**

Extract step durations from the longest matrix job. Ignore skipped steps and runner queue time.

- [ ] **Step 2: Select one obvious candidate**

Select only a candidate with a visible critical-path cost and a simple, maintainable change. State the hypothesis and expected saving before editing.

- [ ] **Step 3: Test the candidate locally and in GitHub Actions**

Use a failing `yq` assertion or another focused local check before the edit. Commit, push, dispatch, and validate the release exactly as in Task 2.

- [ ] **Step 4: Keep or revert the candidate**

Keep it only when the GitHub Actions run improves the accepted baseline and all release checks pass. Otherwise revert it before selecting the next candidate.

- [ ] **Step 5: Stop when no obvious candidate remains**

Stop when remaining steps are dominated by compilation, platform packaging, signing, notarization, or small setup costs whose removal would require disproportionate complexity or reduce reliability.
