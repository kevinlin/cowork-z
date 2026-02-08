import { type ChildProcess, spawn } from 'node:child_process';
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

  async ensureServerRunning(apiKeys?: ApiKeys): Promise<void> {
    // Start new server on a random port
    await this.startServer(apiKeys);
  }

  private async startServer(apiKeys?: ApiKeys): Promise<void> {
    // Pick a random available port
    this.port = await getAvailablePort();
    logger.info(`Starting opencode serve on port ${this.port}`);

    // Recreate the client with the actual port and password
    this.client = new OpenCodeClient({ port: this.port, password: this.password });

    const env: NodeJS.ProcessEnv = { ...process.env };

    // Enable HTTP basic auth on the OpenCode server
    env.OPENCODE_SERVER_PASSWORD = this.password;

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
