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
    health: jest.fn().mockResolvedValue({ version: '1.0.0', status: 'healthy' }),
    disposeGlobal: jest.fn().mockResolvedValue(undefined),
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

describe('OpenCode 2.x gate', () => {
  const loadModules = async () => {
    jest.resetModules();
    const processManager = await import('../src/process-manager');
    const openCodeClient = await import('../src/opencode-client');
    return {
      ...processManager,
      OpenCodeClient: openCodeClient.OpenCodeClient as unknown as jest.Mock,
      OpenCodeRouteNotFoundError: openCodeClient.OpenCodeRouteNotFoundError,
    };
  };

  describe('parseUnsupportedOpenCodeVersion', () => {
    it.each([
      [{ version: '2.2.0' }, '2.2.0'],
      [{ version: 'v2.0.1' }, 'v2.0.1'],
      [{ version: '1.19.4' }, undefined],
      [{ version: 'abc' }, undefined],
      [{}, undefined],
      [null, undefined],
      ['<html>', undefined],
    ])('maps %j to %j', async (info, expected) => {
      const { parseUnsupportedOpenCodeVersion } = await loadModules();

      expect(parseUnsupportedOpenCodeVersion(info)).toBe(expected);
    });
  });

  describe('detectUnsupportedOpenCodeVersion', () => {
    it('returns the version when /api/info reports 2.x', async () => {
      const { detectUnsupportedOpenCodeVersion } = await loadModules();
      const client = { getServerInfo: jest.fn<() => Promise<{ version?: string } | null>>().mockResolvedValue({ version: '2.2.0' }) };

      await expect(detectUnsupportedOpenCodeVersion(client)).resolves.toBe('2.2.0');
    });

    it('returns undefined when /api/info resolves null', async () => {
      const { detectUnsupportedOpenCodeVersion } = await loadModules();
      const client = { getServerInfo: jest.fn<() => Promise<{ version?: string } | null>>().mockResolvedValue(null) };

      await expect(detectUnsupportedOpenCodeVersion(client)).resolves.toBeUndefined();
    });

    it.each([
      [
        'an HTML route-not-found response',
        (m: Awaited<ReturnType<typeof loadModules>>) => new m.OpenCodeRouteNotFoundError('route not found'),
      ],
      ['an HTTP 404', () => new Error('HTTP 404: {"error":"not found"}')],
      ['an HTTP 401', () => new Error('HTTP 401: {"error":"unauthorized"}')],
      ['a refused connection', () => new TypeError('fetch failed')],
    ])('returns undefined when the probe fails with %s', async (_label, makeError) => {
      const modules = await loadModules();
      const client = { getServerInfo: jest.fn<() => Promise<{ version?: string } | null>>().mockRejectedValue(makeError(modules)) };

      await expect(modules.detectUnsupportedOpenCodeVersion(client)).resolves.toBeUndefined();
    });
  });

  describe('server startup failure', () => {
    const health = jest.fn<() => Promise<unknown>>();
    const getServerInfo = jest.fn<() => Promise<{ version?: string } | null>>();
    let child: { stdout: { on: jest.Mock }; stderr: { on: jest.Mock }; on: jest.Mock; kill: jest.Mock; killed: boolean };

    // Start a ProcessManager whose OpenCode server never becomes healthy and whose child never exits.
    const createManager = async () => {
      const modules = await loadModules();
      modules.OpenCodeClient.mockImplementation(() => ({ health, getServerInfo, disposeGlobal: jest.fn() }));
      const sleep = jest
        .spyOn(modules.ProcessManager.prototype as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
        .mockResolvedValue(undefined);
      const pm = new modules.ProcessManager({ cliPath: 'opencode', password: 'test' });
      return { ...modules, pm, sleep };
    };

    beforeEach(() => {
      health.mockReset();
      getServerInfo.mockReset();
      mockExistsSync.mockReset();
      mockExecFileSync.mockReset();
      mockSpawn.mockReset();
      mockReadFileSync.mockReset();
      mockWriteFileSync.mockReset();
      mockMkdirSync.mockReset();
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue('{}');
      child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn(), kill: jest.fn(), killed: false };
      mockSpawn.mockReturnValue(child);
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true, configurable: true });
    });

    it('fails on the first health poll with UnsupportedOpenCodeVersionError when the server reports 2.x', async () => {
      const { pm, sleep, OpenCodeRouteNotFoundError, UnsupportedOpenCodeVersionError } = await createManager();
      health.mockRejectedValue(
        new OpenCodeRouteNotFoundError('OpenCode route not found: GET /global/health (unsupported OpenCode version?)')
      );
      getServerInfo.mockResolvedValue({ version: '2.2.0' });

      const result = pm.ensureServerRunning();

      await expect(result).rejects.toBeInstanceOf(UnsupportedOpenCodeVersionError);
      await expect(result).rejects.toMatchObject({
        name: 'UnsupportedOpenCodeVersionError',
        message: expect.stringContaining('2.2.0'),
      });
      await expect(result).rejects.toThrow('npm uninstall -g @opencode/cli && npm install -g opencode-ai@1');
      expect(health).toHaveBeenCalledTimes(1);
      expect(getServerInfo).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('probes /api/info once, then keeps polling and reports the generic error when no 2.x server answers', async () => {
      const { pm, OpenCodeRouteNotFoundError, UnsupportedOpenCodeVersionError } = await createManager();
      health.mockRejectedValue(
        new OpenCodeRouteNotFoundError('OpenCode route not found: GET /global/health (unsupported OpenCode version?)')
      );
      getServerInfo.mockResolvedValue(null);

      const result = pm.ensureServerRunning();

      await expect(result).rejects.toThrow('OpenCode server failed to start after 15000ms');
      await expect(result).rejects.not.toBeInstanceOf(UnsupportedOpenCodeVersionError);
      expect(health).toHaveBeenCalledTimes(30);
      expect(getServerInfo).toHaveBeenCalledTimes(1);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('kills the spawned child before rejecting when the server never becomes healthy', async () => {
      const { pm } = await createManager();
      health.mockRejectedValue(new Error('HTTP 500: {"error":"boom"}'));

      await expect(pm.ensureServerRunning()).rejects.toThrow('OpenCode server failed to start after 15000ms. Last error: HTTP 500');

      expect(health).toHaveBeenCalledTimes(30);
      expect(getServerInfo).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
