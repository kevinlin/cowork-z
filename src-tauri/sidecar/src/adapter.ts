import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import os from 'os';
import { StreamParser } from './stream-parser';
import { getOpenCodeCliPath, isOpenCodeAvailable, OpenCodeCliNotFoundError } from './cli-path';
import {
  generateOpenCodeConfig,
  buildOpenCodeEnvironment,
  getOpenCodeConfigDir,
  ACCOMPLISH_AGENT_NAME,
} from './config-generator';
import type {
  TaskConfig,
  TaskResult,
  TaskProgress,
  OpenCodeMessage,
  PermissionRequest,
  ApiKeys,
  OpenCodeToolUseMessage,
} from './types';

export interface OpenCodeAdapterEvents {
  message: [OpenCodeMessage];
  'tool-use': [string, unknown];
  'tool-result': [string];
  'permission-request': [PermissionRequest];
  progress: [TaskProgress];
  complete: [TaskResult];
  error: [Error];
}

export interface AdapterConfig extends TaskConfig {
  apiKeys?: ApiKeys;
}

export class OpenCodeAdapter extends EventEmitter<OpenCodeAdapterEvents> {
  private ptyProcess: pty.IPty | null = null;
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private streamParser: StreamParser;
  private currentSessionId: string | null = null;
  private currentTaskId: string | null = null;
  private hasCompleted: boolean = false;
  private isDisposed: boolean = false;
  private wasInterrupted: boolean = false;
  private lastWorkingDirectory: string | undefined;
  private currentModelId: string | null = null;
  private apiKeys: ApiKeys = {};

  constructor(taskId?: string) {
    super();
    this.currentTaskId = taskId || null;
    this.streamParser = new StreamParser();
    this.setupStreamParsing();
  }

