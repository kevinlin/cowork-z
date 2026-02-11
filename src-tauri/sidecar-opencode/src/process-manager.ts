import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger';
import { OpenCodeClient } from './opencode-client';
import type { ApiKeys } from './types';

/** Default working directory for `opencode serve` to avoid writing config.json into the source tree. */
const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode', 'log');

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
      const userShell = process.env.SHELL || '/bin/zsh';
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
 * Find a random available port by binding to port 0 on 127.0.0.1.
 * The OS assigns an ephemeral port, which is returned after the temporary server is closed.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get available port')));
      }
    });
    server.on('error', reject);
  });
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
}

export class ProcessManager {
  private process: ChildProcess | null = null;
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
   * Write MCP servers (and any other pre-start config) into config.json
   * in the OpenCode data directory **before** spawning the server.
   * OpenCode reads MCP config at startup; PATCH /config after start
   * does NOT cause MCP server processes to be initialized.
   */
  private writePreStartConfig(mcpServers?: Record<string, unknown>): void {
    // Write to BOTH opencode.json (primary) and config.json (legacy).
    // OpenCode prioritizes opencode.json over config.json.
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

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      existing.mcp = mcpServers;
    } else {
      // Remove MCP key if no servers configured
      delete existing.mcp;
    }

    // Write to opencode.json (primary config file)
    fs.writeFileSync(opencodePath, JSON.stringify(existing, null, 2), 'utf-8');
    // Also write to config.json (legacy) for backwards compatibility
    fs.writeFileSync(legacyPath, JSON.stringify(existing, null, 2), 'utf-8');
    logger.info('Pre-start config written', { opencodePath, legacyPath, hasMcp: !!mcpServers });
  }

  /**
   * Update MCP servers in the on-disk config.json while the server is running.
   * OpenCode does NOT dynamically reload MCP servers from PATCH /config,
   * so changes only take effect on next server restart (i.e. next task start
   * after the sidecar is recycled).
   */
  updateMcpConfig(mcpServers?: Record<string, unknown>): void {
    this.writePreStartConfig(mcpServers);
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

    // Write MCP servers (and other pre-start config) into config files
    // BEFORE spawning the server. OpenCode only initializes MCP at startup.
    this.writePreStartConfig(options?.mcpServers);

    // Also set OPENCODE_CONFIG_CONTENT env var as a belt-and-suspenders approach.
    // This is the highest-priority config source for OpenCode and ensures MCP
    // servers are present even if file-based config isn't read correctly.
    if (options?.mcpServers && Object.keys(options.mcpServers).length > 0) {
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: options.mcpServers });
    }

    this.process = spawn(this.cliPath, args, {
      env,
      cwd: OPENCODE_DATA_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    // Log stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[opencode stdout] ${data.toString().trim()}`);
    });

    // Log stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug(`[opencode stderr] ${data.toString().trim()}`);
    });

    this.process.on('error', (error) => {
      logger.error('OpenCode process error', error);
    });

    this.process.on('exit', (code, signal) => {
      logger.info(`OpenCode process exited with code ${code}, signal ${signal}`);
      this.process = null;
    });

    // Wait for server to be ready
    await this.waitForServer();
  }

  private async waitForServer(): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 500;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const health = await this.client.health();
        logger.info(`OpenCode server ready, version: ${health.version}`);
        return;
      } catch {
        await this.sleep(delayMs);
      }
    }

    throw new Error(`OpenCode server failed to start after ${maxAttempts * delayMs}ms`);
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
