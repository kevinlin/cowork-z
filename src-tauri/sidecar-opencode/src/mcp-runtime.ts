import { toV2McpConfig } from './config-builder';
import { type OpenCodeClient, OpenCodeHttpError } from './opencode-client';
import type { McpConfig, McpServerState, McpStatusPayload } from './types';

/**
 * v2 status → the UI's `McpServerStatus` union (`src/shared/types/mcpSettings.ts`). The UI already knows
 * `connected`, `disabled`, `failed` and `needs_auth`, so those pass through unchanged. v2's `pending`
 * means "still connecting": the UI's `initializing` says that, while `connected` would claim a server
 * that may still fail. Anything else the server might add later is passed along as it came.
 */
const UI_STATUS: Record<string, string> = { pending: 'initializing' };

/** `GET /api/mcp` `data[]` → the `name → {status, error?}` record of the `mcp_status` event. */
export function toMcpStatusRecord(servers: McpServerState[]): McpStatusPayload['servers'] {
  const record: McpStatusPayload['servers'] = {};
  for (const { name, status } of servers) {
    record[name] = {
      status: UI_STATUS[status.status] ?? status.status,
      ...(status.error === undefined ? {} : { error: status.error }),
    };
  }
  return record;
}

/** Whether two app-shaped MCP configs are the same server as far as OpenCode is concerned. */
export function mcpConfigsEqual(a: McpConfig, b: McpConfig): boolean {
  return JSON.stringify(toV2McpConfig(a)) === JSON.stringify(toV2McpConfig(b));
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runtime MCP changes (`PUT`/`DELETE /api/experimental/mcp/{name}`) are scoped to one location, while
 * the servers a server process was spawned with reach every location. After a switch to another
 * workspace, bring that location in line with the app's current set:
 *
 * - put every applied server whose config differs from the spawn-time one (changed, or added since);
 * - delete every spawn-time server that has been removed since.
 *
 * Servers that equal their spawn-time config are already there and are left alone (a put reconnects).
 * Returns one `name: message` entry per failure; a delete that finds nothing to delete is not one.
 */
export async function reapplyMcpServers(
  client: Pick<OpenCodeClient, 'putMcpServer' | 'removeMcpServer'>,
  directory: string,
  applied: Record<string, McpConfig>,
  spawned: Record<string, McpConfig>
): Promise<string[]> {
  const jobs: Array<{ name: string; run: () => Promise<void> }> = [];

  for (const [name, config] of Object.entries(applied)) {
    const base = spawned[name];
    if (base && mcpConfigsEqual(base, config)) continue;
    jobs.push({ name, run: () => client.putMcpServer(name, toV2McpConfig(config), directory) });
  }

  for (const name of Object.keys(spawned)) {
    if (name in applied) continue;
    jobs.push({
      name,
      run: async () => {
        try {
          await client.removeMcpServer(name, directory);
        } catch (error) {
          if (!(error instanceof OpenCodeHttpError && error.status === 404)) throw error;
        }
      },
    });
  }

  // In parallel: each put waits for its server to connect, and a slow one must not hold up the rest.
  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  return results.flatMap((result, index) => (result.status === 'rejected' ? [`${jobs[index].name}: ${errorMessage(result.reason)}`] : []));
}