  /**
   * Start a new task with OpenCode CLI
   */
  async startTask(config: AdapterConfig): Promise<void> {
    if (this.isDisposed) {
      throw new Error('Adapter has been disposed and cannot start new tasks');
    }

    if (!isOpenCodeAvailable()) {
      throw new OpenCodeCliNotFoundError();
    }

    const taskId = config.taskId || this.generateTaskId();
    this.currentTaskId = taskId;
    this.currentSessionId = config.sessionId || null;
    this.streamParser.reset();
    this.hasCompleted = false;
    this.wasInterrupted = false;
    this.lastWorkingDirectory = config.workingDirectory;
    this.apiKeys = config.apiKeys || {};
    this.currentModelId = config.modelId || null;
    const modelId = this.currentModelId;
    const modelProvider = modelId ? modelId.split('/')[0] : null;
    const apiKeyFlags = {
      anthropic: Boolean(this.apiKeys.anthropic),
      openai: Boolean(this.apiKeys.openai),
      google: Boolean(this.apiKeys.google),
      xai: Boolean(this.apiKeys.xai),
      deepseek: Boolean(this.apiKeys.deepseek),
      openrouter: Boolean(this.apiKeys.openrouter),
      litellm: Boolean(this.apiKeys.litellm),
      ollama: Boolean(this.apiKeys.ollama),
      azureFoundry: Boolean(this.apiKeys.azureFoundry),
      bedrock: Boolean(this.apiKeys.bedrock),
    };

    // Generate OpenCode config file
    const configPath = generateOpenCodeConfig({
      apiKeys: this.apiKeys,
      modelId: config.modelId,
      workingDirectory: config.workingDirectory,
    });

    const cliArgs = this.buildCliArgs(config);
    const { command, args: baseArgs } = getOpenCodeCliPath();
    const allArgs = [...baseArgs, ...cliArgs];

    // Build environment with API keys
    const env = buildOpenCodeEnvironment(this.apiKeys);
    env.OPENCODE_CONFIG = configPath;
    env.OPENCODE_CONFIG_DIR = getOpenCodeConfigDir();
    const authSync = syncApiKeysToOpenCodeAuth(this.apiKeys);

    // Use temp directory as default cwd
    const safeCwd = config.workingDirectory || os.tmpdir();

    // Emit loading progress
    this.emit('progress', { stage: 'loading', message: 'Loading agent...' });

    // Build shell command
    const fullCommand = this.buildShellCommand(command, allArgs);
    const shellCmd = this.getPlatformShell();
    const shellArgs = this.getShellArgs(fullCommand);
    const useShell = process.platform === 'win32';
    const spawnCommand = useShell ? shellCmd : command;
    const spawnArgs = useShell ? shellArgs : allArgs;
    const cwdExists = fs.existsSync(safeCwd);
    const shellExists = fs.existsSync(shellCmd);
    const commandPreview = fullCommand.slice(0, 160);
    const envPath = env.PATH || '';
    const envShell = env.SHELL || '';
    let cwdAccessOk = true;
    let shellAccessOk = true;
    let commandAccessOk: boolean | null = null;
    try {
      fs.accessSync(safeCwd, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      cwdAccessOk = false;
    }
    try {
      fs.accessSync(shellCmd, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      shellAccessOk = false;
    }
    if (command.startsWith('/')) {
      try {
        fs.accessSync(command, fs.constants.R_OK | fs.constants.X_OK);
        commandAccessOk = true;
      } catch {
        commandAccessOk = false;
      }
    }
    const spawnPreflight = spawnSync(shellCmd, ['-c', 'true'], {
      cwd: safeCwd,
      env: env as { [key: string]: string },
    });

    // Spawn PTY process
    try {
      this.ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
        name: 'xterm-256color',
        cols: 200,
        rows: 30,
        cwd: safeCwd,
        env: env as { [key: string]: string },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorData =
        error && typeof error === 'object'
          ? {
              code: (error as { code?: unknown }).code,
              errno: (error as { errno?: unknown }).errno,
              syscall: (error as { syscall?: unknown }).syscall,
              path: (error as { path?: unknown }).path,
              name: (error as { name?: unknown }).name,
              stack: (error as { stack?: unknown }).stack,
              keys: Object.getOwnPropertyNames(error),
            }
          : {};
    }

    if (this.ptyProcess) {
      // Handle PTY data
      this.ptyProcess.onData((data: string) => {
        const cleanData = this.cleanPtyOutput(data);
        if (cleanData.trim()) {
          this.streamParser.feed(cleanData);
        }
      });

      // Handle PTY exit
      this.ptyProcess.onExit(({ exitCode }) => {
        this.handleProcessExit(exitCode);
      });
      return;
    }

    // Fallback to non-PTY spawn if PTY failed
    this.childProcess = spawn(command, allArgs, {
      cwd: safeCwd,
      env: env as { [key: string]: string },
      stdio: 'pipe',
    });
    this.childProcess.stdin.end();
    let fallbackStdoutBytes = 0;
    let fallbackStderrBytes = 0;
    let fallbackLoggedStdout = false;
    let fallbackLoggedStderr = false;

    this.childProcess.stdout.on('data', (data: Buffer) => {
      fallbackStdoutBytes += data.length;
      if (!fallbackLoggedStdout) {
        fallbackLoggedStdout = true;
        const snippet = data.toString().slice(0, 200);
      }
      const cleanData = this.cleanPtyOutput(data.toString());
      if (cleanData.trim()) {
        this.streamParser.feed(cleanData);
      }
    });

    this.childProcess.stderr.on('data', (data: Buffer) => {
      fallbackStderrBytes += data.length;
      if (!fallbackLoggedStderr) {
        fallbackLoggedStderr = true;
        const snippet = data.toString().slice(0, 200).trim();
      }
      const cleanData = data.toString().trim();
      if (cleanData) {
        this.emit('progress', { stage: 'loading', message: cleanData });
      }
    });

    this.childProcess.on('error', (err) => {
      this.emit('error', err);
    });

    this.childProcess.on('spawn', () => {
    });

    this.childProcess.on('exit', (code, signal) => {
      this.handleProcessExit(code ?? null);
    });
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string, prompt: string): Promise<void> {
    return this.startTask({
      taskId: this.currentTaskId || this.generateTaskId(),
      prompt,
      sessionId,
      apiKeys: this.apiKeys,
      workingDirectory: this.lastWorkingDirectory,
    });
  }

  /**
   * Send user response for permission/question
   */
  async sendResponse(response: string): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.write(response + '\n');
      return;
    }
    if (this.childProcess) {
      this.childProcess.stdin.write(response + '\n');
      return;
    }
    throw new Error('No active process');
  }

