import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OpenCodeClient } from '../src/opencode-client.js';

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger.js', () => ({
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

  describe('isServerRunning', () => {
    it('should return true when server is running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ healthy: true, version: '1.0.0' }),
      } as Response);

      const result = await client.isServerRunning();

      expect(result).toBe(true);
    });

    it('should return false when server is not running', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.isServerRunning();

      expect(result).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return config without directory param', async () => {
      const config = { model: 'claude-3-opus' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config),
      } as Response);

      const result = await client.getConfig();

      expect(result).toEqual(config);
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4096/config', expect.objectContaining({ method: 'GET' }));
    });

    it('should include directory query param when provided', async () => {
      const config = { model: 'claude-3-opus' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config),
      } as Response);

      await client.getConfig('/path/to/project');

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4096/config?directory=%2Fpath%2Fto%2Fproject', expect.anything());
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

  describe('createSession', () => {
    it('should create a session', async () => {
      const session = {
        id: 'ses_123',
        slug: 'my-session',
        projectID: 'proj_123',
        directory: '/project',
        title: 'Test Session',
        version: '1',
        time: { created: Date.now(), updated: Date.now() },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(session),
      } as Response);

      const result = await client.createSession({ title: 'Test Session' });

      expect(result).toEqual(session);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/session',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test Session'),
        })
      );
    });
  });

  describe('abortSession', () => {
    it('should abort a session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(true),
      } as Response);

      const result = await client.abortSession('ses_123');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4096/session/ses_123/abort', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('sendMessage', () => {
    it('should send a message to a session', async () => {
      const response = {
        info: { id: 'msg_123', role: 'assistant' },
        parts: [{ type: 'text', text: 'Hello!' }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      } as Response);

      const result = await client.sendMessage('ses_123', {
        parts: [{ type: 'text', text: 'Hello' }],
        agent: 'accomplish',
      });

      expect(result).toEqual(response);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/session/ses_123/message',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('accomplish'),
        })
      );
    });
  });

  describe('replyToPermission', () => {
    it('should reply to a permission request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(true),
      } as Response);

      const result = await client.replyToPermission('per_123', 'once');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/permission/per_123/reply',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reply: 'once', message: undefined }),
        })
      );
    });
  });

  describe('replyToQuestion', () => {
    it('should reply to a question request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(true),
      } as Response);

      const answers = [{ labels: ['Option A'], customText: 'Additional info' }];
      const result = await client.replyToQuestion('que_123', answers);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:4096/question/que_123/reply',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ answers }),
        })
      );
    });
  });
});
