import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger';
import { OpenCodeClient } from './opencode-client';
import { getOpenCodeLogDir } from './paths';
import type { ApiKeys, Config } from './types';

/** Default working directory for `opencode serve` to avoid writing config.json into the source tree. */
const OPENCODE_DATA_DIR = getOpenCodeLogDir();

const UNIX_ALLOWED_LOGIN_SHELLS = [
  '/bin/zsh',
  '/bin/bash',
  '/bin/sh',
  '/usr/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/sh',
  '/opt/homebrew/bin/bash',
] as const;

const getSafeUnixLoginShell = (): string | undefined => {
  const envShell = process.env.SHELL;
  if (envShell && UNIX_ALLOWED_LOGIN_SHELLS.includes(envShell as (typeof UNIX_ALLOWED_LOGIN_SHELLS)[number])) {
    try {
      if (fs.existsSync(envShell)) {
        return envShell;
      }
    } catch {
      // Ignore fs errors and fall back to known shell paths.
    }
  }

  for (const shellPath of UNIX_ALLOWED_LOGIN_SHELLS) {
    try {
      if (fs.existsSync(shellPath)) {
        return shellPath;
      }
    } catch {
      // Ignore fs errors and keep trying allowed shells.
    }
  }

  return undefined;
};

/**
 * Build an augmented PATH suitable for macOS GUI-launched apps.
 *
 * When the app is launched from Finder / Dock / Spotlight, macOS gives
 * the process a minimal PATH (e.g. /usr/bin:/bin:/usr/sbin:/sbin).
 * Tools installed via Homebrew, nvm, volta, etc. won't be found.
 *
 * Strategy:
 * 1. Try to get the user's full login-shell PATH via `$SHELL -ilc 'echo $PATH'`
 * 2. Fall back to a curated list of well-known directories.
 * 3. Merge with the current process PATH (deduplicated).
 */