  /**
   * Cancel the current task (hard kill)
   */
  async cancelTask(): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }
  }

  /**
   * Interrupt the current task (graceful Ctrl+C)
   */
  async interruptTask(): Promise<void> {
    if (!this.ptyProcess) {
      if (this.childProcess) {
        this.wasInterrupted = true;
        this.childProcess.kill('SIGINT');
      }
      return;
    }

    this.wasInterrupted = true;
    this.ptyProcess.write('\x03'); // Ctrl+C

    // On Windows, batch files prompt "Terminate batch job (Y/N)?"
    if (process.platform === 'win32') {
      setTimeout(() => {
        if (this.ptyProcess) {
          this.ptyProcess.write('Y\n');
        }
      }, 100);
    }
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get the current task ID
   */
  getTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * Check if the adapter has been disposed
   */
  isAdapterDisposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Dispose the adapter and clean up resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;

    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Ignore errors during cleanup
      }
      this.ptyProcess = null;
    }
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {
        // Ignore errors during cleanup
      }
      this.childProcess = null;
    }

    this.currentSessionId = null;
    this.currentTaskId = null;
    this.hasCompleted = true;
    this.streamParser.reset();
    this.removeAllListeners();
  }

  private buildCliArgs(config: TaskConfig): string[] {
    const args = ['run', config.prompt, '--format', 'json'];

    if (config.modelId) {
      args.push('--model', config.modelId);
    }

    if (config.sessionId) {
      args.push('--session', config.sessionId);
    }

    args.push('--agent', ACCOMPLISH_AGENT_NAME);
    // Enable CLI logs for debugging (stderr)
    args.push('--print-logs', '--log-level', 'DEBUG');

    return args;
  }

  private setupStreamParsing(): void {
    this.streamParser.on('message', (message: OpenCodeMessage) => {
      this.handleMessage(message);
    });

    this.streamParser.on('error', () => {
      // Non-JSON lines are expected from PTY, ignore parse errors
    });
  }

  private handleMessage(message: OpenCodeMessage): void {
    switch (message.type) {
      case 'step_start':
        this.currentSessionId = message.part.sessionID;
        this.emit('progress', {
          stage: 'connecting',
          message: `Connecting to ${this.currentModelId || 'AI'}...`,
          modelName: this.currentModelId || undefined,
        });
        break;

      case 'text':
        if (!this.currentSessionId && message.part.sessionID) {
          this.currentSessionId = message.part.sessionID;
        }
        this.emit('message', message);
        break;

      case 'tool_call': {
        const toolName = message.part.tool || 'unknown';
        const toolInput = message.part.input;

        this.emit('tool-use', toolName, toolInput);
        this.emit('progress', {
          stage: 'tool-use',
          message: `Using ${toolName}`,
        });

        // Check if this is AskUserQuestion
        if (toolName === 'AskUserQuestion') {
          this.handleAskUserQuestion(toolInput);
        }
        break;
      }

      case 'tool_use': {
        const toolUseMessage = message as OpenCodeToolUseMessage;
        const toolUseName = toolUseMessage.part.tool || 'unknown';
        const toolUseInput = toolUseMessage.part.state?.input;
        const toolUseOutput = toolUseMessage.part.state?.output || '';
        const toolUseStatus = toolUseMessage.part.state?.status;

        this.emit('message', message);
        this.emit('tool-use', toolUseName, toolUseInput);
        this.emit('progress', {
          stage: 'tool-use',
          message: `Using ${toolUseName}`,
        });

        if (toolUseStatus === 'completed' || toolUseStatus === 'error') {
          this.emit('tool-result', toolUseOutput);
        }

        if (toolUseName === 'AskUserQuestion') {
          this.handleAskUserQuestion(toolUseInput);
        }
        break;
      }

      case 'tool_result':
        this.emit('tool-result', message.part.output || '');
        break;

      case 'step_finish':
        if (message.part.reason === 'error') {
          if (!this.hasCompleted) {
            this.hasCompleted = true;
            this.emit('complete', {
              status: 'error',
              sessionId: this.currentSessionId || undefined,
              error: 'Task failed',
            });
          }
        } else if (
          (message.part.reason === 'stop' || message.part.reason === 'end_turn') &&
          !this.hasCompleted
        ) {
          this.hasCompleted = true;
          this.emit('complete', {
            status: 'success',
            sessionId: this.currentSessionId || undefined,
          });
        }
        break;

      case 'error':
        this.hasCompleted = true;
        this.emit('complete', {
          status: 'error',
          sessionId: this.currentSessionId || undefined,
          error: message.error,
        });
        break;
    }
  }

  private handleAskUserQuestion(input: unknown): void {
    const typedInput = input as {
      questions?: Array<{
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
    };

    const question = typedInput?.questions?.[0];
    if (!question) return;

    const permissionRequest: PermissionRequest = {
      id: this.generateRequestId(),
      type: 'question',
      question: question.question,
      options: question.options?.map((o) => o.label),
    };

    this.emit('permission-request', permissionRequest);
  }

  private handleProcessExit(code: number | null): void {
    this.ptyProcess = null;
    this.childProcess = null;

    if (this.wasInterrupted && code === 0 && !this.hasCompleted) {
      this.hasCompleted = true;
      this.emit('complete', {
        status: 'interrupted',
        sessionId: this.currentSessionId || undefined,
      });
      return;
    }

    if (!this.hasCompleted) {
      if (code === 0) {
        this.hasCompleted = true;
        this.emit('complete', {
          status: 'success',
          sessionId: this.currentSessionId || undefined,
        });
      } else if (code !== null) {
        this.emit('error', new Error(`OpenCode CLI exited with code ${code}`));
      }
    }
  }

  private cleanPtyOutput(data: string): string {
    return data
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences
      .replace(/\x1B\][^\x07]*\x07/g, '') // OSC with BEL
      .replace(/\x1B\][^\x1B]*\x1B\\/g, ''); // OSC with ST
  }

  private escapeShellArg(arg: string): string {
    if (process.platform === 'win32') {
      if (arg.includes(' ') || arg.includes('"')) {
        return `"${arg.replace(/"/g, '""')}"`;
      }
      return arg;
    } else {
      const needsEscaping = ["'", ' ', '$', '`', '\\', '"', '\n'].some((c) =>
        arg.includes(c)
      );
      if (needsEscaping) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }
  }

  private buildShellCommand(command: string, args: string[]): string {
    const escapedCommand = this.escapeShellArg(command);
    const escapedArgs = args.map((arg) => this.escapeShellArg(arg));

    if (process.platform === 'win32' && escapedCommand.startsWith('"')) {
      return ['&', escapedCommand, ...escapedArgs].join(' ');
    }

    return [escapedCommand, ...escapedArgs].join(' ');
  }

  private getPlatformShell(): string {
    if (process.platform === 'win32') {
      return 'powershell.exe';
    } else {
      // Use /bin/sh to avoid loading user shell configs
      return '/bin/sh';
    }
  }

  private getShellArgs(command: string): string[] {
    if (process.platform === 'win32') {
      const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
      return ['-NoProfile', '-EncodedCommand', encodedCommand];
    } else {
      return ['-c', command];
    }
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

function getOpenCodeAuthPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'opencode', 'auth.json');
  }
  return path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
}

