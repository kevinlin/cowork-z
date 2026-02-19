#!/usr/bin/env node

/**
 * Sync local skill templates from upstream anthropics/knowledge-work-plugins.
 *
 * Usage: node scripts/sync-skills.mjs [--dry-run]
 *
 * Environment:
 *   GITHUB_TOKEN   Optional — raises API rate limit from 60 to 5000 req/hr
 */

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';

const REPO = 'anthropics/knowledge-work-plugins';
const BRANCH = 'main';
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

const TEMPLATES_DIR = resolve(import.meta.dirname, '..', 'src-tauri', 'resources', 'skill-templates');

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

const SKIP_PREFIXES = ['design', 'doc', 'development'];

const SKIP_PATHS = ['.DS_Store', '.claude-plugin/'];

const dryRun = process.argv.includes('--dry-run');

async function fetchTree() {
  const headers = { 'User-Agent': 'cowork-z-sync' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(TREE_URL, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (data.truncated) {
    console.warn('⚠️  GitHub tree was truncated — very large repos may miss some files');
  }
  return data.tree;
}

function buildUpstreamIndex(tree) {
  const index = new Map();
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    if (SKIP_PATHS.some((s) => entry.path.includes(s))) continue;
    index.set(entry.path, true);
  }
  return index;
}

function extractPrefix(folderName) {
  for (const prefix of Object.keys(CATEGORY_MAP)) {
    if (folderName.startsWith(`${prefix}-`)) {
      return { prefix, remaining: folderName.slice(prefix.length + 1) };
    }
  }
  return null;
}

function findUpstreamMatch(folderName, index) {
  const extracted = extractPrefix(folderName);

  if (extracted) {
    const { prefix, remaining } = extracted;
    const upstreamCat = CATEGORY_MAP[prefix];

    // i. Skill directory: {upstream-cat}/skills/{remaining-name}/
    const skillPrefix = `${upstreamCat}/skills/${remaining}/`;
    const skillFiles = [...index.keys()].filter((p) => p.startsWith(skillPrefix));
    if (skillFiles.length > 0) {
      return { type: 'skill', files: skillFiles, basePath: skillPrefix };
    }

    // ii. Command file: {upstream-cat}/commands/{remaining-name}.md
    const commandPath = `${upstreamCat}/commands/${remaining}.md`;
    if (index.has(commandPath)) {
      return { type: 'command', files: [commandPath], basePath: commandPath };
    }

    // iii. Skill with full local name: {upstream-cat}/skills/{full-local-name}/
    const fullSkillPrefix = `${upstreamCat}/skills/${folderName}/`;
    const fullSkillFiles = [...index.keys()].filter((p) => p.startsWith(fullSkillPrefix));
    if (fullSkillFiles.length > 0) {
      return { type: 'skill', files: fullSkillFiles, basePath: fullSkillPrefix };
    }
  }

  // iv. Full-name search across ALL upstream categories
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

async function downloadFile(remotePath) {
  const url = `${RAW_BASE}/${remotePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function syncSkill(folderName, match) {
  const localDir = resolve(TEMPLATES_DIR, folderName);

  if (match.type === 'command') {
    const content = await downloadFile(match.files[0]);
    const dest = resolve(localDir, 'SKILL.md');
    await mkdir(localDir, { recursive: true });
    await writeFile(dest, content);
    return 1;
  }

  let count = 0;
  for (const filePath of match.files) {
    const relativePath = filePath.slice(match.basePath.length);
    const dest = resolve(localDir, relativePath);
    const content = await downloadFile(filePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
    count++;
  }
  return count;
}

async function main() {
  console.log(`\n🔄 Skill Sync — ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Upstream: ${REPO} (${BRANCH})`);
  console.log(`   Local:    ${TEMPLATES_DIR}\n`);

  console.log('📡 Fetching upstream repo tree...');
  const tree = await fetchTree();
  const index = buildUpstreamIndex(tree);
  console.log(`   ${index.size} files indexed\n`);

  const localFolders = (await readdir(TEMPLATES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`📂 ${localFolders.length} local skill folders\n`);

  const synced = [];
  const skipped = [];
  const missing = [];
  const errors = [];

  for (const folder of localFolders) {
    const shouldSkip = SKIP_PREFIXES.some((p) => folder.startsWith(`${p}-`));
    if (shouldSkip) {
      console.log(`  ⏭️  ${folder} (cowork-z original, skipped)`);
      skipped.push(folder);
      continue;
    }

    const match = findUpstreamMatch(folder, index);

    if (!match) {
      console.log(`  ❌ ${folder} (no upstream match)`);
      missing.push(folder);
      continue;
    }

    const label = match.type === 'command' ? 'command' : `skill (${match.files.length} files)`;

    if (dryRun) {
      console.log(`  ✅ ${folder} → ${match.type}: ${match.basePath} [${label}]`);
      synced.push(folder);
      continue;
    }

    try {
      const fileCount = await syncSkill(folder, match);
      console.log(`  ✅ ${folder} → synced ${fileCount} file(s) [${label}]`);
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
  console.log(`  ⏭️  Skipped: ${skipped.length} (cowork-z originals)`);
  console.log(`  ❌ Missing: ${missing.length}`);
  if (errors.length > 0) {
    console.log(`  💥 Errors:  ${errors.length}`);
  }

  if (missing.length > 0) {
    console.log('\nMissing skills (no upstream match found):');
    for (const name of missing) {
      const extracted = extractPrefix(name);
      const guess = extracted
        ? `${CATEGORY_MAP[extracted.prefix] ?? extracted.prefix}/skills/${extracted.remaining}/`
        : `<unknown-category>/skills/${name}/`;
      console.log(`  - ${name}  (tried: ${guess})`);
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