function getAugmentedPath(): string {
  const isWindows = process.platform === 'win32';
  const sep = isWindows ? ';' : ':';
  const currentPath = process.env.PATH ?? '';
  // Windows PATH lookups are case-insensitive; normalise for dedup.
  const existingDirs = isWindows
    ? new Set(
        currentPath
          .split(sep)
          .filter(Boolean)
          .map((d) => d.toLowerCase())
      )
    : new Set(currentPath.split(sep).filter(Boolean));
  // Keep the original (non-lowered) entries so we emit a valid PATH string.
  const orderedDirs = currentPath.split(sep).filter(Boolean);

  const addDir = (dir: string): void => {
    const key = isWindows ? dir.toLowerCase() : dir;
    if (!existingDirs.has(key)) {
      try {
        if (fs.existsSync(dir)) {
          existingDirs.add(key);
          orderedDirs.push(dir);
        }
      } catch {
        // stat failed, skip
      }
    }
  };

  // --- Login-shell PATH (macOS / Linux only) ---
  // On Unix, GUI-launched apps receive a minimal PATH. Source the user's
  // login shell to recover the full PATH they configured in .zshrc etc.
  // Uses execFileSync (not execSync) to avoid shell injection.
  if (!isWindows) {
    try {
      const userShell = getSafeUnixLoginShell();
      if (userShell) {
        const shellPath = execFileSync(userShell, ['-ilc', 'echo $PATH'], {
          timeout: 5000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (shellPath) {
          for (const dir of shellPath.split(':').filter(Boolean)) {
            if (!existingDirs.has(dir)) {
              existingDirs.add(dir);
              orderedDirs.push(dir);
            }
          }
        }
      }
    } catch {
      logger.debug('Failed to get PATH from login shell, using fallback paths');
    }
  }

  // --- Well-known directories ---
  const home = os.homedir();

  if (isWindows) {
    // Windows-specific directories
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';

    const winDirs = [
      // npm global
      path.join(appData, 'npm'),
      // Node.js installers
      path.join(programFiles, 'nodejs'),
      path.join(programFilesX86, 'nodejs'),
      // Volta
      path.join(localAppData, 'Volta', 'bin'),
      // Scoop
      path.join(home, 'scoop', 'shims'),
      // Chocolatey
      'C:\\ProgramData\\chocolatey\\bin',
      // Yarn
      path.join(localAppData, 'Yarn', 'bin'),
      // pnpm
      path.join(localAppData, 'pnpm'),
      // fnm (Fast Node Manager)
      path.join(localAppData, 'fnm_multishells'),
    ];

    // nvm-windows: versions live in %APPDATA%\nvm\<version>
    const nvmDir = process.env.NVM_HOME ?? path.join(appData, 'nvm');
    try {
      if (fs.existsSync(nvmDir)) {
        const versions = fs
          .readdirSync(nvmDir)
          .filter((v) => /^v?\d+/.test(v))
          .sort()
          .reverse();
        if (versions.length > 0) {
          winDirs.push(path.join(nvmDir, versions[0]));
        }
        // nvm-windows symlink directory
        addDir(nvmDir);
      }
    } catch {
      // nvm-windows not installed, skip
    }

    for (const dir of winDirs) {
      addDir(dir);
    }
  } else {
    // macOS / Linux directories
    const unixDirs = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      path.join(home, '.local', 'bin'),
      path.join(home, '.volta', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.yarn', 'bin'),
      // pnpm
      path.join(home, '.local', 'share', 'pnpm'),
      // fnm (Fast Node Manager)
      path.join(home, '.local', 'share', 'fnm'),
    ];

    // Expand nvm: find the latest node version directory
    const nvmBase = path.join(home, '.nvm', 'versions', 'node');
    try {
      if (fs.existsSync(nvmBase)) {
        const versions = fs.readdirSync(nvmBase).sort().reverse();
        if (versions.length > 0) {
          unixDirs.push(path.join(nvmBase, versions[0], 'bin'));
        }
      }
    } catch {
      // nvm not installed, skip
    }

    for (const dir of unixDirs) {
      addDir(dir);
    }
  }

  const augmentedPath = orderedDirs.join(sep);
  if (augmentedPath !== currentPath) {
    logger.debug('Augmented PATH for opencode spawn', {
      added: orderedDirs.filter((d) => !currentPath.split(sep).includes(d)),
    });
  }
  return augmentedPath;
}

/**
 * Parse the output of `netsh interface ipv4 show excludedportrange protocol=tcp`
 * into an array of [start, end] tuples.
 *
 * Example netsh output lines:
 *   "    50331    50430      *"
 *   "    55498    55597      *  administratively prohibited"
 */
function parseExcludedPortRanges(output: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s+(\d+)\s+(\d+)\s/);
    if (match) {
      ranges.push([Number(match[1]), Number(match[2])]);
    }
  }
  return ranges;
}

/**
 * On Windows, Hyper-V / WinNAT can reserve ephemeral port ranges that look
 * available to the OS but fail with access errors when actually used.
 * Returns the excluded ranges (cached for the process lifetime).
 */
let _excludedRangesCache: [number, number][] | null = null;

