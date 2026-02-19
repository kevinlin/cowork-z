#!/usr/bin/env node

/**
 * Sync local skill templates from multiple upstream repos.
 *
 * Sources (checked in order, first match wins):
 *   1. anthropics/knowledge-work-plugins  — category-mapped skills + commands
 *   2. anthropics/skills                  — skills/  directory
 *   3. ComposioHQ/awesome-claude-skills   — root-level directories
 *
 * Usage: node scripts/sync-skills.mjs [--dry-run]
 *
 * Environment:
 *   GITHUB_TOKEN   Optional — raises API rate limit from 60 to 5000 req/hr
 */

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const TEMPLATES_DIR = resolve(import.meta.dirname, '..', 'src-tauri', 'resources', 'skill-templates');

const UPSTREAM_SOURCES = [
  {
    repo: 'anthropics/knowledge-work-plugins',
    branch: 'main',
    label: 'knowledge-work-plugins',
    type: 'category-mapped',
  },
  {
    repo: 'anthropics/skills',
    branch: 'main',
    label: 'anthropics/skills',
    type: 'skills-subdir',
    prefix: 'skills/',
  },
  {
    repo: 'ComposioHQ/awesome-claude-skills',
    branch: 'master',
    label: 'ComposioHQ/awesome-claude-skills',
    type: 'root-level',
    prefix: '',
  },
];

const CATEGORY_MAP = {
  data: 'data',
  sales: 'sales',
  marketing: 'marketing',
  product: 'product-management',
  finance: 'finance',
  legal: 'legal',
  support: 'customer-support',
  enterprise: 'enterprise-search',
  productivity: 'productivity',
};

const SKIP_PATHS = ['.DS_Store', '.claude-plugin/', 'composio-skills/', 'connect-apps-plugin/', 'connect-apps/', 'connect/', 'template-skill/'];

const dryRun = process.argv.includes('--dry-run');

// ── GitHub helpers ──────────────────────────────────────────

