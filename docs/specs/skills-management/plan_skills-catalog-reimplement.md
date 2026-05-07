# Skills Catalog Re-implementation — Curated Repo Browser

## Context

**Today:** the Home tab "Skills Catalog" lists every individual skill bundled under [src-tauri/resources/skill-templates/](src-tauri/resources/skill-templates/) (71 folders) with per-skill Install / Re-install buttons. The skills are bundled into the app binary via `tauri.conf.json` `bundle.resources`, sync'd from upstream by [scripts/sync-skills.mjs](scripts/sync-skills.mjs), and surfaced through `skills_list_with_status` / `skills_install` in [src-tauri/src/commands/skills.rs](src-tauri/src/commands/skills.rs).

**Why change:** bundled-template installs are a parallel install path to the Skills Manager (which clones Git repos and installs via symlink). Maintaining two install models doubles the surface area, bloats the binary, and forces a manual `sync-skills.mjs` ritual to stay current. The Skills Manager already does discovery, install, sync, and update — so the Home Catalog is best repurposed as a curated *discovery* surface that points users at it.

**Outcome:** the Home tab "Skills Catalog" presents a hand-picked list of Git skill repositories (sourced from the user's Agent Skills bookmarks). Clicking a card opens the Skills Manager and auto-adds (or selects) that repo, then filters the toolbar dropdown to it. Bundled templates and the entire `skills_install` code path are removed.

---

## Design — `design_skills-catalog.md` (rewritten)

### Overview

The Skills Catalog is now a *curated discovery* surface for Git-backed skill repositories. It does not install skills directly — it routes the user to the Skills Manager, which performs the actual clone + install.

### Curated Catalog (static)

A static list lives in `src/components/landing/curatedSkillRepos.ts`:

```ts
export interface CuratedSkillRepo {
  url: string;          // HTTPS clone URL
  name: string;         // Display name (e.g. "anthropics/skills")
  summary: string;      // 1–2 sentences derived from each repo's README
  categories: string[]; // 1–3 categories per pack (multi-category)
  branch?: string;      // Defaults to repo default branch on the backend
}

export const CURATED_SKILL_REPOS: CuratedSkillRepo[] = [ /* 16 entries — see table below */ ];
```

**Closed category taxonomy** — re-uses the existing `CATEGORY_COLORS` map from the old `SkillsCatalog.tsx`. No company names. No "Engineering" catch-all. Categories: **Marketing**, **Sales**, **Finance**, **Legal**, **Product**, **Support**, **Data**, **Design**, **Document**, **Productivity**, **Enterprise**, **General**.

Multi-category packs render multiple pill badges, and a pack appears under any of its categories when the user filters.

### UI

Same overall layout as today (header subtitle + search, scrollable category pill row, 2-column grid, footer link to Skills Manager). The card body changes:

```
┌────────────────────────────────────────────────────┐
│  anthropics/knowledge-work-plugins                 │
│  Eleven open-source plugins that turn Claude into  │
│  specialised tools for sales, support, finance…    │
│  ┌──────┐ ┌──────────┐ ┌────────┐      [ Open → ]  │
│  │ Sales│ │ Finance  │ │ Support│                  │
│  └──────┘ └──────────┘ └────────┘                  │
└────────────────────────────────────────────────────┘
```

- **No Install / Re-install** buttons. Each card has a single **Open** action.
- **No installed-state badge** — that's the Skills Manager's job.
- **No View / preview** action — preview lives in the Skills Manager file tree + preview pane.
- **Multi-category badges** — render one pill per entry in `categories`, each color-coded via `CATEGORY_COLORS`. Unknown categories fall back to `bg-muted text-muted-foreground`.
- **Category filter logic** — when the user picks a category pill, show packs whose `categories` array *includes* that category (`Array.includes`). "All" shows everything. The pill row is built from `Array.from(new Set(CURATED_SKILL_REPOS.flatMap(r => r.categories))).sort()`.

### Click → Skills Manager Handoff

A new helper in `src/lib/skills-window.ts`:

```ts
export async function openSkillsManagerForRepo(repo: { url: string; branch?: string }) {
  localStorage.setItem('skills:pendingFocusRepo', JSON.stringify(repo));
  await openSkillsManagerWindow();  // opens new or focuses existing
}
```

`localStorage` is shared across same-origin Tauri webview windows and fires a `storage` event in *other* windows when written — so it handles both:
- **Window not open:** main writes localStorage, opens window. Window mounts, reads localStorage on mount.
- **Window already open:** main writes localStorage. Skills window receives a `storage` event and processes immediately. `setFocus()` brings it forward.

`SkillsManagerPage` mounts a new `useEffect` that:
1. On mount, calls `consumePendingFocusRepo()` after `refreshAll()` resolves.
2. Subscribes to `window.addEventListener('storage', ...)` to catch live writes.
3. `consumePendingFocusRepo` reads + clears the localStorage key, then:
   - If a repo with that URL is already in `repos` → `setSelectedRepoId(repo.id)`.
   - Else → call new `addRepo({ url, branch })` store action, then select the resulting repo.
   - On error, surface a toast via `sonner` and (optionally) open `AddRepoDialog` prefilled with the URL so the user can add an auth token for private repos.

### Store Changes — `skillsManagerStore.ts`

New action:

```ts
addRepo: (input: { url: string; branch?: string; authToken?: string }) => Promise<SkillRepo>
```

Wraps `api.skillReposAdd(input.url, input.branch, input.authToken)`, awaits `refreshAll()`, and returns the new `SkillRepo`. The existing `AddRepoDialog` migrates from calling `api.skillReposAdd` directly to calling the store action (single source of truth).

Optional: `prefillAddRepoUrl: string | null` + `setPrefillAddRepoUrl(...)` — used to pop the AddRepoDialog with a URL prefilled when auto-add fails.

### Cleanup of the Old Implementation

**Delete:**
- `src-tauri/resources/skill-templates/` (71 folders)
- `scripts/sync-skills.mjs`
- `tauri.conf.json` → remove `"resources/skill-templates/**/*"` from `bundle.resources`

**Rust ([src-tauri/src/commands/skills.rs](src-tauri/src/commands/skills.rs)) — remove:**
- `resolve_templates_dir()` (private)
- `install_skill()` + `skills_install` command
- `skills_get_template_path` command
- The bundled-template fallback branch in `skills_get_skill_file_path` (keep only project + global lookup)
- All bundled-template unit tests inside `#[cfg(test)]`

**Rust — keep (still used by `skill_repos.rs` and `skill_discovery.rs`):**
- `derive_category()`, `parse_frontmatter()`, `compute_dir_checksum()`, `copy_dir_recursive()`, `opencode_skills_dir()`

**Rust — modify `list_skills_with_status()`:** remove the bundled-template enumeration pass; it should now scan only `~/.config/opencode/skills/` (the existing "Pass 2" custom-skill loop already does this — keep that, drop Pass 1). Returned shape stays the same so [src/stores/skillsStore.ts](src/stores/skillsStore.ts) (slash-command autocomplete) keeps working — `installed: true` for everything found, `needs_update: false` always.

**Rust — unregister in [src-tauri/src/lib.rs](src-tauri/src/lib.rs):**
- `commands::skills::skills_install`
- `commands::skills::skills_get_template_path`

**TypeScript — remove from [src/lib/tauri-api.ts](src/lib/tauri-api.ts) and [src/lib/tauri-api-interface.ts](src/lib/tauri-api-interface.ts):**
- `installSkill()`, `getSkillTemplatePath()`

**TypeScript — keep:** `listSkillsWithStatus()`, `getSkillFilePath()`, `onSkillsChanged()`. The autocomplete store and chat-input skill-pill resolver continue to work.

**Frontend — rewrite:**
- [src/components/landing/SkillsCatalog.tsx](src/components/landing/SkillsCatalog.tsx) — new curated-card UI
- [src/components/landing/__tests__/SkillsCatalog.test.tsx](src/components/landing/__tests__/SkillsCatalog.test.tsx) — replace bundled-skill mocks with curated-list assertions

### Curated Catalog — Initial Entries

Hand-picked from the user's Agent Skills bookmarks; summaries derived from each repo's README. Skips awesome-lists (BehiSecc, ComposioHQ), the security scanner (cisco-ai-defense), and the MCP server (softeria/ms-365-mcp-server) since they aren't installable skill repos.

| Repo | Categories | Summary |
|---|---|---|
| `anthropics/skills` | Document, General | Reference implementation of the Agent Skills spec, including the source-available DOCX / PDF / PPTX / XLSX skills that power Claude's production document creation. |
| `anthropics/knowledge-work-plugins` | Sales, Finance, Support | Eleven plugins that turn Claude into role-tailored tools for sales, support, finance, and bio-research, bundling skills, slash commands, and connectors to Slack, Notion, HubSpot, and Snowflake. |
| `anthropics/financial-services` | Finance | Reference agents and skill bundles for investment banking, equity research, private equity, wealth management, and fund administration — drafting DCF models, CIMs, IC memos, and GL reconciliations. |
| `anthropics/claude-plugins-official` | General | Official Claude Code plugin marketplace directory — Anthropic-developed and vetted third-party plugins in a standard layout (metadata, MCP config, slash commands, agents, skills). |
| `openai/skills` | General | OpenAI Codex skills catalog organized into system, curated, and experimental tiers — reusable instruction packs for AI coding agents. |
| `vercel-labs/skills` | General | The `skills` CLI — a package manager for discovering, installing, and managing Agent Skills across 55+ AI coding agents (Claude Code, OpenCode, Cursor, Cline, Copilot, …). |
| `vercel-labs/agent-skills` | Design | Vercel Engineering's own agent skills: React + Next.js best practices, web design and accessibility, React Native rules, View Transition animation patterns, and one-command Vercel deployment. |
| `deanpeters/Product-Manager-Skills` | Product | 47 product-management skills — 21 templates, 20 guided workshops, 6 end-to-end workflows — drawing from Geoffrey Moore, Jeff Patton, Teresa Torres, and Amazon-style PM frameworks. |
| `OthmanAdi/planning-with-files` | Productivity | Manus-style persistent markdown planning: agents track plans, findings, and progress in three structured files for coherent context across long multi-step workflows (96.7% benchmark vs 6.7% baseline). |
| `luwill/research-skills` | Productivity, Document | Academic research workflows: literature reviews, paper-to-presentation slide generation with PDF figure detection, bilingual PhD proposals, and a five-agent system for survey papers. |
| `jimliu/baoyu-skills` | Marketing, Document | Visual content generation (Xiaohongshu cards, infographics, SVG diagrams, slides, comics), multi-provider AI image generation, social publishing, and content utilities (YouTube transcripts, URL→Markdown). |
| `mattpocock/skills` | Productivity | Engineering-focused skills addressing common AI-assisted-dev failure modes: TDD (`/tdd`), structured debugging (`/diagnose`), requirement clarification (`/grill-me`), PRD generation, architecture review. |
| `JuliusBrussee/caveman` | Productivity | A token-efficient "caveman mode" that compresses Claude Code output by ~65% across four levels (lite, full, ultra, classical Chinese), cutting response time ~3× while preserving technical accuracy. |
| `openclaw/openclaw` | Productivity, General | 70+ skill modules for messaging (Discord, Slack, WhatsApp, iMessage), productivity (Notion, Obsidian, Trello), dev tooling (GitHub, MCP porter), smart home, media, and system utilities. |
| `shirenchuang/web-content-fetcher` | Productivity | Web article extraction to clean Markdown via dual-mode Scrapling (fast / stealth) with Jina Reader fallback — strong on Chinese platforms (WeChat OA, Zhihu, CSDN, Juejin) and international sites. |
| `wondelai/skills` | Product, Marketing, Sales | 43 skills encoding business and tech frameworks (JTBD, StoryBrand, CRO, Crossing the Chasm, Clean Code, DDD, Cialdini Influence) into packs for product strategy, UX, marketing/CRO, sales, and code craft. |

### Error Handling

| Scenario | Behavior |
|---|---|
| Click card, repo already added | Skills Manager focuses, dropdown filters to that repo |
| Click card, repo not added, clone succeeds | Skills Manager focuses, repo added, dropdown filters to it, success toast |
| Click card, clone fails (network, auth) | Error toast, AddRepoDialog opens prefilled with the URL so the user can add a token |
| Skills Manager already open when clicked | `setFocus()` brings it forward, `storage` event triggers the same flow |
| `localStorage` write race (write before window mounted) | Handled — on-mount consume reads and clears the key |

---

## Implementation Plan — `plan_skills-catalog.md` (rewritten)

> Implementation order: cleanup first (delete dead code), then build the new surface, then re-test.

### Task 1 — Backend cleanup

**Files:**
- Modify: [src-tauri/src/commands/skills.rs](src-tauri/src/commands/skills.rs)
- Modify: [src-tauri/src/lib.rs](src-tauri/src/lib.rs)
- Modify: [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)
- Delete: [src-tauri/resources/skill-templates/](src-tauri/resources/skill-templates/) (whole directory)
- Delete: [scripts/sync-skills.mjs](scripts/sync-skills.mjs)

Steps:
1. Remove `resolve_templates_dir`, `install_skill`, `skills_install`, `skills_get_template_path`, and the bundled-template fallback in `skills_get_skill_file_path`.
2. Refactor `list_skills_with_status` → returns only what's enumerable in `~/.config/opencode/skills/` (re-use the existing `scan_skill_dirs` + `make_skill` helpers; drop `templates_dir` argument from `list_skills_in_dirs`, or inline that single-dir scan).
3. Remove the bundled-template tests under `#[cfg(test)]`.
4. Unregister `skills_install` and `skills_get_template_path` from `invoke_handler!` in `lib.rs`.
5. Remove `"resources/skill-templates/**/*"` from `bundle.resources` in `tauri.conf.json`.
6. `rm -rf src-tauri/resources/skill-templates`.
7. `rm scripts/sync-skills.mjs`.

**New / updated unit tests in `skills.rs#[cfg(test)]`:**
- `list_skills_with_status_returns_installed_only` — given a tempdir with two skill folders (one with `SKILL.md` frontmatter, one without), verifies the function returns one entry with `installed: true, needs_update: false`, correct name/description/category derived.
- `list_skills_with_status_skips_dotfiles_and_files` — confirms `.DS_Store`, `.config`, and stray loose files inside the skills dir are skipped.
- `parse_frontmatter_invalid_returns_none` — guard against regression after removing bundled tests.
- `derive_category_*` — keep all existing prefix tests.

Verify: `cd src-tauri && cargo check` and `cd src-tauri && cargo test commands::skills`.

### Task 2 — Frontend API cleanup

**Files:**
- Modify: [src/lib/tauri-api.ts](src/lib/tauri-api.ts) (remove `installSkill`, `getSkillTemplatePath`, drop them from `getTauriApi()` return)
- Modify: [src/lib/tauri-api-interface.ts](src/lib/tauri-api-interface.ts) (remove from `TauriAPI` interface and the cached singleton spread)

Verify: `pnpm typecheck` passes (the only callers were `SkillsCatalog.tsx`, which is rewritten in Task 4).

### Task 3 — Skills Manager store: `addRepo` + pending-focus consumption

**Files:**
- Modify: [src/stores/skillsManagerStore.ts](src/stores/skillsManagerStore.ts)
- Modify: [src/components/skills-manager/AddRepoDialog.tsx](src/components/skills-manager/AddRepoDialog.tsx)

Steps:
1. Add `addRepo({ url, branch?, authToken? }) => Promise<SkillRepo>` action to the store. It calls `api.skillReposAdd`, awaits `refreshAll()`, returns the new repo. On API rejection, re-throws so callers can surface the error.
2. Add `prefillAddRepoUrl: string | null` state + `setPrefillAddRepoUrl(url)` action.
3. Add `addRepoDialogOpen: boolean` + `setAddRepoDialogOpen(open)` action so the dialog can be opened from outside `RepoToolbar`.
4. Refactor `AddRepoDialog` to call `useSkillsManagerStore().addRepo(...)` instead of `api.skillReposAdd(...)` directly. Read `prefillAddRepoUrl` on open and use it as the initial `url` value; clear it on close. Open/close state moves from local to the store.
5. Refactor `RepoToolbar` to drive `AddRepoDialog` via the store flag instead of local `useState`.

**New unit tests** in `src/stores/__tests__/skillsManagerStore.test.ts` (create file):
- `addRepo calls skillReposAdd, then refreshAll, and returns the new repo` — mock `getTauriAPI()` to return a fake `skillReposAdd` resolving to a `SkillRepo`; assert call args and that `repos` is updated after `refreshAll`.
- `addRepo propagates errors` — fake `skillReposAdd` rejects; assert the action rejects with the same error and store state isn't corrupted.
- `setPrefillAddRepoUrl + setAddRepoDialogOpen update state` — sanity test, since these are read by the dialog.

Verify: `pnpm typecheck` and `pnpm test src/stores/__tests__/skillsManagerStore.test.ts --run`.

### Task 4 — Window helper + cross-window handoff

**Files:**
- Modify: [src/lib/skills-window.ts](src/lib/skills-window.ts) — add `openSkillsManagerForRepo(repo)` + `consumePendingFocusRepo()` + key constant
- Modify: [src/pages/SkillsManager.tsx](src/pages/SkillsManager.tsx) — wire on-mount + `storage`-event consumption

Steps:
1. In `skills-window.ts`, add:
   ```ts
   export const PENDING_FOCUS_REPO_KEY = 'skills:pendingFocusRepo';
   export async function openSkillsManagerForRepo(repo: { url: string; branch?: string }) {
     localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify(repo));
     await openSkillsManagerWindow();
   }
   export function readAndClearPendingFocusRepo(): { url: string; branch?: string } | null {
     const raw = localStorage.getItem(PENDING_FOCUS_REPO_KEY);
     if (!raw) return null;
     localStorage.removeItem(PENDING_FOCUS_REPO_KEY);
     try { return JSON.parse(raw); } catch { return null; }
   }
   ```
2. In `SkillsManager.tsx`, after the existing `refreshAll()` effect, add a new effect:
   - On mount: await `refreshAll()` (already running), then `processPending()`.
   - Subscribe to `window.addEventListener('storage', ...)` filtered on `PENDING_FOCUS_REPO_KEY`. Trigger `processPending()`.
   - `processPending` reads + clears the key, then:
     - Looks up `repos.find(r => r.url === pending.url)` → if found, `setSelectedRepoId(found.id)`.
     - Else: try `addRepo(pending)`. On success, look up again and select. On error, `toast.error(...)`, `setPrefillAddRepoUrl(pending.url)`, and `setAddRepoDialogOpen(true)` so the user can add an auth token.

**New unit tests** in `src/lib/__tests__/skills-window.test.ts` (create file):
- `openSkillsManagerForRepo writes localStorage with the right shape` — mock `WebviewWindow`, assert `localStorage.getItem(PENDING_FOCUS_REPO_KEY)` matches `JSON.stringify({ url, branch })`.
- `readAndClearPendingFocusRepo returns parsed value and clears the key` — set the key manually, call the helper, assert return value and that the key is now `null`.
- `readAndClearPendingFocusRepo returns null on missing or malformed JSON` — covers both empty and corrupted cases without throwing.

**New integration test** in `src/pages/__tests__/SkillsManager.test.tsx` (create file, may already exist — extend if so):
- `consumes pending-focus repo on mount when URL matches existing repo` — seed store with a repo `{ id: 'r1', url: 'https://github.com/x/y' }`, set localStorage to that URL, render `SkillsManagerPage`, assert `setSelectedRepoId('r1')` was called.
- `consumes pending-focus repo on mount when URL is new` — empty `repos`, set localStorage URL, mock `addRepo` to resolve with the new repo, assert `addRepo` was called and `setSelectedRepoId` was called with the new id.
- `surfaces AddRepoDialog on add failure` — `addRepo` rejects, assert `setAddRepoDialogOpen(true)` and `setPrefillAddRepoUrl(url)` were both called.
- `responds to live storage events` — render the page first, then dispatch a `StorageEvent` for `PENDING_FOCUS_REPO_KEY`, assert the same code path runs.

Verify: `pnpm typecheck` and `pnpm test src/lib/__tests__/skills-window.test.ts src/pages/__tests__/SkillsManager.test.tsx --run`.

### Task 5 — Rewrite `SkillsCatalog.tsx` + tests

**Files:**
- Create: `src/components/landing/curatedSkillRepos.ts` (the static list)
- Modify: [src/components/landing/SkillsCatalog.tsx](src/components/landing/SkillsCatalog.tsx) — full rewrite
- Modify: [src/components/landing/__tests__/SkillsCatalog.test.tsx](src/components/landing/__tests__/SkillsCatalog.test.tsx) — full rewrite

Component skeleton:
```tsx
import { CURATED_SKILL_REPOS } from './curatedSkillRepos';
import { openSkillsManagerForRepo } from '@/lib/skills-window';

export default function SkillsCatalog() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [query, setQuery] = useState('');
  const categories = ['All', ...Array.from(new Set(CURATED_SKILL_REPOS.map(r => r.category))).sort()];
  const filtered = CURATED_SKILL_REPOS.filter(/* category + query */).sort(/* by name */);

  const handleOpen = (repo: CuratedSkillRepo) => openSkillsManagerForRepo(repo);
  // ... render: subtitle + search, category pills, 2-col card grid, footer link
}
```

**Unit tests** (replace the existing `SkillsCatalog.test.tsx`):
1. Renders one card per entry in `CURATED_SKILL_REPOS` by default.
2. Each card renders one badge per entry in its `categories` array (multi-category packs render multiple badges).
3. Category filter shows packs whose `categories` array *includes* the active category (e.g. selecting "Sales" shows both `anthropics/knowledge-work-plugins` and `wondelai/skills`).
4. Search filters by name (case-insensitive), summary, and category — one assertion per dimension.
5. "All" pill is always present, always first, and resets the filter.
6. Clicking a card calls `openSkillsManagerForRepo` with the exact `{ url, branch }` payload (helper mocked at module level).
7. Empty-state message shows when search yields zero matches.
8. Footer "Skills Manager" link calls `openSkillsManagerWindow` (no payload).

Verify:
- `pnpm test src/components/landing/__tests__/SkillsCatalog.test.tsx --run`
- `pnpm typecheck`

### Task 6 — Docs + UPDATE_LOG

**Files:**
- Rewrite: [docs/specs/skills-management/design_skills-catalog.md](docs/specs/skills-management/design_skills-catalog.md) — replace contents with the Design section above
- Rewrite: [docs/specs/skills-management/plan_skills-catalog.md](docs/specs/skills-management/plan_skills-catalog.md) — replace contents with this implementation plan
- Modify: [UPDATE_LOG.md](UPDATE_LOG.md) — append to the v0.7.7 section
- Modify: [docs/specs/requirements.md](docs/specs/requirements.md) — re-link the Skills Catalog requirement to point at the new flow (light edit; details TBD on read)

UPDATE_LOG entry (under v0.7.7):

```
- **Skills Catalog redesign — Curated repo browser** — The Home tab "Skills Catalog" now lists hand-picked Git skill repositories (Anthropic, OpenAI, Vercel, and others) instead of bundled individual skills. Clicking a card opens the Skills Manager and either selects the repo (if already added) or auto-clones it via `git clone --depth 1`, then filters the toolbar dropdown to it. Bundled `skill-templates/` and the `sync-skills.mjs` ritual have been retired — all skill discovery and install now flows through the Skills Manager.
```

### Task 7 — Final verification

1. `cd src-tauri && cargo check && cargo test`
2. `pnpm typecheck`
3. `pnpm test --run`
4. `pnpm tauri dev` — manually verify:
   - Home → Skills Catalog tab renders curated cards
   - Click a card with a repo not yet added → Skills Manager opens, clones, selects repo
   - Click again on the same card → Skills Manager focuses, dropdown already on that repo
   - Click a private/invalid URL → AddRepoDialog opens prefilled
   - Slash-command autocomplete still surfaces installed skills (regression check on `skillsStore.ts`)

---

## Critical Files — Summary

| File | Change |
|---|---|
| `src-tauri/resources/skill-templates/` | **Delete** (71 folders) |
| `scripts/sync-skills.mjs` | **Delete** |
| `src-tauri/tauri.conf.json` | Drop `resources/skill-templates/**/*` from bundle.resources |
| `src-tauri/src/commands/skills.rs` | Remove `resolve_templates_dir`, `install_skill`, `skills_install`, `skills_get_template_path`, bundled-template fallback in `skills_get_skill_file_path`, related tests |
| `src-tauri/src/lib.rs` | Unregister `skills_install`, `skills_get_template_path` |
| `src/lib/tauri-api.ts` | Remove `installSkill`, `getSkillTemplatePath` exports |
| `src/lib/tauri-api-interface.ts` | Remove from `TauriAPI` interface + singleton |
| `src/stores/skillsManagerStore.ts` | Add `addRepo` action, `prefillAddRepoUrl`, `addRepoDialogOpen` |
| `src/components/skills-manager/AddRepoDialog.tsx` | Use store `addRepo`, support prefill |
| `src/components/skills-manager/RepoToolbar.tsx` | Open AddRepoDialog from store state (so cross-window handler can trigger it) |
| `src/lib/skills-window.ts` | Add `openSkillsManagerForRepo`, `readAndClearPendingFocusRepo`, key constant |
| `src/pages/SkillsManager.tsx` | On-mount + storage-event consumption of pending-focus key |
| `src/components/landing/curatedSkillRepos.ts` | **New** — static curated list |
| `src/components/landing/SkillsCatalog.tsx` | Full rewrite |
| `src/components/landing/__tests__/SkillsCatalog.test.tsx` | Full rewrite |
| `docs/specs/skills-management/design_skills-catalog.md` | Rewrite |
| `docs/specs/skills-management/plan_skills-catalog.md` | Rewrite |
| `UPDATE_LOG.md` | Append v0.7.7 entry |

---

## Confirmed Design Choices

1. **On-click flow:** auto-clone silently. Skills Manager opens, `skill_repos_add(url)` runs in the background, dropdown selects on success. On clone failure (private / network), fall back to `AddRepoDialog` prefilled with the URL.
2. **Catalog scope:** 16 curated skill repos only (the table above). Skips awesome-lists, the security scanner, and the MCP server — they aren't standard SKILL.md repos.
4. **Categories:** drawn from a closed taxonomy (Marketing, Sales, Finance, Legal, Product, Support, Data, Design, Document, Productivity, Enterprise, General) — re-uses the existing `CATEGORY_COLORS` map. No company names. Each pack carries 1–3 categories, derived from its README.
5. **Summaries:** authored from each repo's README, not invented.
3. **Catalog source:** static TypeScript constant in `src/components/landing/curatedSkillRepos.ts`. No remote fetch; updates ship with app releases.
