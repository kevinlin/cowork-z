import type { ApiKeys } from './types';

/**
 * Stable fingerprint of an ApiKeys payload so key additions/rotations after
 * sidecar initialization can be detected without ever logging the key
 * material. `undefined` and `{}` normalize to the same fingerprint, and
 * property order does not matter.
 */
export function fingerprintApiKeys(apiKeys?: ApiKeys): string {
  if (!apiKeys) return '[]';
  const { bedrock, ...stringKeys } = apiKeys;
  const entries: [string, string][] = Object.entries(stringKeys)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (bedrock) {
    entries.push(['bedrock', `${bedrock.accessKeyId}:${bedrock.secretAccessKey}:${bedrock.region}`]);
  }
  return JSON.stringify(entries);
}
