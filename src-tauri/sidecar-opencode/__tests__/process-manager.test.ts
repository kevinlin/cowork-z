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
