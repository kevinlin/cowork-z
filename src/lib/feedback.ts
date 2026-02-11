/**
 * Feedback utilities — constructs GitHub issue URLs with environment metadata.
 */

import { getArch, getPlatform, getVersion } from '@/lib/tauri-api';

const GITHUB_ISSUES_URL = 'https://github.com/kevinlin/cowork-z/issues/new';

export interface EnvironmentInfo {
  version: string;
  platform: string;
  arch: string;
}

export async function getEnvironmentInfo(): Promise<EnvironmentInfo> {
  const [version, platform, arch] = await Promise.all([
    getVersion().catch(() => 'unknown'),
    getPlatform().catch(() => 'unknown'),
    getArch().catch(() => 'unknown'),
  ]);
  return { version, platform, arch };
}

export function formatEnvironmentSection(env: EnvironmentInfo): string {
  return ['## Environment', '', `- **App Version:** ${env.version}`, `- **OS:** ${env.platform}`, `- **Architecture:** ${env.arch}`].join(
    '\n'
  );
}

export async function buildBugReportUrl(): Promise<string> {
  const env = await getEnvironmentInfo();
  const body = [
    '## Description',
    '',
    '<!-- A clear description of the bug -->',
    '',
    '## Steps to Reproduce',
    '',
    '1. ',
    '2. ',
    '3. ',
    '',
    '## Expected Behavior',
    '',
    '<!-- What should happen -->',
    '',
    '## Actual Behavior',
    '',
    '<!-- What actually happens -->',
    '',
    formatEnvironmentSection(env),
  ].join('\n');

  const params = new URLSearchParams({
    labels: 'bug',
    title: '[Bug]: ',
    body,
  });

  return `${GITHUB_ISSUES_URL}?${params.toString()}`;
}

export async function buildFeatureRequestUrl(): Promise<string> {
  const env = await getEnvironmentInfo();
  const body = [
    '## Description',
    '',
    '<!-- A clear description of the feature -->',
    '',
    '## Use Case',
    '',
    '<!-- Why is this feature needed? What problem does it solve? -->',
    '',
    '## Proposed Solution',
    '',
    '<!-- How should this work? -->',
    '',
    formatEnvironmentSection(env),
  ].join('\n');

  const params = new URLSearchParams({
    labels: 'enhancement',
    title: '[Feature]: ',
    body,
  });

  return `${GITHUB_ISSUES_URL}?${params.toString()}`;
}
