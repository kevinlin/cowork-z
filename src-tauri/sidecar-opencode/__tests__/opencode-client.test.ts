import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '../src/logger';
import { OpenCodeClient, OpenCodeHttpError, OpenCodeRouteNotFoundError, serializeQuery } from '../src/opencode-client';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    httpResponse: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('OpenCodeClient', () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient({ port: 4096 });
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default port 4096', () => {
      const defaultClient = new OpenCodeClient();
      // We can test this indirectly by checking the URL in requests
      expect(defaultClient).toBeInstanceOf(OpenCodeClient);
    });

    it('should accept custom port', () => {
      const customClient = new OpenCodeClient({ port: 5000 });
      expect(customClient).toBeInstanceOf(OpenCodeClient);
    });

    it('should accept custom baseUrl', () => {
      const customClient = new OpenCodeClient({ baseUrl: 'http://localhost:8080' });
      expect(customClient).toBeInstanceOf(OpenCodeClient);
    });
  });

  describe('health', () => {
    it('should return health response on success', async () => {
      const healthResponse = { healthy: true, version: '1.0.0' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(healthResponse),
      } as Response);

      const result = await client.health();

      expect(result).toEqual(healthResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/global/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      } as Response);

      await expect(client.health()).rejects.toThrow('HTTP 500');
    });
  });

  describe('HTML 200 guard', () => {
    const htmlHeaders = { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) };

    it('should reject with OpenCodeRouteNotFoundError when a 2xx response is text/html', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: htmlHeaders,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      } as unknown as Response);

      const result = client.health();

      await expect(result).rejects.toBeInstanceOf(OpenCodeRouteNotFoundError);
      await expect(result).rejects.toMatchObject({
        name: 'OpenCodeRouteNotFoundError',
        message: 'OpenCode route not found: GET /global/health (unsupported OpenCode version?)',
      });
      expect(logger.httpResponse).toHaveBeenCalledWith('GET', '/global/health', 200);
    });

    it('should still resolve a JSON response that has no headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ healthy: true, version: '1.0.0' }),
      } as Response);

      await expect(client.health()).resolves.toEqual({ healthy: true, version: '1.0.0' });
    });

    it('should resolve null for an empty non-HTML body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      } as unknown as Response);

      await expect(client.disconnectMcpServer('github')).resolves.toBeNull();
    });
  });

  describe('info', () => {
    it('should GET /api/info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ version: '2.2.0' }),
      } as Response);

      const result = await client.info();

      expect(result).toEqual({ version: '2.2.0' });
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4096/api/info', expect.objectContaining({ method: 'GET' }));
    });
  });

  describe('isServerRunning', () => {
    it('should return true when /api/info answers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ version: '2.2.0', pid: 1, urls: [], paths: { tmp: '/tmp' } }),
      } as Response);

      const result = await client.isServerRunning();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4096/api/info', expect.objectContaining({ method: 'GET' }));
    });

    it('should return false when server is not running', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.isServerRunning();

      expect(result).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('should send PATCH request with config body', async () => {
      const newConfig = { model: 'claude-3-sonnet' };
      const returnedConfig = { ...newConfig, default_agent: 'accomplish' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(returnedConfig),
      } as Response);

      const result = await client.updateConfig(newConfig);

      expect(result).toEqual(returnedConfig);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/config',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newConfig),
        })
      );
    });
  });

  describe('serializeQuery (deepObject)', () => {
    it('writes object parameters as key[child]=value with literal brackets', () => {
      expect(serializeQuery({ location: { directory: '/tmp/ws' } })).toBe('location[directory]=%2Ftmp%2Fws');
    });

    it('percent-encodes values with %20 for spaces and keeps flat parameters', () => {
      expect(serializeQuery({ message: 'no way', location: { directory: '/My Docs/a&b' } })).toBe(
        'message=no%20way&location[directory]=%2FMy%20Docs%2Fa%26b'
      );
    });

    it('skips undefined and null values at both levels', () => {
      expect(serializeQuery({ a: undefined, b: null, location: { directory: undefined }, order: 'desc' })).toBe('order=desc');
    });

    it('returns an empty string when there is nothing to write', () => {
      expect(serializeQuery({})).toBe('');
      expect(serializeQuery({ location: {} })).toBe('');
    });
  });

  describe('request() options', () => {
    const okJson = (body: unknown = {}) => ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as Response;
    const privateRequest = (c: OpenCodeClient, ...args: unknown[]) =>
      (c as unknown as { request: (...a: unknown[]) => Promise<unknown> }).request(...args);

    it('logs the response body by default', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ value: 1 }));

      await privateRequest(client, 'GET', '/api/x');

      expect(logger.httpResponse).toHaveBeenCalledWith('GET', '/api/x', 200, { value: 1 });
    });

    it('never passes the body to the logger when logBody is false', async () => {
      mockFetch.mockResolvedValueOnce(okJson({ key: 'sk-secret' }));

      const result = await privateRequest(client, 'GET', '/api/x', undefined, undefined, { logBody: false });

      expect(result).toEqual({ key: 'sk-secret' });
      expect(logger.httpResponse).toHaveBeenCalledWith('GET', '/api/x', 200);
    });

    it('does not log an error body when logBody is false', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ key: 'sk-secret' }) } as Response);

      await expect(privateRequest(client, 'GET', '/api/x', undefined, undefined, { logBody: false })).rejects.toBeInstanceOf(
        OpenCodeHttpError
      );
      expect(logger.httpResponse).toHaveBeenCalledWith('GET', '/api/x', 500);
    });
  });

  describe('OpenCodeHttpError', () => {
    it('carries the HTTP status and parsed body of a non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ _tag: 'SessionNotFoundError', sessionID: 'ses_1', message: 'nope' }),
      } as Response);

      const error = await client.getSession('ses_1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OpenCodeHttpError);
      expect(error).toMatchObject({
        name: 'OpenCodeHttpError',
        status: 404,
        body: { _tag: 'SessionNotFoundError', sessionID: 'ses_1', message: 'nope' },
      });
      expect((error as Error).message).toContain('HTTP 404');
    });

    it('is not used for transport failures', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const error = await client.getSession('ses_1').catch((e: unknown) => e);

      expect(error).not.toBeInstanceOf(OpenCodeHttpError);
    });
  });

  describe('sessions', () => {
    const session = {
      id: 'ses_123',
      projectID: 'proj_1',
      location: { directory: '/ws' },
      time: { created: 1, updated: 2 },
    };
    const okData = (data: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve({ data }) }) as unknown as Response;
    const noContent = () =>
      ({ ok: true, status: 204, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }) as unknown as Response;
    const lastCall = () => {
      const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      return { url: call[0] as string, init: call[1] as RequestInit };
    };

    it('createSession POSTs only location, model and permissions to /api/session and unwraps {data}', async () => {
      mockFetch.mockResolvedValueOnce(okData(session));
      const permissions = [{ action: 'external_directory', resource: '*', effect: 'ask' as const }];

      const result = await client.createSession({
        directory: '/ws',
        model: { providerID: 'github-copilot', id: 'claude-haiku-5.5' },
        permissions,
      });

      expect(result).toEqual(session);
      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        location: { directory: '/ws' },
        model: { providerID: 'github-copilot', id: 'claude-haiku-5.5' },
        permissions,
      });
    });

    it('createSession omits location and model when they are not given', async () => {
      mockFetch.mockResolvedValueOnce(okData(session));

      await client.createSession({ permissions: [] });

      expect(JSON.parse(lastCall().init.body as string)).toEqual({ permissions: [] });
    });

    it('getSession GETs /api/session/{id} and unwraps {data}', async () => {
      mockFetch.mockResolvedValueOnce(okData(session));

      await expect(client.getSession('ses_123')).resolves.toEqual(session);

      expect(lastCall().url).toBe('http://127.0.0.1:4096/api/session/ses_123');
      expect(lastCall().init.method).toBe('GET');
    });

    it('updateSession PATCHes {permissions} and accepts a 204', async () => {
      mockFetch.mockResolvedValueOnce(noContent());
      const permissions = [{ action: 'edit', resource: 'Input/*', effect: 'deny' as const }];

      await client.updateSession('ses_123', { permissions });

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ permissions });
    });

    it('prompt POSTs only {text} to /api/session/{id}/prompt and unwraps {data}', async () => {
      const inbox = { id: 'msg_1', type: 'user' };
      mockFetch.mockResolvedValueOnce(okData(inbox));

      await expect(client.prompt('ses_123', 'Hello')).resolves.toEqual(inbox);

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123/prompt');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ text: 'Hello' });
    });

    it('prompt does not disable the request timeout', async () => {
      mockFetch.mockResolvedValueOnce(okData({}));

      await client.prompt('ses_123', 'Hello');

      expect((lastCall().init as RequestInit).signal).toBeDefined();
    });

    it('switchModel POSTs {model} to /api/session/{id}/model', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.switchModel('ses_123', { providerID: 'openrouter', id: 'minimax/minimax-m2.5' });

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123/model');
      expect(JSON.parse(init.body as string)).toEqual({ model: { providerID: 'openrouter', id: 'minimax/minimax-m2.5' } });
    });

    it('putInstructions PUTs {value} to the experimental instructions entry', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.putInstructions('ses_123', 'cowork-z', 'the prompt');

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/experimental/session/ses_123/instructions/entries/cowork-z');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ value: 'the prompt' });
    });

    it('interrupt POSTs to /api/session/{id}/interrupt and returns the flag', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ interrupted: true }) } as unknown as Response);

      await expect(client.interrupt('ses_123')).resolves.toEqual({ interrupted: true });

      expect(lastCall().url).toBe('http://127.0.0.1:4096/api/session/ses_123/interrupt');
      expect(lastCall().init.method).toBe('POST');
    });

    it('listSessionPermissions and listSessionForms unwrap {data}', async () => {
      mockFetch.mockResolvedValueOnce(okData([{ id: 'per_1' }]));
      await expect(client.listSessionPermissions('ses_123')).resolves.toEqual([{ id: 'per_1' }]);
      expect(lastCall().url).toBe('http://127.0.0.1:4096/api/session/ses_123/permission');

      mockFetch.mockResolvedValueOnce(okData([{ id: 'frm_1' }]));
      await expect(client.listSessionForms('ses_123')).resolves.toEqual([{ id: 'frm_1' }]);
      expect(lastCall().url).toBe('http://127.0.0.1:4096/api/session/ses_123/form');
    });

    it('replyPermission POSTs {decision, message} to the session permission reply route', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.replyPermission('ses_123', 'per_1', 'reject', 'no thanks');

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123/permission/per_1/reply');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ decision: 'reject', message: 'no thanks' });
    });

    it('replyForm POSTs {answer} to the session form reply route', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.replyForm('ses_123', 'frm_1', { q0: 'red' });

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123/form/frm_1/reply');
      expect(JSON.parse(init.body as string)).toEqual({ answer: { q0: 'red' } });
    });

    it('cancelForm DELETEs the form with the message as a query parameter', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.cancelForm('ses_123', 'frm_1', 'Unsupported field type: external');

      const { url, init } = lastCall();
      expect(url).toBe('http://127.0.0.1:4096/api/session/ses_123/form/frm_1?message=Unsupported%20field%20type%3A%20external');
      expect(init.method).toBe('DELETE');
    });

    it('getSessionMessages GETs the history newest first and unwraps {data}', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ id: 'msg_1' }], cursor: {} }),
      } as unknown as Response);

      await expect(client.getSessionMessages('ses_123')).resolves.toEqual([{ id: 'msg_1' }]);

      expect(lastCall().url).toBe('http://127.0.0.1:4096/api/session/ses_123/message?order=desc');
    });
  });

  describe('MCP runtime routes', () => {
    const noContent = () =>
      ({ ok: true, status: 204, json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')) }) as unknown as Response;

    it('putMcpServer PUTs {config} with the location[directory] deepObject query', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.putMcpServer('my server', { type: 'local', command: ['npx', 'x'], disabled: true }, '/Users/me/My Docs');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:4096/api/experimental/mcp/my%20server?location[directory]=%2FUsers%2Fme%2FMy%20Docs');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ config: { type: 'local', command: ['npx', 'x'], disabled: true } });
    });

    it('removeMcpServer DELETEs on the same route', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.removeMcpServer('github', '/ws');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:4096/api/experimental/mcp/github?location[directory]=%2Fws');
      expect(init.method).toBe('DELETE');
    });

    it('omits the location query when no directory is known', async () => {
      mockFetch.mockResolvedValueOnce(noContent());

      await client.removeMcpServer('github');

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toBe('http://127.0.0.1:4096/api/experimental/mcp/github');
    });
  });

  describe('HTTP basic auth', () => {
    it('should not send Authorization header when no password is set', async () => {
      const noAuthClient = new OpenCodeClient({ port: 4096 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ healthy: true, version: '1.0.0' }),
      } as Response);

      await noAuthClient.health();

      const callArgs = mockFetch.mock.calls[0];
      const fetchOptions = callArgs[1] as RequestInit;
      // No headers should be set for GET without auth
      expect(fetchOptions.headers).toBeUndefined();
    });

    it('should send Authorization header on GET requests when password is set', async () => {
      const authClient = new OpenCodeClient({ port: 4096, password: 'test-secret' });
      const expectedAuth = `Basic ${Buffer.from('opencode:test-secret').toString('base64')}`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ healthy: true, version: '1.0.0' }),
      } as Response);

      await authClient.health();

      const callArgs = mockFetch.mock.calls[0];
      const fetchOptions = callArgs[1] as RequestInit;
      expect(fetchOptions.headers).toEqual({ Authorization: expectedAuth });
    });

    it('should send both Authorization and Content-Type headers on POST requests when password is set', async () => {
      const authClient = new OpenCodeClient({ port: 4096, password: 'test-secret' });
      const expectedAuth = `Basic ${Buffer.from('opencode:test-secret').toString('base64')}`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await authClient.updateConfig({ model: 'test-model' });

      const callArgs = mockFetch.mock.calls[0];
      const fetchOptions = callArgs[1] as RequestInit;
      expect(fetchOptions.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: expectedAuth,
      });
    });
  });
});
