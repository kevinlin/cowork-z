import { type OpenCodeClient, OpenCodeHttpError } from './opencode-client';
import { getAppOpenCodeConfigDir } from './paths';
import type { CopilotModelsResultPayload, SidecarEvent } from './types';

/** v2 has a single provider for github.com and enterprise alike. */
export const COPILOT_INTEGRATION_ID = 'github-copilot';
const DEVICE_METHOD_ID = 'device';

const POLL_INTERVAL_MS = 2000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The location the Copilot routes run at: the workspace when one is set, otherwise the sidecar's own
 * app data dir (the server's cwd), because Copilot sign-in can happen before any task.
 */
export function copilotDirectory(currentDirectory?: string): string {
  return currentDirectory || getAppOpenCodeConfigDir();
}

export interface CopilotLoginOptions {
  directory: string;
  /** GitHub Enterprise host. Absent means github.com. */
  enterpriseUrl?: string;
  emit: (event: SidecarEvent) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Start a Copilot device login and report it as `copilot_oauth_result`, then watch the attempt until it
 * ends. Resolves once the user can be shown the code; `done` resolves when the attempt has ended and
 * `copilot_oauth_complete` was emitted. Never await `done` in a command handler: it takes minutes.
 * Rejects (and emits nothing) when the login cannot start.
 */
export async function startCopilotLogin(client: OpenCodeClient, options: CopilotLoginOptions): Promise<{ done: Promise<void> }> {
  const { directory, enterpriseUrl, emit } = options;

  // The server only knows a location's OAuth methods once that location's integrations were listed:
  // connecting first answers 500 "OAuth method not found".
  const integrations = await client.listIntegrations(directory);
  const copilot = integrations.find((integration) => integration.id === COPILOT_INTEGRATION_ID);
  if (!copilot) {
    throw new Error('GitHub Copilot is not available on this OpenCode server');
  }
  if (!copilot.methods.some((method) => method.id === DEVICE_METHOD_ID)) {
    throw new Error('GitHub Copilot has no "device" sign-in method on this OpenCode server');
  }

  const attempt = await client.startOAuth(
    COPILOT_INTEGRATION_ID,
    {
      methodID: DEVICE_METHOD_ID,
      answer: enterpriseUrl ? { deploymentType: 'enterprise', enterpriseUrl } : { deploymentType: 'github.com' },
    },
    directory
  );

  emit({ type: 'copilot_oauth_result', payload: { url: attempt.url, method: attempt.mode, instructions: attempt.instructions } });

  return { done: watchAttempt(client, attempt.attemptID, attempt.mode, options) };
}

/** Follow one attempt to its end. Resolves in every case; the outcome is the emitted `copilot_oauth_complete`. */
async function watchAttempt(client: OpenCodeClient, attemptID: string, mode: 'auto' | 'code', options: CopilotLoginOptions): Promise<void> {
  const { directory, emit } = options;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const finish = (connected: boolean, error?: string) =>
    emit({ type: 'copilot_oauth_complete', payload: error === undefined ? { connected } : { connected, error } });

  try {
    // With `auto` the server polls GitHub itself; only a `code` attempt needs to be completed from here.
    if (mode === 'code') {
      await client.completeOAuth(COPILOT_INTEGRATION_ID, attemptID, undefined, directory);
    }

    const startedAt = now();
    while (now() - startedAt < timeoutMs) {
      await sleep(pollIntervalMs);
      const attempt = await client.getOAuthAttempt(COPILOT_INTEGRATION_ID, attemptID, directory);
      if (attempt.status === 'complete') return finish(true);
      if (attempt.status === 'failed') return finish(false, attempt.message || 'GitHub Copilot sign-in failed');
      if (attempt.status === 'expired') return finish(false, 'The sign-in code expired. Please try again.');
    }
    // The sign-in form turns this exact text into "Authorization timed out. Please try again."
    finish(false, 'timed out');
  } catch (error) {
    finish(false, errorMessage(error));
  }
}

/** The enabled Copilot models in the app's `github-copilot/<modelID>` id form. */
export async function listCopilotModels(client: OpenCodeClient, directory: string): Promise<CopilotModelsResultPayload> {
  const models = (await client.listModels(directory))
    .filter((model) => model.providerID === COPILOT_INTEGRATION_ID && model.enabled)
    .map((model) => ({ id: `${COPILOT_INTEGRATION_ID}/${model.modelID}`, name: model.name || model.modelID }));

  if (models.length === 0) {
    return { success: false, error: 'No Copilot provider found or no models available' };
  }
  return { success: true, models };
}

/**
 * Sign out: delete every stored credential of the Copilot integration. The ids come from the integration
 * list (which carries no secrets); `GET /api/credential` would return every stored secret and is never
 * called. Env connections (e.g. `GITHUB_TOKEN`) have no credential id and cannot be deleted here.
 * Tries every id, then throws one error naming the ones that failed. A credential that is already gone is not a failure.
 */
export async function disconnectCopilot(client: OpenCodeClient, directory: string): Promise<void> {
  const integrations = await client.listIntegrations(directory);
  const copilot = integrations.find((integration) => integration.id === COPILOT_INTEGRATION_ID);
  const credentialIds = (copilot?.connections ?? []).flatMap((connection) =>
    'id' in connection && typeof connection.id === 'string' ? [connection.id] : []
  );

  const failures: string[] = [];
  for (const id of credentialIds) {
    try {
      await client.deleteCredential(id);
    } catch (error) {
      if (error instanceof OpenCodeHttpError && error.status === 404) continue;
      failures.push(`${id}: ${errorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}
