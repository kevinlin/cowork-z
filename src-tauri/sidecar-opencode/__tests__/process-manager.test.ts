import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

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

// Mock fs module
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  readdirSync: jest.fn(() => []),
}));

// Mock child_process module
const mockExecFileSync = jest.fn();
const mockSpawn = jest.fn(() => ({
  stdout: { on: jest.fn() },
  stderr: { on: jest.fn() },
  on: jest.fn(),
  kill: jest.fn(),
  killed: false,
}));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

// Mock net module for port allocation
jest.mock('node:net', () => ({
  createServer: jest.fn(() => ({
    listen: jest.fn((port: number, host: string, callback: () => void) => {
      setTimeout(() => callback(), 0);
    }),
    address: jest.fn(() => ({ port: 12_345 })),
    close: jest.fn((callback: () => void) => {
      setTimeout(() => callback(), 0);
    }),
    on: jest.fn(),
  })),
}));

// Mock OpenCodeClient
jest.mock('../src/opencode-client', () => ({
  ...jest.requireActual('../src/opencode-client'),
  OpenCodeClient: jest.fn().mockImplementation(() => ({
    info: jest.fn().mockResolvedValue({ version: '2.2.0' }),
  })),
}));

// Store original values
const originalPlatform = process.platform;
const originalEnv = process.env;

