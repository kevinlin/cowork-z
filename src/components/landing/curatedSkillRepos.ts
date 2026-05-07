/**
 * Curated list of Git skill repositories surfaced in the Home tab "Skills Catalog".
 *
 * Hand-picked. Summaries are derived from each repo's README. Categories use the
 * closed taxonomy from `CATEGORY_COLORS` in `@/lib/skill-categories`. A single
 * repo may carry up to 3 categories; filtering uses `Array.includes`.
 */

export interface CuratedSkillRepo {
  /** HTTPS clone URL. */
  url: string;
  /** Display name (typically `owner/repo`). */
  name: string;
  /** Short README-derived summary, 1–2 sentences. */
  summary: string;
  /** 1–3 categories from the closed taxonomy. */
  categories: string[];
  /** Defaults to the repo's default branch on the backend. */
  branch?: string;
}

export const CURATED_SKILL_REPOS: CuratedSkillRepo[] = [
  {
    url: 'https://github.com/anthropics/skills.git',
    name: 'anthropics/skills',
    summary:
      'Reference implementation of the Agent Skills spec, including the source-available DOCX / PDF / PPTX / XLSX skills that power Claude’s production document creation.',
    categories: ['Document', 'General'],
  },
  {
    url: 'https://github.com/anthropics/knowledge-work-plugins.git',
    name: 'anthropics/knowledge-work-plugins',
    summary:
      'Eleven plugins that turn Claude into role-tailored tools for sales, support, finance, and bio-research, bundling skills, slash commands, and connectors to Slack, Notion, HubSpot, and Snowflake.',
    categories: ['Sales', 'Finance', 'Support'],
  },
  {
    url: 'https://github.com/anthropics/financial-services.git',
    name: 'anthropics/financial-services',
    summary:
      'Reference agents and skill bundles for investment banking, equity research, private equity, wealth management, and fund administration — drafting DCF models, CIMs, IC memos, and GL reconciliations.',
    categories: ['Finance'],
  },
  {
    url: 'https://github.com/anthropics/claude-plugins-official.git',
    name: 'anthropics/claude-plugins-official',
    summary:
      'Official Claude Code plugin marketplace directory — Anthropic-developed and vetted third-party plugins in a standard layout (metadata, MCP config, slash commands, agents, skills).',
    categories: ['General'],
  },
  {
    url: 'https://github.com/openai/skills.git',
    name: 'openai/skills',
    summary:
      'OpenAI Codex skills catalog organised into system, curated, and experimental tiers — reusable instruction packs for AI coding agents.',
    categories: ['General'],
  },
  {
    url: 'https://github.com/vercel-labs/skills.git',
    name: 'vercel-labs/skills',
    summary:
      'The `skills` CLI — a package manager for discovering, installing, and managing Agent Skills across 55+ AI coding agents (Claude Code, OpenCode, Cursor, Cline, Copilot, …).',
    categories: ['General'],
  },
  {
    url: 'https://github.com/vercel-labs/agent-skills.git',
    name: 'vercel-labs/agent-skills',
    summary:
      'Vercel Engineering’s own agent skills: React + Next.js best practices, web design and accessibility, React Native rules, View Transition animation patterns, and one-command Vercel deployment.',
    categories: ['Design'],
  },
  {
    url: 'https://github.com/deanpeters/Product-Manager-Skills.git',
    name: 'deanpeters/Product-Manager-Skills',
    summary:
      '47 product-management skills — 21 templates, 20 guided workshops, 6 end-to-end workflows — drawing from Geoffrey Moore, Jeff Patton, Teresa Torres, and Amazon-style PM frameworks.',
    categories: ['Product'],
  },
  {
    url: 'https://github.com/OthmanAdi/planning-with-files.git',
    name: 'OthmanAdi/planning-with-files',
    summary:
      'Manus-style persistent markdown planning: agents track plans, findings, and progress in three structured files for coherent context across long multi-step workflows (96.7% benchmark vs 6.7% baseline).',
    categories: ['Productivity'],
  },
  {
    url: 'https://github.com/luwill/research-skills.git',
    name: 'luwill/research-skills',
    summary:
      'Academic research workflows: literature reviews, paper-to-presentation slide generation with PDF figure detection, bilingual PhD proposals, and a five-agent system for survey papers.',
    categories: ['Productivity', 'Document'],
  },
  {
    url: 'https://github.com/jimliu/baoyu-skills.git',
    name: 'jimliu/baoyu-skills',
    summary:
      'Visual content generation (Xiaohongshu cards, infographics, SVG diagrams, slides, comics), multi-provider AI image generation, social publishing, and content utilities (YouTube transcripts, URL→Markdown).',
    categories: ['Marketing', 'Document'],
  },
  {
    url: 'https://github.com/mattpocock/skills.git',
    name: 'mattpocock/skills',
    summary:
      'Engineering-focused skills addressing common AI-assisted-dev failure modes: TDD (`/tdd`), structured debugging (`/diagnose`), requirement clarification (`/grill-me`), PRD generation, architecture review.',
    categories: ['Productivity'],
  },
  {
    url: 'https://github.com/JuliusBrussee/caveman.git',
    name: 'JuliusBrussee/caveman',
    summary:
      'A token-efficient "caveman mode" that compresses Claude Code output by ~65% across four levels (lite, full, ultra, classical Chinese), cutting response time ~3× while preserving technical accuracy.',
    categories: ['Productivity'],
  },
  {
    url: 'https://github.com/openclaw/openclaw.git',
    name: 'openclaw/openclaw',
    summary:
      '70+ skill modules for messaging (Discord, Slack, WhatsApp, iMessage), productivity (Notion, Obsidian, Trello), dev tooling (GitHub, MCP porter), smart home, media, and system utilities.',
    categories: ['Productivity', 'General'],
  },
  {
    url: 'https://github.com/shirenchuang/web-content-fetcher.git',
    name: 'shirenchuang/web-content-fetcher',
    summary:
      'Web article extraction to clean Markdown via dual-mode Scrapling (fast / stealth) with Jina Reader fallback — strong on Chinese platforms (WeChat OA, Zhihu, CSDN, Juejin) and international sites.',
    categories: ['Productivity'],
  },
  {
    url: 'https://github.com/wondelai/skills.git',
    name: 'wondelai/skills',
    summary:
      '43 skills encoding business and tech frameworks (JTBD, StoryBrand, CRO, Crossing the Chasm, Clean Code, DDD, Cialdini Influence) into packs for product strategy, UX, marketing/CRO, sales, and code craft.',
    categories: ['Product', 'Marketing', 'Sales'],
  },
];
