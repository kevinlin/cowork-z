import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { copilotDirectory, disconnectCopilot, listCopilotModels, startCopilotLogin } from '../src/copilot';
import { OpenCodeClient } from '../src/opencode-client';
import { getAppOpenCodeConfigDir } from '../src/paths';
import type { SidecarEvent } from '../src/types';

jest.mock('../src/logger', () => ({
  logger: { httpResponse: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const WS = '/Users/me/My Docs';
const LOCATION = 'location[directory]=%2FUsers%2Fme%2FMy%20Docs';

interface Call {
  method: string;
  path: string;
  search: string;
  body: any;
}

/** Every request the mocked server saw, as `METHOD path?search`. */
const calls: Call[] = [];
const tag = (call: Call) => `${call.method} ${call.path}${call.search}`;

type Responder = (call: Call) => unknown;

/** Route requests by `METHOD path` prefix. A responder returns the JSON body (or throws). 204s are modelled as `undefined`. */
function serve(routes: Record<string, Responder | unknown>) {
  mockFetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    if (!(key in routes)) {
      return { ok: false, status: 404, json: () => Promise.resolve({ _tag: 'NotFound', message: `no route ${key}` }) } as Response;
    }
    const route = routes[key];
    const result = typeof route === 'function' ? (route as Responder)(call) : route;
    if (result instanceof Error) throw result;
    if (result && typeof result === 'object' && 'httpStatus' in (result as object)) {
      const { httpStatus, body } = result as { httpStatus: number; body: unknown };
      return { ok: httpStatus < 300, status: httpStatus, json: () => Promise.resolve(body) } as Response;
    }
    if (result === undefined) {
      return { ok: true, status: 204, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) } as unknown as Response;
    }
    return { ok: true, status: 200, json: () => Promise.resolve(result) } as Response;
  });
}

const data = (value: unknown) => ({ location: { directory: WS }, data: value });

const copilotIntegration = (overrides: Record<string, unknown> = {}) => ({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  methods: [
    { id: 'env', type: 'env', label: 'GITHUB_TOKEN' },
    { id: 'device', type: 'oauth', label: 'Device code' },
  ],
  connections: [],
  ...overrides,
});

const ATTEMPT = {
  attemptID: 'att_1',
  url: 'https://github.com/login/device',
  instructions: 'Enter code: ABCD-1234',
  mode: 'auto',
  time: { created: 1, expires: 2 },
};
const ATTEMPT_PATH = '/api/integration/github-copilot/connect/oauth/att_1';

describe('copilot', () => {
  let client: OpenCodeClient;
  let events: SidecarEvent[];
  const emit = (event: SidecarEvent) => events.push(event);

  beforeEach(() => {
    client = new OpenCodeClient({ port: 4096 });
    mockFetch.mockReset();
    calls.length = 0;
    events = [];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('copilotDirectory', () => {
    it('uses the workspace directory when one is set', () => {
      expect(copilotDirectory('/ws')).toBe('/ws');
    });

    it('falls back to the sidecar app data dir, since Copilot OAuth can run before any task', () => {
      expect(copilotDirectory(undefined)).toBe(getAppOpenCodeConfigDir());
    });
  });

  describe('startCopilotLogin', () => {
    /** A fake clock: `sleep` advances `now`, so a 10-minute cap runs instantly. */
    function clock() {
      let time = 0;
      const sleeps: number[] = [];
      return {
        sleeps,
        now: () => time,
        sleep: async (ms: number) => {
          sleeps.push(ms);
          time += ms;
        },
      };
    }

    const login = async (options: { enterpriseUrl?: string; timeoutMs?: number } = {}, fake = clock()) => {
      const started = await startCopilotLogin(client, { directory: WS, emit, ...fake, ...options });
      return { ...started, fake };
    };

    it('lists the integrations first, then connects, both scoped to the directory', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      const { done } = await login();
      await done;

      expect(calls.map(tag).slice(0, 2)).toEqual([
        `GET /api/integration?${LOCATION}`,
        `POST /api/integration/github-copilot/connect/oauth?${LOCATION}`,
      ]);
    });

    it('asks for a github.com device login by default', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      await (await login()).done;

      expect(calls[1].body).toEqual({ methodID: 'device', answer: { deploymentType: 'github.com' } });
    });

    it('sends the enterprise deployment and its url when the command has an enterpriseUrl', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      await (await login({ enterpriseUrl: 'company.ghe.com' })).done;

      expect(calls[1].body).toEqual({ methodID: 'device', answer: { deploymentType: 'enterprise', enterpriseUrl: 'company.ghe.com' } });
    });

    it('emits copilot_oauth_result with url, instructions and the attempt mode as method', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      await login();

      expect(events[0]).toEqual({
        type: 'copilot_oauth_result',
        payload: { url: 'https://github.com/login/device', method: 'auto', instructions: 'Enter code: ABCD-1234' },
      });
      // The form strips this prefix to show just the code.
      expect((events[0] as any).payload.instructions.replace('Enter code: ', '')).toBe('ABCD-1234');
    });

    it('polls every 2 s until complete, then emits copilot_oauth_complete connected', async () => {
      const statuses = [{ status: 'pending' }, { status: 'pending' }, { status: 'complete' }];
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: () => data(statuses.shift()),
      });

      const { done, fake } = await login();
      await done;

      const polls = calls.filter((call) => call.path === ATTEMPT_PATH);
      expect(polls).toHaveLength(3);
      expect(polls.every((call) => call.search === `?${LOCATION}`)).toBe(true);
      expect(fake.sleeps).toEqual([2000, 2000, 2000]);
      expect(events.slice(1)).toEqual([{ type: 'copilot_oauth_complete', payload: { connected: true } }]);
    });

    it('does not call /complete for an auto attempt', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      await (await login()).done;

      expect(calls.some((call) => call.path.endsWith('/complete'))).toBe(false);
    });

    it('calls /complete once, before polling, when the attempt mode is code', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data({ ...ATTEMPT, mode: 'code' }),
        [`POST ${ATTEMPT_PATH}/complete`]: undefined,
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'complete' }),
      });

      await (await login()).done;

      expect(calls.map(tag).slice(2)).toEqual([`POST ${ATTEMPT_PATH}/complete?${LOCATION}`, `GET ${ATTEMPT_PATH}?${LOCATION}`]);
      expect((events[0] as any).payload.method).toBe('code');
      expect(events[1]).toEqual({ type: 'copilot_oauth_complete', payload: { connected: true } });
    });

    it('emits connected false with the server message when the attempt failed', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'failed', message: 'access_denied' }),
      });

      await (await login()).done;

      expect(events.slice(1)).toEqual([{ type: 'copilot_oauth_complete', payload: { connected: false, error: 'access_denied' } }]);
    });

    it('emits connected false with an error when the attempt expired', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'expired' }),
      });

      await (await login()).done;

      expect(events).toHaveLength(2);
      const complete = events[1] as any;
      expect(complete.type).toBe('copilot_oauth_complete');
      expect(complete.payload.connected).toBe(false);
      expect(complete.payload.error).toMatch(/expired/i);
    });

    it('gives up after 10 minutes with the error "timed out" that the form already understands', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: data({ status: 'pending' }),
      });

      const { done, fake } = await login();
      await done;

      expect(fake.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(10 * 60 * 1000);
      expect(fake.sleeps.every((ms) => ms === 2000)).toBe(true);
      expect(events.slice(1)).toEqual([{ type: 'copilot_oauth_complete', payload: { connected: false, error: 'timed out' } }]);
    });

    it('emits connected false when a poll request fails, and the done promise still resolves', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': data(ATTEMPT),
        [`GET ${ATTEMPT_PATH}`]: new TypeError('fetch failed'),
      });

      await expect((await login()).done).resolves.toBeUndefined();

      expect(events.slice(1)).toEqual([{ type: 'copilot_oauth_complete', payload: { connected: false, error: 'fetch failed' } }]);
    });

    it('rejects, without connecting, when the integration list has no github-copilot entry', async () => {
      serve({ 'GET /api/integration': data([{ id: 'anthropic', name: 'Anthropic', methods: [], connections: [] }]) });

      await expect(login()).rejects.toThrow(/Copilot/);

      expect(calls.map(tag)).toEqual([`GET /api/integration?${LOCATION}`]);
      expect(events).toEqual([]);
    });

    it('rejects, without connecting, when the device method is missing', async () => {
      serve({ 'GET /api/integration': data([copilotIntegration({ methods: [{ id: 'env', type: 'env', label: 'GITHUB_TOKEN' }] })]) });

      await expect(login()).rejects.toThrow(/device/);

      expect(calls.map(tag)).toEqual([`GET /api/integration?${LOCATION}`]);
    });

    it('rejects with the server error when connecting fails', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration()]),
        'POST /api/integration/github-copilot/connect/oauth': { httpStatus: 500, body: { message: 'OAuth method not found' } },
      });

      await expect(login()).rejects.toThrow('OAuth method not found');
    });
  });

  describe('listCopilotModels', () => {
    const model = (overrides: Record<string, unknown>) => ({
      id: 'x',
      modelID: 'm',
      providerID: 'github-copilot',
      name: 'M',
      enabled: true,
      status: 'active',
      ...overrides,
    });

    it('asks GET /api/model with location[directory]', async () => {
      serve({ 'GET /api/model': data([]) });

      await listCopilotModels(client, WS);

      expect(calls.map(tag)).toEqual([`GET /api/model?${LOCATION}`]);
    });

    it('keeps the enabled github-copilot models as {id: github-copilot/<modelID>, name}', async () => {
      serve({
        'GET /api/model': data([
          model({ modelID: 'claude-haiku-5.5', name: 'Claude Haiku 5.5' }),
          model({ modelID: 'gpt-5', name: 'GPT-5', enabled: false }),
          model({ modelID: 'claude-sonnet-5', providerID: 'anthropic', name: 'Claude Sonnet 5' }),
          model({ modelID: 'gemini-3', name: '' }),
        ]),
      });

      const result = await listCopilotModels(client, WS);

      expect(result).toEqual({
        success: true,
        models: [
          { id: 'github-copilot/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
          { id: 'github-copilot/gemini-3', name: 'gemini-3' },
        ],
      });
    });

    it('reports failure when no Copilot model is enabled', async () => {
      serve({ 'GET /api/model': data([model({ enabled: false }), model({ providerID: 'openai' })]) });

      await expect(listCopilotModels(client, WS)).resolves.toEqual({
        success: false,
        error: 'No Copilot provider found or no models available',
      });
    });
  });

  describe('disconnectCopilot (logout)', () => {
    const credential = (id: string) => ({ type: 'credential', id, label: `GitHub ${id}`, method: 'oauth' });

    it('deletes every connection id of the github-copilot integration, and never reads GET /api/credential', async () => {
      serve({
        'GET /api/integration': data([
          { id: 'anthropic', name: 'Anthropic', methods: [], connections: [credential('cred_other')] },
          copilotIntegration({ connections: [credential('cred_1'), credential('cred_2')] }),
        ]),
        'DELETE /api/credential/cred_1': undefined,
        'DELETE /api/credential/cred_2': undefined,
      });

      await disconnectCopilot(client, WS);

      expect(calls.map(tag)).toEqual([
        `GET /api/integration?${LOCATION}`,
        'DELETE /api/credential/cred_1',
        'DELETE /api/credential/cred_2',
      ]);
      expect(calls.some((call) => call.method === 'GET' && call.path === '/api/credential')).toBe(false);
    });

    it('skips env connections, which have a name but no credential id', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration({ connections: [{ type: 'env', name: 'GITHUB_TOKEN' }, credential('cred_1')] })]),
        'DELETE /api/credential/cred_1': undefined,
      });

      await disconnectCopilot(client, WS);

      expect(calls.map(tag)).toEqual([`GET /api/integration?${LOCATION}`, 'DELETE /api/credential/cred_1']);
    });

    it('does nothing when Copilot has no connections or is not listed', async () => {
      serve({ 'GET /api/integration': data([copilotIntegration()]) });
      await disconnectCopilot(client, WS);

      serve({ 'GET /api/integration': data([]) });
      await disconnectCopilot(client, WS);

      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    it('treats a connection that is already gone (404) as deleted', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration({ connections: [credential('cred_1'), credential('cred_2')] })]),
        'DELETE /api/credential/cred_1': { httpStatus: 404, body: { _tag: 'CredentialNotFoundError', message: 'gone' } },
        'DELETE /api/credential/cred_2': undefined,
      });

      await expect(disconnectCopilot(client, WS)).resolves.toBeUndefined();

      expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
    });

    it('still tries the remaining ids when one delete fails, then reports the failure', async () => {
      serve({
        'GET /api/integration': data([copilotIntegration({ connections: [credential('cred_1'), credential('cred_2')] })]),
        'DELETE /api/credential/cred_1': { httpStatus: 500, body: { message: 'database locked' } },
        'DELETE /api/credential/cred_2': undefined,
      });

      await expect(disconnectCopilot(client, WS)).rejects.toThrow(/cred_1.*database locked/);

      expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
    });
  });
});
