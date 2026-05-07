# Skills Catalog — Design Document

## Overview

The Skills Catalog is a **curated discovery surface** for Git-backed skill repositories. It lives in the Home tab and routes the user to the Skills Manager (which performs the actual clone + install). It does **not** install skills directly.

Bundled `skill-templates/` and the `sync-skills.mjs` ritual have been retired. All skill discovery and installation now flows through the Skills Manager.

---

## Curated Catalog (static)

A static TypeScript constant lives at [`src/components/landing/curatedSkillRepos.ts`](../../../src/components/landing/curatedSkillRepos.ts):

```ts
export interface CuratedSkillRepo {
  url: string;          // HTTPS clone URL
  name: string;         // Display name (e.g. "anthropics/skills")
  summary: string;      // 1–2 sentences derived from each repo's README
  categories: string[]; // 1–3 categories per pack (multi-category)
  branch?: string;      // Defaults to repo default branch on the backend
}

export const CURATED_SKILL_REPOS: CuratedSkillRepo[] = [ /* 16 entries */ ];
```

**Closed category taxonomy** — re-uses the existing `CATEGORY_COLORS` map. No company names. No "Engineering" catch-all. Categories: **Marketing**, **Sales**, **Finance**, **Legal**, **Product**, **Support**, **Data**, **Design**, **Document**, **Productivity**, **Enterprise**, **General**.

Multi-category packs render multiple pill badges, and a pack appears under any of its categories when the user filters.

---

## UI

Same overall layout as before (header subtitle + search, scrollable category pill row, 2-column grid, footer link to Skills Manager). The card body changes:

```
┌────────────────────────────────────────────────────┐
│  anthropics/knowledge-work-plugins                 │
│  Eleven plugins that turn Claude into specialised  │
│  tools for sales, support, finance…                │
│  ┌──────┐ ┌──────────┐ ┌────────┐      [ Open → ]  │
│  │ Sales│ │ Finance  │ │ Support│                  │
│  └──────┘ └──────────┘ └────────┘                  │
└────────────────────────────────────────────────────┘
```

- **No Install / Re-install buttons.** Each card has a single **Open** action.
- **No installed-state badge** — that's the Skills Manager's job.
- **No View / preview action** — preview lives in the Skills Manager file tree + preview pane.
- **Multi-category badges** — render one pill per entry in `categories`, each color-coded via `CATEGORY_COLORS`. Unknown categories fall back to `bg-muted text-muted-foreground`.
- **Category filter logic** — when the user picks a category pill, show packs whose `categories` array *includes* that category (`Array.includes`). "All" shows everything. The pill row is built from `Array.from(new Set(CURATED_SKILL_REPOS.flatMap(r => r.categories))).sort()`.

---

## Click → Skills Manager Handoff

Helper module: [`src/lib/skills-window.ts`](../../../src/lib/skills-window.ts).

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
  // ... safe parse with fallback to null on malformed JSON or missing url
}
```

`localStorage` is shared across same-origin Tauri webview windows and fires a `storage` event in *other* windows when written — so it handles both:

- **Window not open:** main writes localStorage, opens window. Window mounts, reads localStorage on mount.
- **Window already open:** main writes localStorage. Skills window receives a `storage` event and processes immediately. `setFocus()` brings it forward.

`SkillsManagerPage` mounts a `useEffect` that:

1. On mount, calls `processPending()` after the existing `refreshAll()` effect has been fired.
2. Subscribes to `window.addEventListener('storage', ...)` to catch live writes.
3. `processPending` reads + clears the key, then:
   - Calls `fetchRepos()` to ensure state is fresh.
   - If a repo with that URL is already in `repos` → `setSelectedRepoId(repo.id)`.
   - Else → call `addRepo({ url, branch })` store action, then select the resulting repo. Shows a success toast.
   - On error, show an error toast and open `AddRepoDialog` prefilled with the URL so the user can add a token for private repos.

---

## Store — `skillsManagerStore.ts`

The store gains a small set of additions to support the handoff:

```ts
// State
prefillAddRepoUrl: string | null;
addRepoDialogOpen: boolean;