function syncApiKeysToOpenCodeAuth(apiKeys: ApiKeys): { updatedProviders: string[] } {
  const authPath = getOpenCodeAuthPath();
  const authDir = path.dirname(authPath);
  const updatedProviders: string[] = [];

  try {
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
  } catch {
    return { updatedProviders };
  }

  let auth: Record<string, { type: string; key?: string }> = {};
  if (fs.existsSync(authPath)) {
    try {
      auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    } catch {
      auth = {};
    }
  }

  const maybeSet = (provider: string, key?: string) => {
    if (!key) return;
    if (!auth[provider] || auth[provider].key !== key) {
      auth[provider] = { type: 'api', key };
      updatedProviders.push(provider);
    }
  };

  maybeSet('openai', apiKeys.openai);
  maybeSet('anthropic', apiKeys.anthropic);
  maybeSet('openrouter', apiKeys.openrouter);
  maybeSet('google', apiKeys.google);
  maybeSet('xai', apiKeys.xai);
  maybeSet('deepseek', apiKeys.deepseek);
  maybeSet('litellm', apiKeys.litellm);
  maybeSet('ollama', apiKeys.ollama);

  if (updatedProviders.length > 0) {
    try {
      fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
    } catch {
      return { updatedProviders: [] };
    }
  }

  return { updatedProviders };
}

/**
 * Factory function to create a new adapter instance
 */
export function createAdapter(taskId?: string): OpenCodeAdapter {
  return new OpenCodeAdapter(taskId);
}