function getWindowsExcludedPortRanges(): [number, number][] {
  if (_excludedRangesCache !== null) return _excludedRangesCache;
  try {
    const output = execFileSync('netsh', ['interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    _excludedRangesCache = parseExcludedPortRanges(output);
    if (_excludedRangesCache.length > 0) {
      logger.debug('Windows excluded port ranges', { ranges: _excludedRangesCache });
    }
  } catch {
    logger.debug('Failed to query Windows excluded port ranges, skipping check');
    _excludedRangesCache = [];
  }
  return _excludedRangesCache;
}

function isPortInExcludedRange(port: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => port >= start && port <= end);
}

/** Exported for testing — reset the cached excluded-port-range list. */
export function _resetExcludedRangesCache(): void {
  _excludedRangesCache = null;
}

/**
 * Find a random available port by binding to port 0 on 127.0.0.1.
 * The OS assigns an ephemeral port, which is returned after the temporary server is closed.
 *
 * On Windows, the port is checked against Hyper-V / WinNAT excluded port ranges
 * (queried via `netsh`) and retried if it falls within a reserved range.
 */
export function getAvailablePort(maxRetries = 10): Promise<number> {
  const isWindows = process.platform === 'win32';
  const excludedRanges = isWindows ? getWindowsExcludedPortRanges() : [];

  const tryBind = (attemptsLeft: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          const port = addr.port;
          server.close(() => {
            if (isWindows && isPortInExcludedRange(port, excludedRanges)) {
              logger.debug(`Port ${port} falls in a Windows excluded range, retrying (${attemptsLeft - 1} left)`);
              if (attemptsLeft <= 1) {
                reject(new Error(`All ${maxRetries} port attempts fell in Windows excluded ranges`));
              } else {
                resolve(tryBind(attemptsLeft - 1));
              }
            } else {
              resolve(port);
            }
          });
        } else {
          server.close(() => reject(new Error('Failed to get available port')));
        }
      });
      server.on('error', reject);
    });

  return tryBind(maxRetries);
}

/**
 * Generate a cryptographically random password using base64url encoding.
 * Default length of 32 random bytes produces a 43-character string.
 */