describe('getSafeUnixLoginShell and login-shell PATH behavior', () => {
  beforeEach(() => {
    // Reset mocks
    mockExistsSync.mockReset();
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();

    // Clear module cache to ensure fresh imports
    jest.resetModules();

    // Restore environment
    process.env = { ...originalEnv };

    // Mock platform as Unix-like
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Default mocks
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockReturnValue(undefined);
    mockMkdirSync.mockReturnValue(undefined);
    mockSpawn.mockReturnValue({
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
      killed: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();

    // Restore platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });

    // Restore environment
    process.env = originalEnv;
  });

  describe('getSafeUnixLoginShell', () => {
    it('should return $SHELL when it is in the allowlist and exists', async () => {
      process.env.SHELL = '/bin/zsh';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      // Trigger getAugmentedPath by starting server
      await pm.ensureServerRunning();

      // Verify execFileSync was called with the correct shell
      expect(mockExecFileSync).toHaveBeenCalledWith(
        '/bin/zsh',
        ['-ilc', 'echo $PATH'],
        expect.objectContaining({
          timeout: 5000,
          encoding: 'utf-8',
        })
      );

      // Verify spawn was called with augmented PATH
      expect(mockSpawn).toHaveBeenCalledWith(
        'opencode',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: expect.any(String),
          }),
        })
      );
    });

    it('should ignore untrusted $SHELL values not in the allowlist', async () => {
      process.env.SHELL = '/tmp/evil-shell';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockImplementation((path) => {
        // /tmp/evil-shell exists, but /bin/bash also exists (fallback)
        if (path === '/tmp/evil-shell') return true;
        if (path === '/bin/bash') return true;
        return false;
      });
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      // Should fall back to /bin/bash, not use the untrusted $SHELL
      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));

      // Should NOT be called with the untrusted shell
      expect(mockExecFileSync).not.toHaveBeenCalledWith('/tmp/evil-shell', expect.any(Array), expect.any(Object));
    });

    it('should fall back to first existing allowlisted shell when $SHELL is not set', async () => {
      delete process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockImplementation((path) => {
        // Only /usr/bin/bash exists
        return path === '/usr/bin/bash';
      });
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith('/usr/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));
    });

    it('should fall back to first existing allowlisted shell when $SHELL does not exist', async () => {
      process.env.SHELL = '/bin/zsh';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockImplementation((path) => {
        // /bin/zsh doesn't exist, but /bin/bash does
        if (path === '/bin/zsh') return false;
        if (path === '/bin/bash') return true;
        return false;
      });
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));
    });

    it('should handle fs.existsSync errors gracefully and continue to fallback', async () => {
      process.env.SHELL = '/bin/zsh';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockImplementation((path) => {
        // Throw error for /bin/zsh, but /bin/bash exists
        if (path === '/bin/zsh') throw new Error('Permission denied');
        if (path === '/bin/bash') return true;
        return false;
      });
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      // Should fall back to /bin/bash despite the error
      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));
    });

    it('should return undefined when no allowlisted shell exists', async () => {
      delete process.env.SHELL;
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(false);
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      // execFileSync should not be called when no shell is found
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  describe('shell argument selection', () => {
    it('should use -ilc arguments for bash', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));
    });

    it('should use -ilc arguments for zsh', async () => {
      process.env.SHELL = '/bin/zsh';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'echo $PATH'], expect.any(Object));
    });

    it('should use -ilc arguments for /bin/sh', async () => {
      process.env.SHELL = '/bin/sh';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/sh', ['-ilc', 'echo $PATH'], expect.any(Object));
    });
  });

  describe('login-shell PATH merge behavior', () => {
    it('should merge login-shell PATH with current PATH', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalled();
      // Verify it was called with proper args
      expect(mockExecFileSync).toHaveBeenCalledWith(
        '/bin/bash',
        ['-ilc', 'echo $PATH'],
        expect.objectContaining({
          timeout: 5000,
          encoding: 'utf-8',
        })
      );
    });

    it('should deduplicate directories when merging PATH', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin:/bin:/usr/local/bin';
      mockExistsSync.mockReturnValue(true);
      // Shell returns PATH that has some overlap with current PATH
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/opt/homebrew/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalled();
    });

    it('should handle empty PATH from shell gracefully', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalled();
    });

    it('should handle execFileSync timeout gracefully', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Command timed out');
      });

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalled();
    });

    it('should not attempt shell PATH on Windows', async () => {
      // Mock Windows platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });

      process.env.SHELL = '/bin/bash';
      process.env.PATH = 'C:\\Windows\\System32;C:\\Windows';
      mockExistsSync.mockReturnValue(true);

      const { ProcessManager, _resetExcludedRangesCache } = await import('../src/process-manager');
      _resetExcludedRangesCache();
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      // Should NOT call execFileSync with a login shell on Windows.
      // It IS expected to call execFileSync with 'netsh' for excluded port range detection.
      const shellCalls = mockExecFileSync.mock.calls.filter((call: unknown[]) => call[0] !== 'netsh');
      expect(shellCalls).toHaveLength(0);
    });
  });

  describe('security: allowlist enforcement', () => {
    const untrustedShells = ['/tmp/malicious', '/home/user/evil-shell', '../../../bin/bash', 'bash', './shell', '/opt/custom/shell'];

    it.each(untrustedShells)('should reject untrusted shell: %s', async (untrustedShell) => {
      process.env.SHELL = untrustedShell;
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockImplementation((path) => {
        // Both untrusted shell and fallback exist
        if (path === untrustedShell) return true;
        if (path === '/bin/bash') return true;
        return false;
      });
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      // Should fall back to /bin/bash
      expect(mockExecFileSync).toHaveBeenCalledWith('/bin/bash', ['-ilc', 'echo $PATH'], expect.any(Object));

      // Should NOT use the untrusted shell
      expect(mockExecFileSync).not.toHaveBeenCalledWith(untrustedShell, expect.any(Array), expect.any(Object));
    });

    const allowedShells = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash', '/usr/bin/sh', '/opt/homebrew/bin/bash'];

    it.each(allowedShells)('should accept allowlisted shell: %s', async (allowedShell) => {
      process.env.SHELL = allowedShell;
      process.env.PATH = '/usr/bin:/bin';
      mockExistsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin:/usr/bin:/bin'));

      const { ProcessManager } = await import('../src/process-manager');
      const pm = new ProcessManager({ cliPath: 'opencode', password: 'test' });

      await pm.ensureServerRunning();

      expect(mockExecFileSync).toHaveBeenCalledWith(allowedShell, ['-ilc', 'echo $PATH'], expect.any(Object));
    });
  });
});