function githubHeaders() {
  const headers = { 'User-Agent': 'cowork-z-sync' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchTree(repo, branch) {
  const url = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${repo}: ${await res.text()}`);
  }
  const data = await res.json();
  if (data.truncated) {
    console.warn(`  ⚠️  Tree truncated for ${repo}`);
  }
  return data.tree;
}

function buildIndex(tree) {
  const index = new Map();
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    if (SKIP_PATHS.some((s) => entry.path.includes(s))) continue;
    index.set(entry.path, true);
  }
  return index;
}

async function downloadFile(repo, branch, remotePath) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${remotePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── Matching ────────────────────────────────────────────────

function extractPrefix(folderName) {
  for (const prefix of Object.keys(CATEGORY_MAP)) {
    if (folderName.startsWith(`${prefix}-`)) {
      return { prefix, remaining: folderName.slice(prefix.length + 1) };
    }
  }
  return null;
}

function findCategoryMappedMatch(folderName, index) {
  const extracted = extractPrefix(folderName);

  if (extracted) {
    const { prefix, remaining } = extracted;
    const upstreamCat = CATEGORY_MAP[prefix];

    const skillPrefix = `${upstreamCat}/skills/${remaining}/`;
    const skillFiles = [...index.keys()].filter((p) => p.startsWith(skillPrefix));
    if (skillFiles.length > 0) {
      return { type: 'skill', files: skillFiles, basePath: skillPrefix };
    }

    const commandPath = `${upstreamCat}/commands/${remaining}.md`;
    if (index.has(commandPath)) {
      return { type: 'command', files: [commandPath], basePath: commandPath };
    }

    const fullSkillPrefix = `${upstreamCat}/skills/${folderName}/`;
    const fullSkillFiles = [...index.keys()].filter((p) => p.startsWith(fullSkillPrefix));
    if (fullSkillFiles.length > 0) {
      return { type: 'skill', files: fullSkillFiles, basePath: fullSkillPrefix };
    }
  }

  for (const upstreamCat of Object.values(CATEGORY_MAP)) {
    const skillPrefix = `${upstreamCat}/skills/${folderName}/`;
    const skillFiles = [...index.keys()].filter((p) => p.startsWith(skillPrefix));
    if (skillFiles.length > 0) {
      return { type: 'skill', files: skillFiles, basePath: skillPrefix };
    }

    const commandPath = `${upstreamCat}/commands/${folderName}.md`;
    if (index.has(commandPath)) {
      return { type: 'command', files: [commandPath], basePath: commandPath };
    }
  }

  return null;
}

function findPrefixedMatch(folderName, index, dirPrefix) {
  const stripped = folderName.replace(/^[a-z]+-/, '');
  for (const name of [folderName, stripped]) {
    const prefix = `${dirPrefix}${name}/`;
    const files = [...index.keys()].filter((p) => p.startsWith(prefix));
    if (files.length > 0) {
      return { type: 'skill', files, basePath: prefix };
    }
  }
  return null;
}

// ── Frontmatter injection (commands only) ───────────────────

function injectNameIntoFrontmatter(text, folderName) {
  if (!text.startsWith('---')) return `---\nname: ${folderName}\n---\n${text}`;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  return `---\nname: ${folderName}\n${text.slice(4, end)}\n---${text.slice(end + 4)}`;
}

// ── Sync ────────────────────────────────────────────────────

async function syncSkill(folderName, match, repo, branch) {
  const localDir = resolve(TEMPLATES_DIR, folderName);

  if (match.type === 'command') {
    const raw = await downloadFile(repo, branch, match.files[0]);
    const content = injectNameIntoFrontmatter(raw.toString('utf-8'), folderName);
    const dest = resolve(localDir, 'SKILL.md');
    await mkdir(localDir, { recursive: true });
    await writeFile(dest, content);
    return 1;
  }

  let count = 0;
  for (const filePath of match.files) {
    const relativePath = filePath.slice(match.basePath.length);
    const dest = resolve(localDir, relativePath);
    const content = await downloadFile(repo, branch, filePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
    count++;
  }
  return count;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 Skill Sync — ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Local: ${TEMPLATES_DIR}\n`);

  console.log('📡 Fetching upstream repo trees...');
  const sources = [];
  for (const src of UPSTREAM_SOURCES) {
    const tree = await fetchTree(src.repo, src.branch);
    const index = buildIndex(tree);
    console.log(`   ${src.label}: ${index.size} files`);
    sources.push({ ...src, index });
  }
  console.log('');

  const localFolders = (await readdir(TEMPLATES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`📂 ${localFolders.length} local skill folders\n`);

  const synced = [];
  const missing = [];
  const errors = [];

  for (const folder of localFolders) {
    let match = null;
    let matchedSource = null;

    for (const src of sources) {
      if (src.type === 'category-mapped') {
        match = findCategoryMappedMatch(folder, src.index);
      } else {
        match = findPrefixedMatch(folder, src.index, src.prefix);
      }
      if (match) {
        matchedSource = src;
        break;
      }
    }

    if (!match) {
      console.log(`  ❌ ${folder} (no upstream match)`);
      missing.push(folder);
      continue;
    }

    const label = match.type === 'command' ? 'command' : `skill (${match.files.length} files)`;
    const sourceTag = matchedSource.label;

    if (dryRun) {
      console.log(`  ✅ ${folder} → ${match.type}: ${match.basePath} [${label}] (${sourceTag})`);
      synced.push(folder);
      continue;
    }

    try {
      const fileCount = await syncSkill(folder, match, matchedSource.repo, matchedSource.branch);
      console.log(`  ✅ ${folder} → synced ${fileCount} file(s) [${label}] (${sourceTag})`);
      synced.push(folder);
    } catch (err) {
      console.log(`  ❌ ${folder} → download error: ${err.message}`);
      errors.push({ folder, error: err.message });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`  ✅ Synced:  ${synced.length}`);
  console.log(`  ❌ Missing: ${missing.length}`);
  if (errors.length > 0) {
    console.log(`  💥 Errors:  ${errors.length}`);
  }

  if (missing.length > 0) {
    console.log('\nMissing skills (no upstream match found):');
    for (const name of missing) {
      console.log(`  - ${name}`);
    }
  }

  if (errors.length > 0) {
    console.log('\nDownload errors:');
    for (const { folder, error } of errors) {
      console.log(`  - ${folder}: ${error}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