export function generatePassword(length = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

export interface ProcessManagerOptions {
  hostname?: string;
  cliPath?: string;
  /** Override password (useful for testing). Auto-generated if not provided. */
  password?: string;
}

export interface ServerStartOptions {
  apiKeys?: ApiKeys;
  /** MCP servers to write into config.json before starting the server. */
  mcpServers?: Record<string, unknown>;
  /** Model ID (e.g. "openrouter/minimax/minimax-m2.5") to derive pre-start config. */
  modelId?: string;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private spawnError: Error | null = null;
  private client: OpenCodeClient;
  private port = 0;
  private hostname: string;
  private cliPath: string;
  private password: string;

  constructor(options: ProcessManagerOptions = {}) {
    this.hostname = options.hostname ?? '127.0.0.1';
    this.cliPath = options.cliPath ?? 'opencode';
    this.password = options.password ?? generatePassword();
    // Client will be recreated in startServer() once the port is known.
    // Initialize with a placeholder so health checks before first start return false.
    this.client = new OpenCodeClient({ port: 0 });
  }

  async ensureServerRunning(options?: ServerStartOptions): Promise<void> {
    // Start new server on a random port
    await this.startServer(options);
  }

  /**
   * Build the OpenRouter-specific config overlay that pins the small model
   * and registers it in the provider model list.
   *
   * OpenRouter models are not in OpenCode's curated models.dev database, so
   * automatic small-model resolution picks the wrong model (e.g. Claude
   * Haiku 4.5 via the built-in "opencode" provider).  This overlay:
   *  1. Disables the "opencode" provider so it can't auto-load.
   *  2. Registers gpt-5-nano under the openrouter provider config so
   *     OpenCode's getModel("openrouter", "openai/gpt-5-nano") succeeds.
   *  3. Sets small_model explicitly.
   */
  static buildOpenRouterOverlay(): Partial<Config> {
    return {
      small_model: 'openrouter/openai/gpt-5-nano',
      disabled_providers: ['opencode'],
      provider: {
        openrouter: {
          models: {
            'openai/gpt-5-nano': {
              name: 'GPT-5 Nano',
              tool_call: true,
            },
          },
        },
      },
    };
  }

  /**
   * Write config into the OpenCode data directory **before** spawning the
   * server (or while it's running to prepare for the next instance reload).
   *
   * Writes to BOTH opencode.json (primary — what OpenCode actually reads)
   * and config.json (legacy fallback).
   *
   * @param mcpServers  MCP server definitions (or undefined to clear)
   * @param configOverlay  Additional config fields to merge (e.g. small_model,
   *                       disabled_providers, provider model registration)
   */
  private writePreStartConfig(mcpServers?: Record<string, unknown>, configOverlay?: Partial<Config>): void {
    const opencodePath = path.join(OPENCODE_DATA_DIR, 'opencode.json');
    const legacyPath = path.join(OPENCODE_DATA_DIR, 'config.json');

    // Read existing config from either file (prefer opencode.json)
    let existing: Record<string, unknown> = {};
    try {
      if (fs.existsSync(opencodePath)) {
        existing = JSON.parse(fs.readFileSync(opencodePath, 'utf-8'));
      } else if (fs.existsSync(legacyPath)) {
        existing = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      }
    } catch {
      logger.warn('Failed to read existing config, starting fresh');
    }

    // Apply MCP servers (undefined = leave existing MCP config untouched)
    if (mcpServers !== undefined) {
      if (Object.keys(mcpServers).length > 0) {
        existing.mcp = mcpServers;
      } else {
        delete existing.mcp;
      }
    }

    // Apply config overlay (small_model, disabled_providers, provider, etc.)
    if (configOverlay) {
      for (const [key, value] of Object.entries(configOverlay)) {
        if (value !== undefined) {
          existing[key] = value;
        }
      }
    }

    // Write to opencode.json (primary config file)
    fs.writeFileSync(opencodePath, JSON.stringify(existing, null, 2), 'utf-8');
    // Also write to config.json (legacy) for backwards compatibility
    fs.writeFileSync(legacyPath, JSON.stringify(existing, null, 2), 'utf-8');
    logger.info('Pre-start config written', {
      opencodePath,
      legacyPath,
      hasMcp: !!mcpServers,
      hasOverlay: !!configOverlay,
    });
  }

  /**
   * Update MCP servers in the on-disk config while the server is running.
   * OpenCode does NOT dynamically reload MCP servers from PATCH /config,
   * so changes only take effect on next server restart (i.e. next task start
   * after the sidecar is recycled).
   */
  updateMcpConfig(mcpServers?: Record<string, unknown>): void {
    this.writePreStartConfig(mcpServers);
  }

  /**
   * Update model-related config on disk while the server is running.
   * This is needed when the user switches models between tasks (e.g. from
   * Anthropic to OpenRouter) without restarting the sidecar.
   *
   * The config is written to opencode.json so that when PATCH /config
   * triggers an instance disposal, the new instance picks up the settings
   * from the file OpenCode actually reads.
   */
  updateModelConfig(modelId?: string): void {
    const overlay = modelId?.startsWith('openrouter/') ? ProcessManager.buildOpenRouterOverlay() : undefined;
    // Pass undefined for mcpServers to preserve existing MCP config on disk
    this.writePreStartConfig(undefined, overlay);
  }

  private async startServer(options?: ServerStartOptions): Promise<void> {
    const apiKeys = options?.apiKeys;

    // Pick a random available port
    this.port = await getAvailablePort();
    logger.info(`Starting opencode serve on port ${this.port}`);

    // Recreate the client with the actual port and password
    this.client = new OpenCodeClient({ port: this.port, password: this.password });

    const env: NodeJS.ProcessEnv = { ...process.env };

    // Augment PATH so that `opencode` can be found when the app is launched
    // from Finder/Dock (which provides a minimal PATH).
    env.PATH = getAugmentedPath();

    // Enable HTTP basic auth on the OpenCode server
    env.OPENCODE_SERVER_PASSWORD = this.password;
    logger.debug(`OPENCODE_SERVER_PASSWORD=${this.password}`);

    // Set API keys as environment variables
    if (apiKeys?.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
    if (apiKeys?.openai) env.OPENAI_API_KEY = apiKeys.openai;
    if (apiKeys?.google) env.GOOGLE_GENERATIVE_AI_API_KEY = apiKeys.google;
    if (apiKeys?.xai) env.XAI_API_KEY = apiKeys.xai;
    if (apiKeys?.deepseek) env.DEEPSEEK_API_KEY = apiKeys.deepseek;
    if (apiKeys?.openrouter) env.OPENROUTER_API_KEY = apiKeys.openrouter;
    if (apiKeys?.litellm) env.LITELLM_API_KEY = apiKeys.litellm;

    // AWS Bedrock credentials
    if (apiKeys?.bedrock) {
      env.AWS_ACCESS_KEY_ID = apiKeys.bedrock.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = apiKeys.bedrock.secretAccessKey;
      env.AWS_REGION = apiKeys.bedrock.region;
    }

    const args = ['serve', '--port', String(this.port), '--hostname', this.hostname];

    // Ensure the data directory exists so opencode writes config.json there
    // instead of into the source tree (which would trigger Tauri rebuilds).
    if (!fs.existsSync(OPENCODE_DATA_DIR)) {
      fs.mkdirSync(OPENCODE_DATA_DIR, { recursive: true });
    }

    // Build model-specific config overlay (e.g. OpenRouter small_model pinning)
    const modelOverlay = options?.modelId?.startsWith('openrouter/') ? ProcessManager.buildOpenRouterOverlay() : undefined;

    // Write MCP servers and config overlay into opencode.json / config.json
    // BEFORE spawning the server. OpenCode reads these at startup.
    this.writePreStartConfig(options?.mcpServers, modelOverlay);

    // Also set OPENCODE_CONFIG_CONTENT env var — the highest-priority config
    // source for OpenCode. Merge MCP and model overlay so neither overrides
    // the other when OpenCode re-reads config after instance disposal.
    const envConfig: Record<string, unknown> = {};
    if (options?.mcpServers && Object.keys(options.mcpServers).length > 0) {
      envConfig.mcp = options.mcpServers;
    }
    if (modelOverlay) {
      Object.assign(envConfig, modelOverlay);
    }
    if (Object.keys(envConfig).length > 0) {
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify(envConfig);
    }

    this.spawnError = null;

    this.process = spawn(this.cliPath, args, {
      env,
      cwd: OPENCODE_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      // Windows npm global installs create .cmd shims that spawn() cannot
      // execute without a shell. macOS/Linux don't need this.
      shell: process.platform === 'win32',
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[opencode stdout] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug(`[opencode stderr] ${data.toString().trim()}`);
    });

    this.process.on('error', (error) => {
      logger.error('OpenCode process spawn/runtime error', error);
      this.spawnError = error;
    });

    this.process.on('exit', (code, signal) => {
      logger.info(`OpenCode process exited with code ${code}, signal ${signal}`);
      this.process = null;
    });

    await this.waitForServer();
  }

  private async waitForServer(): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 500;
    let lastError: unknown;

    for (let i = 0; i < maxAttempts; i++) {
      if (this.spawnError) {
        throw new Error(`OpenCode process failed to spawn: ${this.spawnError.message}`);
      }
      if (this.process === null) {
        throw new Error('OpenCode process exited before server became ready');
      }

      try {
        const health = await this.client.health();
        logger.info(`OpenCode server ready, version: ${health.version}`);
        return;
      } catch (err) {
        lastError = err;
        if (i % 5 === 0) {
          logger.debug(`Waiting for OpenCode server (attempt ${i + 1}/${maxAttempts})`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await this.sleep(delayMs);
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`OpenCode server failed to start after ${maxAttempts * delayMs}ms. Last error: ${detail}`);
  }

  async stopServer(): Promise<void> {
    if (this.process) {
      logger.info('Stopping OpenCode server...');

      try {
        await this.client.disposeGlobal();
      } catch (error) {
        logger.warn('Failed to dispose server gracefully', error);
      }

      // Force kill if still running after 5 seconds
      setTimeout(() => {
        if (this.process) {
          logger.warn('Force killing OpenCode process');
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getClient(): OpenCodeClient {
    return this.client;
  }

  getPort(): number {
    return this.port;
  }

  getPassword(): string {
    return this.password;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
