import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger';
import { OpenCodeClient } from './opencode-client';
import type { ApiKeys } from './types';

/** Default working directory for `opencode serve` to avoid writing config.json into the source tree. */
const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode', 'log');

export interface ProcessManagerOptions {
  port?: number;
  hostname?: string;
  cliPath?: string;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private client: OpenCodeClient;
  private port: number;
  private hostname: string;
  private cliPath: string;

  constructor(options: ProcessManagerOptions = {}) {
    this.port = options.port ?? 4096;
    this.hostname = options.hostname ?? '127.0.0.1';
    this.cliPath = options.cliPath ?? 'opencode';
    this.client = new OpenCodeClient({ port: this.port });
  }

  async ensureServerRunning(apiKeys?: ApiKeys): Promise<void> {
    // Check if server is already running
    if (await this.client.isServerRunning()) {
      logger.info('OpenCode server already running, terminating...');
      await this.terminateExistingServer();
    }

    // Start new server
    await this.startServer(apiKeys);
  }

  private async terminateExistingServer(): Promise<void> {
    try {
      // Try graceful disposal first
      await this.client.disposeGlobal();
      logger.info('Existing server disposed gracefully');

      // Wait for server to stop
      let attempts = 0;
      while (attempts < 10) {
        await this.sleep(500);
        if (!(await this.client.isServerRunning())) {
          logger.info('Existing server terminated');
          return;
        }
        attempts++;
      }

      logger.warn('Server did not stop after dispose, will start anyway');
    } catch (error) {
      logger.warn('Failed to dispose existing server', error);
    }
  }

  private async startServer(apiKeys?: ApiKeys): Promise<void> {
    logger.info(`Starting opencode serve on port ${this.port}`);

    const env: NodeJS.ProcessEnv = { ...process.env };

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