describe('applyApiKeyEnv — server spawn env mapping (2026-06-12 review #22)', () => {
  it('maps every ApiKeys field to its environment variable, including ollama', async () => {
    const { applyApiKeyEnv } = await import('../src/process-manager');
    const env: NodeJS.ProcessEnv = {};

    applyApiKeyEnv(env, {
      anthropic: 'sk-ant-1',
      openai: 'sk-oai-1',
      google: 'g-key',
      xai: 'xai-key',
      deepseek: 'ds-key',
      openrouter: 'or-key',
      litellm: 'll-key',
      ollama: 'ollama-key',
      azureFoundry: 'az-key',
      bedrock: { accessKeyId: 'AKIA1', secretAccessKey: 'aws-secret', region: 'us-east-1' },
    });

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-1');
    expect(env.OPENAI_API_KEY).toBe('sk-oai-1');
    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('g-key');
    expect(env.XAI_API_KEY).toBe('xai-key');
    expect(env.DEEPSEEK_API_KEY).toBe('ds-key');
    expect(env.OPENROUTER_API_KEY).toBe('or-key');
    expect(env.LITELLM_API_KEY).toBe('ll-key');
    expect(env.OLLAMA_API_KEY).toBe('ollama-key');
    expect(env.AZURE_API_KEY).toBe('az-key');
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIA1');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('aws-secret');
    expect(env.AWS_REGION).toBe('us-east-1');
  });

  it('sets nothing when keys are absent', async () => {
    const { applyApiKeyEnv } = await import('../src/process-manager');
    const env: NodeJS.ProcessEnv = {};

    applyApiKeyEnv(env, undefined);
    applyApiKeyEnv(env, {});

    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe('OpenCode 2.x requirement', () => {
  const V2_REQUIRED_MESSAGE = 'Cowork-Z needs OpenCode 2.x. Run: npm uninstall -g opencode-ai && npm install -g @opencode/cli';

  const loadModules = async () => {
    jest.resetModules();
    const processManager = await import('../src/process-manager');
    const openCodeClient = await import('../src/opencode-client');
    const { logger } = await import('../src/logger');
    return {
      ...processManager,
      logger: logger as unknown as Record<'info' | 'debug' | 'warn' | 'error', jest.Mock>,
      OpenCodeClient: openCodeClient.OpenCodeClient as unknown as jest.Mock,
      OpenCodeRouteNotFoundError: openCodeClient.OpenCodeRouteNotFoundError,
      OpenCodeHttpError: openCodeClient.OpenCodeHttpError,
    };
  };

  describe('detectLegacyOpenCodeVersion', () => {
    it('returns the version when /global/health answers with JSON (an OpenCode 1.x server)', async () => {
      const { detectLegacyOpenCodeVersion } = await loadModules();
      const client = { health: jest.fn<() => Promise<{ version?: string } | null>>().mockResolvedValue({ version: '1.19.4' }) };

      await expect(detectLegacyOpenCodeVersion(client)).resolves.toBe('1.19.4');
    });

    it('still flags a JSON health answer that carries no version', async () => {
      const { detectLegacyOpenCodeVersion } = await loadModules();
      const client = { health: jest.fn<() => Promise<{ version?: string } | null>>().mockResolvedValue({}) };

      await expect(detectLegacyOpenCodeVersion(client)).resolves.toBe('unknown');
    });

    it('returns undefined when /global/health resolves null', async () => {
      const { detectLegacyOpenCodeVersion } = await loadModules();
      const client = { health: jest.fn<() => Promise<{ version?: string } | null>>().mockResolvedValue(null) };

      await expect(detectLegacyOpenCodeVersion(client)).resolves.toBeUndefined();
    });

    it.each([
      [
        'an HTML route-not-found response',
        (m: Awaited<ReturnType<typeof loadModules>>) => new m.OpenCodeRouteNotFoundError('route not found'),
      ],
      ['an HTTP 404', (m: Awaited<ReturnType<typeof loadModules>>) => new m.OpenCodeHttpError(404, { error: 'not found' })],
      ['an HTTP 401', (m: Awaited<ReturnType<typeof loadModules>>) => new m.OpenCodeHttpError(401, { error: 'unauthorized' })],
      ['a refused connection', () => new TypeError('fetch failed')],
    ])('returns undefined when the probe fails with %s', async (_label, makeError) => {
      const modules = await loadModules();
      const client = { health: jest.fn<() => Promise<{ version?: string } | null>>().mockRejectedValue(makeError(modules)) };

      await expect(modules.detectLegacyOpenCodeVersion(client)).resolves.toBeUndefined();
    });
  });

  describe('server startup', () => {
    const info = jest.fn<() => Promise<{ version?: string } | null>>();
    const health = jest.fn<() => Promise<{ version?: string } | null>>();
    let child: {
      stdout: { on: jest.Mock };
      stderr: { on: jest.Mock };
      on: jest.Mock;
      once: jest.Mock;
      kill: jest.Mock;
      killed: boolean;
    };

    // Start a ProcessManager against a scripted client; the spawned child never exits unless a test says so.
    const createManager = async () => {
      const modules = await loadModules();
      modules.OpenCodeClient.mockImplementation(() => ({ info, health }));
      const sleep = jest
        .spyOn(modules.ProcessManager.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
        .mockResolvedValue(undefined);
      const pm = new modules.ProcessManager({ cliPath: 'opencode', password: 'test' });
      return { ...modules, pm, sleep };
    };

    const spawnedEnv = (): NodeJS.ProcessEnv =>
      (mockSpawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env;

    beforeEach(() => {
      info.mockReset();
      health.mockReset();
      mockExistsSync.mockReset();
      mockExecFileSync.mockReset();
      mockSpawn.mockReset();
      mockReadFileSync.mockReset();
      mockWriteFileSync.mockReset();
      mockMkdirSync.mockReset();
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue('{}');
      child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn(), once: jest.fn(), kill: jest.fn(), killed: false };
      mockSpawn.mockReturnValue(child);
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true, configurable: true });
    });

    it('becomes ready on /api/info and logs the server version', async () => {
      const { pm, logger } = await createManager();
      info.mockResolvedValue({ version: '2.2.0' });

      await pm.ensureServerRunning();

      expect(info).toHaveBeenCalledTimes(1);
      expect(health).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('2.2.0'));
    });

    it('keeps polling through refused connections without probing for a 1.x server', async () => {
      const { pm, sleep } = await createManager();
      info
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue({ version: '2.2.0' });

      await pm.ensureServerRunning();

      expect(info).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(health).not.toHaveBeenCalled();
    });

    it('fails on the first poll with UnsupportedOpenCodeVersionError when /api/info is HTML but /global/health is JSON (1.x)', async () => {
      const { pm, sleep, OpenCodeRouteNotFoundError, UnsupportedOpenCodeVersionError } = await createManager();
      info.mockRejectedValue(new OpenCodeRouteNotFoundError('OpenCode route not found: GET /api/info (unsupported OpenCode version?)'));
      health.mockResolvedValue({ version: '1.19.4' });

      const result = pm.ensureServerRunning();

      await expect(result).rejects.toBeInstanceOf(UnsupportedOpenCodeVersionError);
      await expect(result).rejects.toMatchObject({ name: 'UnsupportedOpenCodeVersionError', message: V2_REQUIRED_MESSAGE });
      expect(info).toHaveBeenCalledTimes(1);
      expect(health).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('treats an HTTP 404 on /api/info the same way', async () => {
      const { pm, OpenCodeHttpError, UnsupportedOpenCodeVersionError } = await createManager();
      info.mockRejectedValue(new OpenCodeHttpError(404, { error: 'not found' }));
      health.mockResolvedValue({ version: '1.19.4' });

      await expect(pm.ensureServerRunning()).rejects.toBeInstanceOf(UnsupportedOpenCodeVersionError);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('probes /global/health once, then keeps polling and reports the generic error when no 1.x server answers', async () => {
      const { pm, OpenCodeRouteNotFoundError, UnsupportedOpenCodeVersionError } = await createManager();
      info.mockRejectedValue(new OpenCodeRouteNotFoundError('OpenCode route not found: GET /api/info (unsupported OpenCode version?)'));
      health.mockResolvedValue(null);

      const result = pm.ensureServerRunning();

      await expect(result).rejects.toThrow('OpenCode server failed to start after 15000ms');
      await expect(result).rejects.not.toBeInstanceOf(UnsupportedOpenCodeVersionError);
      expect(info).toHaveBeenCalledTimes(30);
      expect(health).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('kills the spawned child before rejecting when the server never becomes healthy', async () => {
      const { pm } = await createManager();
      info.mockRejectedValue(new Error('HTTP 500: {"error":"boom"}'));

      await expect(pm.ensureServerRunning()).rejects.toThrow('OpenCode server failed to start after 15000ms. Last error: HTTP 500');

      expect(info).toHaveBeenCalledTimes(30);
      expect(health).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    describe('OPENCODE_CONFIG_CONTENT', () => {
      it('always enables the experimental todo tool', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });

        await pm.ensureServerRunning();

        expect(JSON.parse(spawnedEnv().OPENCODE_CONFIG_CONTENT ?? 'null')).toEqual({ experimental: { todo: true } });
      });

      it('adds the MCP servers from the task payload', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });
        const mcp = { files: { type: 'local', command: ['npx', 'files'], enabled: false } };

        await pm.ensureServerRunning({ mcpServers: mcp });

        expect(JSON.parse(spawnedEnv().OPENCODE_CONFIG_CONTENT ?? 'null')).toEqual({ experimental: { todo: true }, mcp });
      });

      it('omits an empty MCP server map', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });

        await pm.ensureServerRunning({ mcpServers: {} });

        expect(JSON.parse(spawnedEnv().OPENCODE_CONFIG_CONTENT ?? 'null')).toEqual({ experimental: { todo: true } });
      });

      it('merges the OpenRouter overlay next to the todo flag and the MCP servers', async () => {
        const { pm, ProcessManager } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });
        const mcp = { files: { type: 'local', command: ['npx', 'files'] } };

        await pm.ensureServerRunning({ mcpServers: mcp, modelId: 'openrouter/minimax/minimax-m2.5' });

        expect(JSON.parse(spawnedEnv().OPENCODE_CONFIG_CONTENT ?? 'null')).toEqual({
          experimental: { todo: true },
          mcp,
          ...ProcessManager.buildOpenRouterOverlay(),
        });
        expect(ProcessManager.buildOpenRouterOverlay()).toEqual(
          expect.objectContaining({ small_model: 'openrouter/openai/gpt-5-nano', disabled_providers: ['opencode'] })
        );
      });

      it('leaves the overlay out for a non-OpenRouter model', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });

        await pm.ensureServerRunning({ modelId: 'anthropic/claude-sonnet-4-5' });

        expect(JSON.parse(spawnedEnv().OPENCODE_CONFIG_CONTENT ?? 'null')).toEqual({ experimental: { todo: true } });
      });

      it('never writes opencode.json or config.json, which v2 does not read', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });

        await pm.ensureServerRunning({ mcpServers: { files: { type: 'local', command: ['x'] } }, modelId: 'openrouter/x/y' });

        expect(mockWriteFileSync).not.toHaveBeenCalled();
      });

      it('has no on-disk config updaters left', async () => {
        const { pm } = await createManager();

        expect((pm as unknown as Record<string, unknown>).updateMcpConfig).toBeUndefined();
        expect((pm as unknown as Record<string, unknown>).updateModelConfig).toBeUndefined();
        expect((pm as unknown as Record<string, unknown>).writePreStartConfig).toBeUndefined();
      });
    });

    describe('stopServer', () => {
      it('just terminates the child; there is no dispose call to make', async () => {
        const { pm } = await createManager();
        info.mockResolvedValue({ version: '2.2.0' });
        child.once.mockImplementation((event: unknown, callback: unknown) => {
          if (event === 'exit') setTimeout(callback as () => void, 0);
          return child;
        });
        await pm.ensureServerRunning();

        await pm.stopServer();

        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      });
    });
  });
});