// Actions
setPrefillAddRepoUrl(url: string | null): void;
setAddRepoDialogOpen(open: boolean): void;
addRepo(input: { url: string; branch?: string; authToken?: string }): Promise<SkillRepo>;
```

`addRepo` calls `api.skillReposAdd`, awaits `refreshAll()`, and returns the new `SkillRepo`. On API rejection, it re-throws so callers can surface the error and open the dialog. `AddRepoDialog` reads `prefillAddRepoUrl` on open, resets it, and now drives open/close state from the store so `RepoToolbar` and the cross-window handoff both control the same dialog.

---

## Removed Surface

The old bundled-template install path is fully removed:

| Removed | Replaced by |
|---|---|
| `src-tauri/resources/skill-templates/` (71 folders) | Skills Manager + Git repo clones |
| `scripts/sync-skills.mjs` | Skills Manager `git pull` background sync |
| `tauri.conf.json` `bundle.resources` `skill-templates/**/*` | n/a |
| Rust `resolve_templates_dir`, `install_skill`, `skills_install`, `skills_get_template_path` | n/a |
| Bundled-template fallback in `skills_get_skill_file_path` | Project + global lookup only |
| TS `installSkill()`, `getSkillTemplatePath()` (and from `getTauriApi()` + `TauriAPI`) | n/a |

Kept (still used by `skill_repos.rs` / `skill_discovery.rs`): `derive_category()`, `parse_frontmatter()`, `compute_dir_checksum()`, `copy_dir_recursive()`, `opencode_skills_dir()`.

`list_skills_with_status()` now scans only `~/.config/opencode/skills/` and always returns `installed: true, needs_update: false`. The slash-command autocomplete (`skillsStore.ts`) and chat-input skill-pill resolver continue to work unchanged.

---

## Curated Catalog — Initial Entries

Hand-picked. Skips awesome-lists (BehiSecc, ComposioHQ), the security scanner (cisco-ai-defense), and the MCP server (softeria/ms-365-mcp-server) since they aren't installable skill repos.

| Repo | Categories | Summary |
|---|---|---|
| `anthropics/skills` | Document, General | Reference implementation of the Agent Skills spec, including the source-available DOCX / PDF / PPTX / XLSX skills that power Claude's production document creation. |
| `anthropics/knowledge-work-plugins` | Sales, Finance, Support | Eleven plugins that turn Claude into role-tailored tools for sales, support, finance, and bio-research, bundling skills, slash commands, and connectors to Slack, Notion, HubSpot, and Snowflake. |
| `anthropics/financial-services` | Finance | Reference agents and skill bundles for investment banking, equity research, private equity, wealth management, and fund administration. |
| `anthropics/claude-plugins-official` | General | Official Claude Code plugin marketplace directory — Anthropic-developed and vetted third-party plugins. |
| `openai/skills` | General | OpenAI Codex skills catalog organised into system, curated, and experimental tiers. |
| `vercel-labs/skills` | General | The `skills` CLI — a package manager for discovering and managing Agent Skills across 55+ AI coding agents. |
| `vercel-labs/agent-skills` | Design | Vercel Engineering's own agent skills: React + Next.js best practices, web design and accessibility, React Native rules, View Transition animation patterns, and one-command Vercel deployment. |
| `deanpeters/Product-Manager-Skills` | Product | 47 product-management skills — 21 templates, 20 guided workshops, 6 end-to-end workflows. |
| `OthmanAdi/planning-with-files` | Productivity | Manus-style persistent markdown planning for coherent context across long multi-step workflows. |
| `luwill/research-skills` | Productivity, Document | Academic research workflows: literature reviews, paper-to-presentation slide generation, bilingual proposals, survey papers. |
| `jimliu/baoyu-skills` | Marketing, Document | Visual content generation, multi-provider AI image generation, social publishing, content utilities. |
| `mattpocock/skills` | Productivity | Engineering-focused skills: TDD, structured debugging, requirement clarification, PRD generation, architecture review. |
| `JuliusBrussee/caveman` | Productivity | Token-efficient "caveman mode" that compresses Claude Code output ~65%. |
| `openclaw/openclaw` | Productivity, General | 70+ skill modules for messaging, productivity, dev tooling, smart home, media, and system utilities. |
| `shirenchuang/web-content-fetcher` | Productivity | Web article extraction to clean Markdown via dual-mode Scrapling with Jina Reader fallback. |
| `wondelai/skills` | Product, Marketing, Sales | 43 skills encoding business and tech frameworks (JTBD, StoryBrand, CRO, Clean Code, DDD, Cialdini Influence). |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Click card, repo already added | Skills Manager focuses, dropdown filters to that repo |
| Click card, repo not added, clone succeeds | Skills Manager focuses, repo added, dropdown filters to it, success toast |
| Click card, clone fails (network, auth) | Error toast, AddRepoDialog opens prefilled with the URL so the user can add a token |
| Skills Manager already open when clicked | `setFocus()` brings it forward, `storage` event triggers the same flow |
| `localStorage` write race (write before window mounted) | Handled — on-mount consume reads and clears the key |
| Malformed JSON or missing url in `localStorage` | `readAndClearPendingFocusRepo()` returns `null` and clears the key without throwing |

---

## Confirmed Design Choices

1. **On-click flow:** auto-clone silently. Skills Manager opens, `skill_repos_add(url)` runs in the background, dropdown selects on success. On clone failure (private / network), fall back to `AddRepoDialog` prefilled with the URL.
2. **Catalog scope:** 16 curated skill repos only. Skips awesome-lists, the security scanner, and the MCP server.
3. **Catalog source:** static TypeScript constant in `src/components/landing/curatedSkillRepos.ts`. No remote fetch; updates ship with app releases.
4. **Categories:** drawn from a closed taxonomy (Marketing, Sales, Finance, Legal, Product, Support, Data, Design, Document, Productivity, Enterprise, General) — re-uses `CATEGORY_COLORS`. No company names. Each pack carries 1–3 categories, derived from its README.
5. **Summaries:** authored from each repo's README, not invented.
