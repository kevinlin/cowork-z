import { createHash } from 'node:crypto';
import type { ApiKeys } from './types';

/**
 * Stable SHA-256 fingerprint of an ApiKeys payload so key additions/rotations
 * after sidecar initialization can be detected. The digest contains no key
 * material, so the fingerprint is safe to hold in memory or log.
 * `undefined` and `{}` normalize to the same fingerprint, and property order
 * does not matter.
 */
export function fingerprintApiKeys(apiKeys?: ApiKeys): string {
  const entries: [string, string][] = [];
  if (apiKeys) {
    const { bedrock, ...stringKeys } = apiKeys;
    entries.push(
      ...Object.entries(stringKeys)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
    );
    if (bedrock) {
      entries.push(['bedrock', `${bedrock.accessKeyId}:${bedrock.secretAccessKey}:${bedrock.region}`]);
    }
  }
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
