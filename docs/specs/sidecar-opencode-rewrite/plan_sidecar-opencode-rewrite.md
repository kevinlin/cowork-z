# Sidecar Rewrite: From PTY-Based to OpenCode Server API

## Overview

This plan details a complete rewrite of the sidecar application from the current PTY-based `opencode run` approach to using the `opencode serve` HTTP API. The new sidecar (`sidecar-opencode`) will communicate with OpenCode via REST endpoints and Server-Sent Events (SSE), eliminating the complexity of NDJSON parsing and enabling native permission/question handling.

## Current State Analysis

### Current Architecture
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ PTY (NDJSON) ↔ opencode run
                                           ↓
                                  Bundled MCP Servers
                                  (file-permission, ask-user-question)
                                           ↓
                                  HTTP to localhost:3100/3101
                                  (ENDPOINTS NOT IMPLEMENTED!)
```

### Problems with Current Approach
1. **Complex NDJSON parsing** - Windows PTY fragmentation issues, ANSI escape stripping
2. **Bundled MCP servers broken** - HTTP endpoints for permission/question don't exist in Tauri
3. **Workaround for permissions** - `AskUserQuestion` tool detection in stream (fragile)
4. **Heavy config file generation** - Creates `opencode.json` for each task

### Key Discoveries
- **Current sidecar files**: [src-tauri/sidecar/src/](src-tauri/sidecar/src/) - 8 TypeScript files + tests
- **Bundled MCP servers**: [skills/](skills/) - 8 packages, most expect HTTP endpoints that don't exist
- **Rust manager**: [src-tauri/src/sidecar.rs](src-tauri/src/sidecar.rs) - `SidecarManager` spawns and communicates with Node.js sidecar
- **Custom agent**: "accomplish" agent with system prompt in [config-generator.ts:32-203](src-tauri/sidecar/src/config-generator.ts#L32-L203)

## Desired End State

### New Architecture
```
Tauri ↔ stdin/stdout (JSON-line) ↔ Node.js Sidecar ↔ HTTP/SSE ↔ opencode serve
                                           ↓
                                  - GET /event (SSE stream)
                                  - POST /session/{id}/message
                                  - POST /permission/{id}/reply
                                  - POST /question/{id}/reply
                                  - PATCH /config
```

### Key Benefits
1. **Clean HTTP/JSON protocol** - No NDJSON parsing, no ANSI stripping
2. **Native permission/question handling** - OpenCode's `/permission` and `/question` endpoints
3. **Runtime config updates** - `PATCH /config` for session-specific settings
4. **Proper server lifecycle** - Health checks, graceful shutdown, process management
5. **Comprehensive logging** - All server events logged to `~/.opencode/` files

### Verification Criteria
- [ ] `opencode serve` process starts on port 4096 (configurable)
- [ ] Sessions can be created, resumed, and aborted
- [ ] Messages stream correctly via SSE events
- [ ] Permission requests show in UI and responses work
- [ ] Question requests show in UI and responses work
- [ ] All events logged to timestamped log files
- [ ] Old sidecar and skills folders deleted

## What We're NOT Doing

1. **Browser automation MCP** - `dev-browser-mcp` is out of scope; can be added later via PATCH /config
2. **Multiple concurrent servers** - Single `opencode serve` instance per app
3. **Custom agent migration** - The "accomplish" agent prompt moves to PATCH /config, not a separate config file
4. **Backward compatibility layer** - Clean break from old sidecar

## Implementation Approach

The rewrite follows a layered approach:
1. Build the new sidecar as a separate package (`sidecar-opencode`)
2. Implement HTTP client and SSE handling
3. Add process management for `opencode serve`
4. Update Rust backend to use new IPC protocol
5. Remove old sidecar and bundled MCPs

---

## Phase 1: Foundation - Create sidecar-opencode Package

### Overview
Create the new TypeScript package with HTTP client, SSE handling, and IPC protocol definitions.

### Changes Required

#### 1. New Package Structure
**Directory**: `src-tauri/sidecar-opencode/`

```
src-tauri/sidecar-opencode/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # IPC entry point (stdin/stdout JSON-line)
│   ├── types.ts              # TypeScript types for OpenCode API + IPC
│   ├── opencode-client.ts    # HTTP client for OpenCode server
│   ├── event-stream.ts       # SSE event stream handler
│   ├── session-manager.ts    # Session lifecycle management
│   ├── config-builder.ts     # Runtime config generation for PATCH /config
│   ├── process-manager.ts    # Spawn/manage opencode serve process
│   └── logger.ts             # File logging to ~/.opencode/
└── __tests__/
    ├── opencode-client.test.ts
    └── session-manager.test.ts
```

#### 2. Package Configuration
**File**: `src-tauri/sidecar-opencode/package.json`

```json
{
  "name": "sidecar-opencode",
  "version": "0.1.0",
  "description": "OpenCode server sidecar for Cowork Z",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "jest",
    "build:binary": "pnpm build && pkg dist/index.js --targets node20-macos-arm64 --output ../binaries/sidecar-opencode-aarch64-apple-darwin"
  },
  "dependencies": {
    "eventsource": "^2.0.2"
  },
  "devDependencies": {
    "@types/eventsource": "^1.1.15",
    "@types/node": "^20.0.0",
    "typescript": "^5.8.0",
    "tsx": "^4.0.0",
    "@yao-pkg/pkg": "^5.15.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0"
  }
}
```

#### 3. TypeScript Types
**File**: `src-tauri/sidecar-opencode/src/types.ts`

```typescript
// ============================================================================
// OpenCode Server API Types (from opencode-api.json)
// ============================================================================

export interface Session {
  id: string;  // Pattern: ^ses.*
  slug: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  version: string;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
  permission?: PermissionRuleset;
}

export interface SessionStatus {
  type: 'idle' | 'busy' | 'retry';
  attempt?: number;
  message?: string;
  next?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  // ... additional fields
}

export interface Part {
  type: string;
  // Union of TextPart, ToolPart, etc.
}

export interface PermissionRequest {
  id: string;  // Pattern: ^per.*
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionRequest {
  id: string;  // Pattern: ^que.*
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionInfo {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionAnswer {
  labels: string[];
  customText?: string;
}

export type PermissionAction = 'ask' | 'allow' | 'deny';

export interface PermissionConfig {
  read?: PermissionRuleConfig;
  edit?: PermissionRuleConfig;
  bash?: PermissionRuleConfig;
  external_directory?: PermissionRuleConfig;
  doom_loop?: PermissionAction;
  // ... other permission types
}

export type PermissionRuleConfig = PermissionAction | Record<string, PermissionAction>;
export type PermissionRuleset = PermissionRule[];

export interface PermissionRule {
  // Rule definition
}

export interface Config {
  $schema?: string;
  model?: string;
  default_agent?: string;
  enabled_providers?: string[];
  permission?: PermissionConfig;
  agent?: Record<string, AgentConfig>;
  mcp?: Record<string, McpConfig>;
  // ... other config fields
}

export interface AgentConfig {
  model?: string;
  prompt?: string;
  description?: string;
  mode?: 'primary' | 'subagent' | 'all';
  permission?: PermissionConfig;
}

export interface McpConfig {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  timeout?: number;
}

export interface HealthResponse {
  healthy: true;
  version: string;
}

// ============================================================================
// OpenCode Server Events (SSE)
// ============================================================================

export type OpenCodeEvent =
  | { type: 'session.status'; properties: { session: Session; status: SessionStatus } }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | { type: 'session.created'; properties: { session: Session } }
  | { type: 'session.updated'; properties: { session: Session } }
  | { type: 'session.deleted'; properties: { sessionID: string } }
  | { type: 'session.error'; properties: { sessionID: string; error: string } }
  | { type: 'message.updated'; properties: { message: Message; sessionID: string } }
  | { type: 'message.part.updated'; properties: { part: Part; delta?: string; sessionID: string; messageID: string } }
  | { type: 'permission.asked'; properties: PermissionRequest }
  | { type: 'permission.replied'; properties: { id: string; reply: string } }
  | { type: 'question.asked'; properties: QuestionRequest }
  | { type: 'question.replied'; properties: { id: string; answers: QuestionAnswer[] } }
  | { type: 'question.rejected'; properties: { id: string } }
  | { type: 'server.connected'; properties: Record<string, never> }
  | { type: 'global.disposed'; properties: Record<string, never> };

// ============================================================================
// IPC Protocol (Tauri ↔ Sidecar)
// ============================================================================

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  xai?: string;
  deepseek?: string;
  openrouter?: string;
  litellm?: string;
  ollama?: string;
  bedrock?: BedrockCredentials;
}

export interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// Commands from Tauri to Sidecar
export type SidecarCommand =
  | { type: 'start_task'; taskId: string; payload: StartTaskPayload }
  | { type: 'resume_session'; taskId: string; payload: ResumeSessionPayload }
  | { type: 'cancel_task'; taskId: string }
  | { type: 'abort_session'; taskId: string; sessionId: string }
  | { type: 'send_permission_reply'; taskId: string; payload: PermissionReplyPayload }
  | { type: 'send_question_reply'; taskId: string; payload: QuestionReplyPayload }
  | { type: 'ping' }
  | { type: 'check_server' };

export interface StartTaskPayload {
  taskId: string;
  prompt: string;
  apiKeys?: ApiKeys;
  workingDirectory?: string;
  modelId?: string;
  folders?: string[];
}

export interface ResumeSessionPayload {
  taskId: string;
  sessionId: string;
  prompt?: string;
  apiKeys?: ApiKeys;
  workingDirectory?: string;
  modelId?: string;
  folders?: string[];
}

export interface PermissionReplyPayload {
  requestId: string;
  reply: 'once' | 'always' | 'reject';
  message?: string;
}

export interface QuestionReplyPayload {
  requestId: string;
  answers: QuestionAnswer[];
}

// Events from Sidecar to Tauri
export type SidecarEvent =
  | { type: 'ready'; payload: ReadyPayload }
  | { type: 'pong'; payload: { timestamp: number } }
  | { type: 'server_status'; payload: ServerStatusPayload }
  | { type: 'task_started'; taskId: string; payload: TaskStartedPayload }
  | { type: 'task_message'; taskId: string; payload: TaskMessagePayload }
  | { type: 'task_message_partial'; taskId: string; payload: TaskMessagePartialPayload }
  | { type: 'task_message_complete'; taskId: string; payload: TaskMessageCompletePayload }
  | { type: 'task_progress'; taskId: string; payload: TaskProgressPayload }
  | { type: 'permission_request'; taskId: string; payload: PermissionRequestPayload }
  | { type: 'question_request'; taskId: string; payload: QuestionRequestPayload }
  | { type: 'task_complete'; taskId: string; payload: TaskCompletePayload }
  | { type: 'task_error'; taskId: string; payload: TaskErrorPayload }
  | { type: 'log'; payload: LogPayload }
  | { type: 'error'; payload: ErrorPayload };

export interface ReadyPayload {
  version: string;
  serverAvailable: boolean;
  serverVersion?: string;
}

export interface ServerStatusPayload {
  running: boolean;
  port?: number;
  version?: string;
}

export interface TaskStartedPayload {
  taskId: string;
  sessionId: string;
}

export interface TaskMessagePayload {
  message: Message;
  parts: Part[];
}

export interface TaskMessagePartialPayload {
  messageId: string;
  partId: string;
  textSoFar: string;
  delta?: string;
  isStreaming: boolean;
}

export interface TaskMessageCompletePayload {
  messageId: string;
  text: string;
}

export interface TaskProgressPayload {
  stage: 'starting' | 'connecting' | 'configuring' | 'executing' | 'completing';
  message?: string;
}

export interface PermissionRequestPayload {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
}

export interface QuestionRequestPayload {
  id: string;
  sessionId: string;
  questions: QuestionInfo[];
}

export interface TaskCompletePayload {
  status: 'success' | 'error' | 'cancelled' | 'aborted';
  sessionId?: string;
  error?: string;
}

export interface TaskErrorPayload {
  error: string;
  sessionId?: string;
}

export interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface ErrorPayload {
  message: string;
}
```

#### 4. Logger Module
**File**: `src-tauri/sidecar-opencode/src/logger.ts`

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class Logger {
  private logFile: fs.WriteStream | null = null;
  private logDir: string;
  private sessionId?: string;
  private taskId?: string;

  constructor() {
    this.logDir = path.join(os.homedir(), '.opencode');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  startSession(sessionId?: string, taskId?: string): void {
    this.sessionId = sessionId;
    this.taskId = taskId;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parts = [timestamp];
    if (sessionId) parts.push(sessionId);
    if (taskId) parts.push(taskId);

    const filename = `${parts.join('_')}.log`;
    const filepath = path.join(this.logDir, filename);

    this.logFile = fs.createWriteStream(filepath, { flags: 'a' });
    this.info(`Log started: ${filepath}`);
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
  }

  private write(level: string, message: string, data?: unknown): void {
    const timestamp = this.formatTimestamp();
    const line = data
      ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] [${level}] ${message}`;

    if (this.logFile) {
      this.logFile.write(line + '\n');
    }

    // Also write to stderr for debugging
    console.error(line);
  }

  debug(message: string, data?: unknown): void {
    this.write('DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write('INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write('WARN', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('ERROR', message, data);
  }

  // Log raw OpenCode server event
  serverEvent(event: unknown): void {
    this.write('EVENT', 'OpenCode Server Event', event);
  }

  // Log raw HTTP response
  httpResponse(method: string, path: string, status: number, body?: unknown): void {
    this.write('HTTP', `${method} ${path} -> ${status}`, body);
  }

  close(): void {
    if (this.logFile) {
      this.write('INFO', 'Log closed');
      this.logFile.end();
      this.logFile = null;
    }
  }
}

export const logger = new Logger();
```

### Success Criteria

#### Automated Verification:
- [x] Package builds without errors: `cd src-tauri/sidecar-opencode && pnpm build`
- [x] TypeScript compilation passes: `pnpm typecheck`
- [x] Package.json has correct dependencies and scripts

#### Manual Verification:
- [ ] Directory structure matches specification
- [ ] Types accurately reflect OpenCode API spec

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 2: OpenCode HTTP Client & Process Management

### Overview
Implement the HTTP client for OpenCode server API and process management for spawning/terminating `opencode serve`.

### Changes Required

#### 1. OpenCode HTTP Client
**File**: `src-tauri/sidecar-opencode/src/opencode-client.ts`

```typescript
import type {
  Config,
  HealthResponse,
  Session,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswer,
} from './types.js';
import { logger } from './logger.js';

export interface OpenCodeClientOptions {
  baseUrl?: string;
  port?: number;
  timeout?: number;
}

export class OpenCodeClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: OpenCodeClientOptions = {}) {
    const port = options.port || 4096;
    this.baseUrl = options.baseUrl || `http://127.0.0.1:${port}`;
    this.timeout = options.timeout || 30000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const responseBody = await response.json().catch(() => null);
      logger.httpResponse(method, path, response.status, responseBody);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(responseBody)}`);
      }

      return responseBody as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // Health & Server Management
  // ============================================================================

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/global/health');
  }

  async isServerRunning(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  async disposeGlobal(): Promise<boolean> {
    return this.request<boolean>('POST', '/global/dispose');
  }

  async disposeInstance(directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', '/instance/dispose', undefined,
      directory ? { directory } : undefined);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async getConfig(directory?: string): Promise<Config> {
    return this.request<Config>('GET', '/config', undefined,
      directory ? { directory } : undefined);
  }

  async updateConfig(config: Partial<Config>, directory?: string): Promise<Config> {
    return this.request<Config>('PATCH', '/config', config,
      directory ? { directory } : undefined);
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  async listSessions(options?: {
    directory?: string;
    roots?: boolean;
    limit?: number;
  }): Promise<Session[]> {
    const params: Record<string, string> = {};
    if (options?.directory) params.directory = options.directory;
    if (options?.roots) params.roots = 'true';
    if (options?.limit) params.limit = String(options.limit);
    return this.request<Session[]>('GET', '/session', undefined, params);
  }

  async createSession(options?: {
    directory?: string;
    parentID?: string;
    title?: string;
    permission?: unknown;
  }): Promise<Session> {
    const params = options?.directory ? { directory: options.directory } : undefined;
    const body = {
      parentID: options?.parentID,
      title: options?.title,
      permission: options?.permission,
    };
    return this.request<Session>('POST', '/session', body, params);
  }

  async getSession(sessionId: string, directory?: string): Promise<Session> {
    return this.request<Session>('GET', `/session/${sessionId}`, undefined,
      directory ? { directory } : undefined);
  }

  async deleteSession(sessionId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('DELETE', `/session/${sessionId}`, undefined,
      directory ? { directory } : undefined);
  }

  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/session/${sessionId}/abort`, undefined,
      directory ? { directory } : undefined);
  }

  // ============================================================================
  // Messages
  // ============================================================================

  async getMessages(
    sessionId: string,
    options?: { directory?: string; limit?: number }
  ): Promise<Array<{ info: Message; parts: Part[] }>> {
    const params: Record<string, string> = {};
    if (options?.directory) params.directory = options.directory;
    if (options?.limit) params.limit = String(options.limit);
    return this.request('GET', `/session/${sessionId}/message`, undefined, params);
  }

  async sendMessage(
    sessionId: string,
    options: {
      parts: Array<{ type: 'text'; text: string }>;
      directory?: string;
      model?: { providerID: string; modelID: string };
      agent?: string;
    }
  ): Promise<{ info: Message; parts: Part[] }> {
    const params = options.directory ? { directory: options.directory } : undefined;
    return this.request('POST', `/session/${sessionId}/message`, {
      parts: options.parts,
      model: options.model,
      agent: options.agent,
    }, params);
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async listPermissions(directory?: string): Promise<PermissionRequest[]> {
    return this.request<PermissionRequest[]>('GET', '/permission', undefined,
      directory ? { directory } : undefined);
  }

  async replyToPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    options?: { directory?: string; message?: string }
  ): Promise<boolean> {
    const params = options?.directory ? { directory: options.directory } : undefined;
    return this.request<boolean>('POST', `/permission/${requestId}/reply`, {
      reply,
      message: options?.message,
    }, params);
  }

  // ============================================================================
  // Questions
  // ============================================================================

  async listQuestions(directory?: string): Promise<QuestionRequest[]> {
    return this.request<QuestionRequest[]>('GET', '/question', undefined,
      directory ? { directory } : undefined);
  }

  async replyToQuestion(
    requestId: string,
    answers: QuestionAnswer[],
    directory?: string
  ): Promise<boolean> {
    return this.request<boolean>('POST', `/question/${requestId}/reply`, { answers },
      directory ? { directory } : undefined);
  }

  async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/question/${requestId}/reject`, undefined,
      directory ? { directory } : undefined);
  }
}
```

#### 2. Process Manager
**File**: `src-tauri/sidecar-opencode/src/process-manager.ts`

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import { OpenCodeClient } from './opencode-client.js';
import { logger } from './logger.js';
import type { ApiKeys } from './types.js';

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
    this.port = options.port || 4096;
    this.hostname = options.hostname || '127.0.0.1';
    this.cliPath = options.cliPath || 'opencode';
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

    const args = [
      'serve',
      '--port', String(this.port),
      '--hostname', this.hostname,
    ];

    this.process = spawn(this.cliPath, args, {
      env,
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
```

### Success Criteria

#### Automated Verification:
- [ ] HTTP client compiles: `pnpm build`
- [ ] Unit tests pass: `pnpm test`

#### Manual Verification:
- [ ] Can detect running OpenCode server via health endpoint
- [ ] Can terminate existing server via dispose endpoint
- [ ] Can start new `opencode serve` process
- [ ] Server stdout/stderr logged correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 3: SSE Event Stream & Session Management

### Overview
Implement Server-Sent Events handling for real-time updates and session lifecycle management.

### Changes Required

#### 1. Event Stream Handler
**File**: `src-tauri/sidecar-opencode/src/event-stream.ts`

```typescript
import EventSource from 'eventsource';
import { EventEmitter } from 'node:events';
import type { OpenCodeEvent } from './types.js';
import { logger } from './logger.js';

export interface EventStreamOptions {
  baseUrl: string;
  directory?: string;
  reconnectInterval?: number;
}

export class EventStream extends EventEmitter {
  private eventSource: EventSource | null = null;
  private baseUrl: string;
  private directory?: string;
  private reconnectInterval: number;
  private isConnected = false;
  private shouldReconnect = true;

  constructor(options: EventStreamOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.directory = options.directory;
    this.reconnectInterval = options.reconnectInterval || 5000;
  }

  connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const url = new URL('/event', this.baseUrl);
    if (this.directory) {
      url.searchParams.set('directory', this.directory);
    }

    logger.info(`Connecting to SSE stream: ${url.toString()}`);

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      logger.info('SSE stream connected');
      this.isConnected = true;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as OpenCodeEvent;
        logger.serverEvent(data);
        this.emit('event', data);
        this.emit(data.type, data.properties);
      } catch (error) {
        logger.error('Failed to parse SSE event', { data: event.data, error });
      }
    };

    this.eventSource.onerror = (error) => {
      logger.error('SSE stream error', error);
      this.isConnected = false;
      this.emit('error', error);

      if (this.shouldReconnect) {
        logger.info(`Reconnecting in ${this.reconnectInterval}ms...`);
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    logger.info('SSE stream disconnected');
  }

  isActive(): boolean {
    return this.isConnected;
  }
}
```

#### 2. Config Builder
**File**: `src-tauri/sidecar-opencode/src/config-builder.ts`

```typescript
import type { Config, AgentConfig, PermissionConfig, PermissionAction } from './types.js';

/**
 * Platform-specific environment instructions for the agent
 */
function getPlatformEnvironmentInstructions(): string {
  if (process.platform === 'win32') {
    return `<environment>
**You are running on Windows.** Use Windows-compatible commands:
- Use PowerShell syntax, not bash/Unix syntax
- Use \`$env:TEMP\` for temp directory (not /tmp)
- Use semicolon (;) for PATH separator (not colon)
- Use \`$env:VAR\` for environment variables (not $VAR)
</environment>`;
  }
  return `<environment>
You are running on ${process.platform === 'darwin' ? 'macOS' : 'Linux'}.
</environment>`;
}

/**
 * System prompt for the Accomplish agent
 */
const ACCOMPLISH_SYSTEM_PROMPT = `<identity>
You are Cowork-Z, a general-purpose desktop agent that helps users complete tasks on their computer.
</identity>

${getPlatformEnvironmentInstructions()}

<capabilities>
When users ask about your capabilities, mention:
- **System & Workflow Automation**: Perform multi-step tasks reliably with verification after each step.
- **File & Project Organization**: Create, edit, move, and organize files and folders as needed for the task.
</capabilities>

<behavior name="task-planning">
**TASK PLANNING - REQUIRED FOR EVERY TASK**

Before taking ANY action, you MUST first output a plan:

1. **State the goal** - What the user wants accomplished
2. **List steps with verification** - Numbered steps, each with a completion criterion

Format:
**Plan:**
Goal: [what user asked for]

Steps:
1. [Action] → verify: [how to confirm it's done]
2. [Action] → verify: [how to confirm it's done]
...

Then execute the steps.
</behavior>

<behavior>
- Use AskUserQuestion tool for clarifying questions before starting ambiguous tasks
- After each action, evaluate the result before deciding next steps

**DO NOT ASK FOR PERMISSION TO CONTINUE:**
If the user gave you a task with specific criteria:
- Keep working until you meet those criteria
- Do NOT pause to ask "Would you like me to continue?"
- Just continue working until the task requirements are met
</behavior>
`;

export interface ConfigBuilderOptions {
  modelId?: string;
  folders?: string[];
  enabledProviders?: string[];
}

export function buildSessionConfig(options: ConfigBuilderOptions = {}): Partial<Config> {
  // Build permission config based on allowed folders
  const permissionConfig: PermissionConfig = {
    doom_loop: 'deny' as PermissionAction,
  };

  if (options.folders && options.folders.length > 0) {
    const folderPermissions: Record<string, PermissionAction> = {};
    for (const folder of options.folders) {
      folderPermissions[folder] = 'allow';
    }
    permissionConfig.external_directory = folderPermissions;
    permissionConfig.edit = folderPermissions;
    permissionConfig.read = folderPermissions;
  }

  // Build agent config
  const agentConfig: Record<string, AgentConfig> = {
    accomplish: {
      description: 'General-purpose desktop automation assistant',
      prompt: ACCOMPLISH_SYSTEM_PROMPT,
      mode: 'primary',
    },
  };

  const config: Partial<Config> = {
    default_agent: 'accomplish',
    permission: permissionConfig,
    agent: agentConfig,
  };

  // Set model if provided
  if (options.modelId) {
    config.model = options.modelId;
  }

  // Set enabled providers
  if (options.enabledProviders) {
    config.enabled_providers = options.enabledProviders;
  }

  return config;
}
```

#### 3. Session Manager
**File**: `src-tauri/sidecar-opencode/src/session-manager.ts`

```typescript
import { EventEmitter } from 'node:events';
import type { OpenCodeClient } from './opencode-client.js';
import type { EventStream } from './event-stream.js';
import { buildSessionConfig } from './config-builder.js';
import { logger } from './logger.js';
import type {
  Session,
  OpenCodeEvent,
  StartTaskPayload,
  ResumeSessionPayload,
  PermissionRequest,
  QuestionRequest,
} from './types.js';

interface ManagedSession {
  taskId: string;
  sessionId: string;
  session: Session;
  status: 'starting' | 'active' | 'completing' | 'completed' | 'error';
  currentMessageId?: string;
  textAccumulator: string;
}

export class SessionManager extends EventEmitter {
  private client: OpenCodeClient;
  private eventStream: EventStream;
  private sessions: Map<string, ManagedSession> = new Map();
  private sessionToTask: Map<string, string> = new Map();

  constructor(client: OpenCodeClient, eventStream: EventStream) {
    super();
    this.client = client;
    this.eventStream = eventStream;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Session status updates
    this.eventStream.on('session.status', (props: { session: Session; status: { type: string } }) => {
      const taskId = this.sessionToTask.get(props.session.id);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      logger.debug('Session status update', { sessionId: props.session.id, status: props.status });

      if (props.status.type === 'idle') {
        this.handleSessionIdle(managed);
      } else if (props.status.type === 'busy') {
        managed.status = 'active';
        this.emit('progress', {
          taskId,
          stage: 'executing',
        });
      }
    });

    // Message updates
    this.eventStream.on('message.updated', (props: { message: { id: string; role: string }; sessionID: string }) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      if (props.message.role === 'assistant') {
        managed.currentMessageId = props.message.id;
        this.emit('message', {
          taskId,
          message: props.message,
        });
      }
    });

    // Message part updates (streaming)
    this.eventStream.on('message.part.updated', (props: { part: { type: string; text?: string }; delta?: string; sessionID: string; messageID: string }) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      if (props.part.type === 'text' && props.delta) {
        managed.textAccumulator += props.delta;
        this.emit('message-partial', {
          taskId,
          messageId: props.messageID,
          textSoFar: managed.textAccumulator,
          delta: props.delta,
          isStreaming: true,
        });
      } else if (props.part.type === 'tool') {
        this.emit('tool-use', {
          taskId,
          messageId: props.messageID,
          part: props.part,
        });
      }
    });

    // Permission requests
    this.eventStream.on('permission.asked', (props: PermissionRequest) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      logger.info('Permission request received', props);
      this.emit('permission-request', {
        taskId,
        id: props.id,
        sessionId: props.sessionID,
        permission: props.permission,
        patterns: props.patterns,
        metadata: props.metadata,
      });
    });

    // Question requests
    this.eventStream.on('question.asked', (props: QuestionRequest) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      logger.info('Question request received', props);
      this.emit('question-request', {
        taskId,
        id: props.id,
        sessionId: props.sessionID,
        questions: props.questions,
      });
    });

    // Session errors
    this.eventStream.on('session.error', (props: { sessionID: string; error: string }) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      logger.error('Session error', props);
      managed.status = 'error';
      this.emit('error', {
        taskId,
        error: props.error,
        sessionId: props.sessionID,
      });
    });
  }

  private handleSessionIdle(managed: ManagedSession): void {
    if (managed.status === 'active') {
      // Finalize any accumulated text
      if (managed.textAccumulator && managed.currentMessageId) {
        this.emit('message-complete', {
          taskId: managed.taskId,
          messageId: managed.currentMessageId,
          text: managed.textAccumulator,
        });
      }

      managed.status = 'completed';
      managed.textAccumulator = '';
      managed.currentMessageId = undefined;

      this.emit('complete', {
        taskId: managed.taskId,
        sessionId: managed.sessionId,
        status: 'success',
      });
    }
  }

  async startTask(payload: StartTaskPayload): Promise<void> {
    const { taskId, prompt, workingDirectory, modelId, folders } = payload;

    logger.info('Starting task', { taskId, prompt: prompt.slice(0, 100) });

    // Push session-specific config via PATCH /config
    const config = buildSessionConfig({ modelId, folders });
    await this.client.updateConfig(config, workingDirectory);
    logger.info('Config updated for session', config);

    this.emit('progress', { taskId, stage: 'configuring' });

    // Create new session
    const session = await this.client.createSession({
      directory: workingDirectory,
      title: prompt.slice(0, 50),
    });

    const managed: ManagedSession = {
      taskId,
      sessionId: session.id,
      session,
      status: 'starting',
      textAccumulator: '',
    };

    this.sessions.set(taskId, managed);
    this.sessionToTask.set(session.id, taskId);

    logger.info('Session created', { taskId, sessionId: session.id });

    this.emit('started', { taskId, sessionId: session.id });
    this.emit('progress', { taskId, stage: 'executing' });

    // Send the initial message
    managed.status = 'active';
    await this.client.sendMessage(session.id, {
      parts: [{ type: 'text', text: prompt }],
      directory: workingDirectory,
      agent: 'accomplish',
    });
  }

  async resumeSession(payload: ResumeSessionPayload): Promise<void> {
    const { taskId, sessionId, prompt, workingDirectory, modelId, folders } = payload;

    logger.info('Resuming session', { taskId, sessionId });

    // Push session-specific config via PATCH /config
    const config = buildSessionConfig({ modelId, folders });
    await this.client.updateConfig(config, workingDirectory);

    this.emit('progress', { taskId, stage: 'configuring' });

    // Get existing session
    const session = await this.client.getSession(sessionId, workingDirectory);

    const managed: ManagedSession = {
      taskId,
      sessionId,
      session,
      status: 'starting',
      textAccumulator: '',
    };

    this.sessions.set(taskId, managed);
    this.sessionToTask.set(sessionId, taskId);

    this.emit('started', { taskId, sessionId });
    this.emit('progress', { taskId, stage: 'executing' });

    // Send follow-up message if provided
    if (prompt) {
      managed.status = 'active';
      await this.client.sendMessage(sessionId, {
        parts: [{ type: 'text', text: prompt }],
        directory: workingDirectory,
        agent: 'accomplish',
      });
    }
  }

  async abortSession(taskId: string, sessionId: string): Promise<void> {
    logger.info('Aborting session', { taskId, sessionId });

    const managed = this.sessions.get(taskId);
    if (managed) {
      managed.status = 'completing';
    }

    await this.client.abortSession(sessionId);

    this.emit('complete', {
      taskId,
      sessionId,
      status: 'aborted',
    });

    this.cleanup(taskId);
  }

  async replyToPermission(
    taskId: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message?: string
  ): Promise<void> {
    logger.info('Replying to permission', { taskId, requestId, reply });
    await this.client.replyToPermission(requestId, reply, { message });
  }

  async replyToQuestion(
    taskId: string,
    requestId: string,
    answers: Array<{ labels: string[]; customText?: string }>
  ): Promise<void> {
    logger.info('Replying to question', { taskId, requestId, answers });
    await this.client.replyToQuestion(requestId, answers);
  }

  private cleanup(taskId: string): void {
    const managed = this.sessions.get(taskId);
    if (managed) {
      this.sessionToTask.delete(managed.sessionId);
      this.sessions.delete(taskId);
    }
  }

  dispose(): void {
    this.sessions.clear();
    this.sessionToTask.clear();
    this.removeAllListeners();
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] All modules compile: `pnpm build`
- [ ] Unit tests pass: `pnpm test`

#### Manual Verification:
- [ ] SSE events received and parsed correctly
- [ ] Session can be created and messages sent
- [ ] Config pushed via PATCH /config before session start
- [ ] Permission/question events forwarded correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 4: IPC Entry Point & Integration

### Overview
Implement the main entry point that handles Tauri ↔ Sidecar communication and wires everything together.

### Changes Required

#### 1. Main Entry Point
**File**: `src-tauri/sidecar-opencode/src/index.ts`

```typescript
import readline from 'node:readline';
import { ProcessManager } from './process-manager.js';
import { EventStream } from './event-stream.js';
import { SessionManager } from './session-manager.js';
import { logger } from './logger.js';
import type {
  SidecarCommand,
  SidecarEvent,
  StartTaskPayload,
  ResumeSessionPayload,
  PermissionReplyPayload,
  QuestionReplyPayload,
  ApiKeys,
} from './types.js';

const SIDECAR_VERSION = '0.2.0';
const OPENCODE_PORT = 4096;

// ============================================================================
// IPC Communication
// ============================================================================

function send(event: SidecarEvent): void {
  console.log(JSON.stringify(event));
}

function sendLog(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  send({ type: 'log', payload: { level, message } });
}

// ============================================================================
// State
// ============================================================================

let processManager: ProcessManager | null = null;
let eventStream: EventStream | null = null;
let sessionManager: SessionManager | null = null;
let currentApiKeys: ApiKeys | undefined;

// ============================================================================
// Initialization
// ============================================================================

async function initialize(apiKeys?: ApiKeys): Promise<void> {
  if (processManager) {
    return; // Already initialized
  }

  currentApiKeys = apiKeys;

  // Start process manager
  processManager = new ProcessManager({ port: OPENCODE_PORT });
  await processManager.ensureServerRunning(apiKeys);

  // Start event stream
  eventStream = new EventStream({
    baseUrl: `http://127.0.0.1:${OPENCODE_PORT}`,
  });

  // Initialize session manager
  sessionManager = new SessionManager(
    processManager.getClient(),
    eventStream
  );

  // Wire up session manager events to IPC
  sessionManager.on('started', (data: { taskId: string; sessionId: string }) => {
    send({
      type: 'task_started',
      taskId: data.taskId,
      payload: { taskId: data.taskId, sessionId: data.sessionId },
    });
  });

  sessionManager.on('progress', (data: { taskId: string; stage: string; message?: string }) => {
    send({
      type: 'task_progress',
      taskId: data.taskId,
      payload: { stage: data.stage as any, message: data.message },
    });
  });

  sessionManager.on('message-partial', (data: { taskId: string; messageId: string; textSoFar: string; delta?: string; isStreaming: boolean }) => {
    send({
      type: 'task_message_partial',
      taskId: data.taskId,
      payload: {
        messageId: data.messageId,
        partId: 'text',
        textSoFar: data.textSoFar,
        delta: data.delta,
        isStreaming: data.isStreaming,
      },
    });
  });

  sessionManager.on('message-complete', (data: { taskId: string; messageId: string; text: string }) => {
    send({
      type: 'task_message_complete',
      taskId: data.taskId,
      payload: { messageId: data.messageId, text: data.text },
    });
  });

  sessionManager.on('permission-request', (data: { taskId: string; id: string; sessionId: string; permission: string; patterns: string[]; metadata: Record<string, unknown> }) => {
    send({
      type: 'permission_request',
      taskId: data.taskId,
      payload: {
        id: data.id,
        sessionId: data.sessionId,
        permission: data.permission,
        patterns: data.patterns,
        metadata: data.metadata,
      },
    });
  });

  sessionManager.on('question-request', (data: { taskId: string; id: string; sessionId: string; questions: any[] }) => {
    send({
      type: 'question_request',
      taskId: data.taskId,
      payload: {
        id: data.id,
        sessionId: data.sessionId,
        questions: data.questions,
      },
    });
  });

  sessionManager.on('complete', (data: { taskId: string; sessionId: string; status: string }) => {
    send({
      type: 'task_complete',
      taskId: data.taskId,
      payload: {
        status: data.status as any,
        sessionId: data.sessionId,
      },
    });
  });

  sessionManager.on('error', (data: { taskId: string; error: string; sessionId?: string }) => {
    send({
      type: 'task_error',
      taskId: data.taskId,
      payload: { error: data.error, sessionId: data.sessionId },
    });
  });

  // Connect event stream
  eventStream.connect();
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleStartTask(taskId: string, payload: StartTaskPayload): Promise<void> {
  try {
    // Ensure initialized with API keys
    await initialize(payload.apiKeys);

    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.startTask(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start task', { taskId, error: message });
    send({
      type: 'task_error',
      taskId,
      payload: { error: message },
    });
  }
}

async function handleResumeSession(taskId: string, payload: ResumeSessionPayload): Promise<void> {
  try {
    await initialize(payload.apiKeys);

    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.resumeSession(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to resume session', { taskId, error: message });
    send({
      type: 'task_error',
      taskId,
      payload: { error: message },
    });
  }
}

async function handleCancelTask(taskId: string): Promise<void> {
  sendLog('info', `Cancel not supported in server mode, use abort_session instead`);
}

async function handleAbortSession(taskId: string, sessionId: string): Promise<void> {
  try {
    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.abortSession(taskId, sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to abort session', { taskId, sessionId, error: message });
    send({
      type: 'task_error',
      taskId,
      payload: { error: message },
    });
  }
}

async function handlePermissionReply(taskId: string, payload: PermissionReplyPayload): Promise<void> {
  try {
    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.replyToPermission(taskId, payload.requestId, payload.reply, payload.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to reply to permission', { taskId, error: message });
  }
}

async function handleQuestionReply(taskId: string, payload: QuestionReplyPayload): Promise<void> {
  try {
    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.replyToQuestion(taskId, payload.requestId, payload.answers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to reply to question', { taskId, error: message });
  }
}

async function handleCheckServer(): Promise<void> {
  try {
    if (!processManager) {
      send({
        type: 'server_status',
        payload: { running: false },
      });
      return;
    }

    const client = processManager.getClient();
    const health = await client.health();
    send({
      type: 'server_status',
      payload: {
        running: true,
        port: OPENCODE_PORT,
        version: health.version,
      },
    });
  } catch {
    send({
      type: 'server_status',
      payload: { running: false },
    });
  }
}

// ============================================================================
// Message Router
// ============================================================================

async function handleMessage(msg: SidecarCommand): Promise<void> {
  logger.debug('Received command', msg);

  switch (msg.type) {
    case 'start_task':
      await handleStartTask(msg.taskId, msg.payload);
      break;

    case 'resume_session':
      await handleResumeSession(msg.taskId, msg.payload);
      break;

    case 'cancel_task':
      await handleCancelTask(msg.taskId);
      break;

    case 'abort_session':
      await handleAbortSession(msg.taskId, msg.sessionId);
      break;

    case 'send_permission_reply':
      await handlePermissionReply(msg.taskId, msg.payload);
      break;

    case 'send_question_reply':
      await handleQuestionReply(msg.taskId, msg.payload);
      break;

    case 'ping':
      send({ type: 'pong', payload: { timestamp: Date.now() } });
      break;

    case 'check_server':
      await handleCheckServer();
      break;

    default:
      logger.warn('Unknown command type', msg);
  }
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(): Promise<void> {
  logger.info('Cleaning up...');

  if (sessionManager) {
    sessionManager.dispose();
    sessionManager = null;
  }

  if (eventStream) {
    eventStream.disconnect();
    eventStream = null;
  }

  if (processManager) {
    await processManager.stopServer();
    processManager = null;
  }

  logger.close();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  logger.startSession();
  logger.info(`Sidecar-OpenCode v${SIDECAR_VERSION} starting...`);

  // Set up stdin reader
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.parse(line) as SidecarCommand;
      await handleMessage(msg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse command', { line, error: message });
      send({
        type: 'error',
        payload: { message: `Failed to parse command: ${message}` },
      });
    }
  });

  rl.on('close', () => {
    logger.info('stdin closed, cleaning up...');
    cleanup().then(() => process.exit(0));
  });

  // Handle signals
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  // Send ready event
  send({
    type: 'ready',
    payload: {
      version: SIDECAR_VERSION,
      serverAvailable: false, // Will be true after first task starts
    },
  });
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
```

### Success Criteria

#### Automated Verification:
- [ ] Full package builds: `cd src-tauri/sidecar-opencode && pnpm build`
- [ ] Can create binary: `pnpm build:binary`
- [ ] Unit tests pass: `pnpm test`

#### Manual Verification:
- [ ] Sidecar starts and sends `ready` event
- [ ] Can handle `start_task` command
- [ ] Events stream correctly from server to Tauri
- [ ] Permission/question replies work
- [ ] Logs written to `~/.opencode/` directory

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 5: Update Rust Backend

### Overview
Modify the Rust sidecar manager to work with the new sidecar-opencode IPC protocol.

### Changes Required

#### 1. Update SidecarCommand Enum
**File**: `src-tauri/src/sidecar.rs`

Update the command enum to match new protocol:

```rust
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarCommand {
    StartTask {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: StartTaskPayload,
    },
    ResumeSession {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: ResumeSessionPayload,
    },
    CancelTask {
        #[serde(rename = "taskId")]
        task_id: String,
    },
    AbortSession {
        #[serde(rename = "taskId")]
        task_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    SendPermissionReply {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: PermissionReplyPayload,
    },
    SendQuestionReply {
        #[serde(rename = "taskId")]
        task_id: String,
        payload: QuestionReplyPayload,
    },
    #[allow(dead_code)]
    Ping,
    CheckServer,
}

#[derive(Debug, Serialize)]
pub struct ResumeSessionPayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub prompt: Option<String>,
    #[serde(rename = "apiKeys")]
    pub api_keys: Option<ApiKeys>,
    #[serde(rename = "workingDirectory")]
    pub working_directory: Option<String>,
    #[serde(rename = "modelId")]
    pub model_id: Option<String>,
    pub folders: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct PermissionReplyPayload {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub reply: String,  // "once" | "always" | "reject"
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QuestionReplyPayload {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub answers: Vec<QuestionAnswer>,
}

#[derive(Debug, Serialize)]
pub struct QuestionAnswer {
    pub labels: Vec<String>,
    #[serde(rename = "customText")]
    pub custom_text: Option<String>,
}
```

#### 2. Update Event Handling
**File**: `src-tauri/src/sidecar.rs`

Add new event types:

```rust
fn handle_sidecar_event(app: &AppHandle, event: SidecarEvent, log_file: Option<Arc<Mutex<File>>>) {
    let event_name = match event.event_type.as_str() {
        "ready" => "sidecar:ready",
        "pong" => "sidecar:pong",
        "server_status" => "sidecar:server_status",
        "task_started" => "task:started",
        "task_message" => "task:message",
        "task_message_partial" => "task:message:partial",
        "task_message_complete" => "task:message:complete",
        "task_progress" => "task:progress",
        "permission_request" => "task:permission_request",
        "question_request" => "task:question_request",  // New event
        "task_complete" => "task:complete",
        "task_error" => "task:error",
        "log" => "sidecar:log",
        "error" => "sidecar:error",
        _ => {
            println!("Unknown sidecar event type: {}", event.event_type);
            return;
        }
    };
    // ... rest of handler
}
```

#### 3. Update Tauri Commands
**File**: `src-tauri/src/lib.rs`

Add new commands for session management:

```rust
#[tauri::command]
pub async fn resume_session(
    state: State<'_, SidecarState>,
    app: AppHandle,
    task_id: String,
    session_id: String,
    prompt: Option<String>,
    folders: Option<Vec<String>>,
) -> Result<Task, String> {
    // Similar to start_task but uses ResumeSession command
    let mut manager = state.manager.lock().await;

    if !manager.is_running() {
        manager.spawn(&app).await?;
    }

    let api_keys = get_all_api_keys()?;

    let payload = ResumeSessionPayload {
        task_id: task_id.clone(),
        session_id: session_id.clone(),
        prompt,
        api_keys: Some(api_keys),
        working_directory: None,
        model_id: None,
        folders,
    };

    manager.send_command(SidecarCommand::ResumeSession {
        task_id: task_id.clone(),
        payload,
    }).await?;

    // Return task info
    Ok(Task { /* ... */ })
}

#[tauri::command]
pub async fn abort_session(
    state: State<'_, SidecarState>,
    task_id: String,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;

    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    manager.send_command(SidecarCommand::AbortSession {
        task_id,
        session_id,
    }).await
}

#[tauri::command]
pub async fn reply_to_permission(
    state: State<'_, SidecarState>,
    task_id: String,
    request_id: String,
    reply: String,
    message: Option<String>,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;

    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    let payload = PermissionReplyPayload {
        request_id,
        reply,
        message,
    };

    manager.send_command(SidecarCommand::SendPermissionReply {
        task_id,
        payload,
    }).await
}

#[tauri::command]
pub async fn reply_to_question(
    state: State<'_, SidecarState>,
    task_id: String,
    request_id: String,
    answers: Vec<QuestionAnswer>,
) -> Result<(), String> {
    let mut manager = state.manager.lock().await;

    if !manager.is_running() {
        return Err("Sidecar not running".to_string());
    }

    let payload = QuestionReplyPayload {
        request_id,
        answers,
    };

    manager.send_command(SidecarCommand::SendQuestionReply {
        task_id,
        payload,
    }).await
}
```

#### 4. Update tauri.conf.json
**File**: `src-tauri/tauri.conf.json`

Change the sidecar binary reference:

```json
{
  "bundle": {
    "externalBin": ["binaries/sidecar-opencode"],
    "resources": []  // Remove skills/ since we no longer bundle MCPs
  }
}
```

### Success Criteria

#### Automated Verification:
- [ ] Rust compiles: `cd src-tauri && cargo check`
- [ ] Rust tests pass: `cargo test`
- [ ] Tauri builds: `pnpm tauri build`

#### Manual Verification:
- [ ] Sidecar spawns correctly with new binary
- [ ] Commands serialize correctly
- [ ] Events deserialize and forward correctly
- [ ] New Tauri commands work end-to-end

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 6: Frontend Integration

### Overview
Update frontend event listeners and API calls for the new protocol.

### Changes Required

#### 1. Update Tauri API Bridge
**File**: `src/lib/tauri-api.ts`

Add new functions:

```typescript
export async function resumeSession(
  taskId: string,
  sessionId: string,
  prompt?: string,
  folders?: string[]
): Promise<Task> {
  return invoke<Task>('resume_session', { taskId, sessionId, prompt, folders });
}

export async function abortSession(taskId: string, sessionId: string): Promise<void> {
  return invoke<void>('abort_session', { taskId, sessionId });
}

export async function replyToPermission(
  taskId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  message?: string
): Promise<void> {
  return invoke<void>('reply_to_permission', { taskId, requestId, reply, message });
}

export async function replyToQuestion(
  taskId: string,
  requestId: string,
  answers: Array<{ labels: string[]; customText?: string }>
): Promise<void> {
  return invoke<void>('reply_to_question', { taskId, requestId, answers });
}

// Event listener for question requests
export async function onQuestionRequest(
  callback: (event: { taskId: string; payload: QuestionRequestPayload }) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; payload: QuestionRequestPayload }>(
    'task:question_request',
    (e) => callback(e.payload)
  );
}
```

#### 2. Update Permission Store/Handler
**File**: `src/stores/taskStore.ts` (or relevant component)

Update to handle the new permission/question protocol:

```typescript
// Handle permission requests with new reply format
const handlePermissionRequest = async (
  taskId: string,
  requestId: string,
  allowed: boolean
) => {
  const reply = allowed ? 'once' : 'reject';
  await replyToPermission(taskId, requestId, reply);
};

// Handle question requests (new)
const handleQuestionResponse = async (
  taskId: string,
  requestId: string,
  selectedOptions: string[],
  customText?: string
) => {
  const answers = [{ labels: selectedOptions, customText }];
  await replyToQuestion(taskId, requestId, answers);
};
```

### Success Criteria

#### Automated Verification:
- [ ] Frontend compiles: `pnpm build`
- [ ] TypeScript checks pass: `pnpm typecheck`
- [ ] Frontend tests pass: `pnpm test --run`

#### Manual Verification:
- [ ] Task execution works end-to-end
- [ ] Streaming messages display correctly
- [ ] Permission modals appear and responses work
- [ ] Question modals appear and responses work

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to the next phase.

---

## Phase 7: Cleanup - Remove Old Sidecar and MCPs

### Overview
Remove the old sidecar and bundled MCP servers now that the new implementation is complete.

### Changes Required

#### 1. Delete Old Sidecar Directory
```bash
rm -rf src-tauri/sidecar/
```

#### 2. Delete Bundled MCP Servers
```bash
rm -rf skills/
```

#### 3. Update Root package.json
**File**: `package.json`

Remove sidecar-related scripts if any, update workspace references.

#### 4. Update .gitignore
**File**: `.gitignore`

Remove any sidecar-specific ignores, add new ones if needed:
```
# Sidecar build artifacts
src-tauri/sidecar-opencode/dist/
src-tauri/binaries/sidecar-opencode-*
```

#### 5. Update Documentation
**File**: `CLAUDE.md`

Update the architecture section:
- Remove references to `src-tauri/sidecar/`
- Remove references to `skills/` directory
- Update the architecture diagram
- Update sidecar build commands to reference `sidecar-opencode`

#### 6. Clean Up Old Binaries
```bash
rm src-tauri/binaries/cowork-sidecar-*
```

### Success Criteria

#### Automated Verification:
- [ ] Full build succeeds: `pnpm tauri build`
- [ ] No references to old sidecar: `grep -r "cowork-sidecar" --include="*.json" --include="*.rs" --include="*.ts"`
- [ ] No references to skills directory: `grep -r "skills/" --include="*.json" --include="*.rs" --include="*.ts"`

#### Manual Verification:
- [ ] App launches and runs correctly
- [ ] All task functionality works
- [ ] No orphaned files or configurations

**Implementation Note**: This is the final phase. After verification, the migration is complete.

---

## Testing Strategy

### Unit Tests
- OpenCode HTTP client (mock HTTP responses)
- SSE event parsing
- Config builder
- Session manager (mock client and events)

### Integration Tests
- Sidecar IPC protocol (stdin/stdout)
- Full task lifecycle with mock OpenCode server

### Manual Testing Steps
1. Start app and verify sidecar spawns
2. Create a new task with a simple prompt
3. Verify streaming text appears in UI
4. Verify task completes successfully
5. Test permission request flow
6. Test question request flow
7. Test session resume
8. Test session abort
9. Check log files in `~/.opencode/`

## Performance Considerations

1. **SSE Reconnection** - Automatic reconnection with configurable interval
2. **Event Throttling** - Consider throttling partial message updates if too frequent
3. **Memory** - Clean up session data after completion
4. **Process Lifecycle** - Single `opencode serve` instance per app lifetime

## Migration Notes

- Old task history in SQLite remains compatible
- Session IDs from old runs cannot be resumed (different protocol)
- API keys continue to work (same secure storage)

## References

- Research document: [docs/specs/sidecar-opencode-rewrite/research_tauri-sidecar-mcp-integration.md](docs/specs/sidecar-opencode-rewrite/research_tauri-sidecar-mcp-integration.md)
- OpenCode API spec: [docs/specs/sidecar-opencode-rewrite/opencode-api.json](docs/specs/sidecar-opencode-rewrite/opencode-api.json)
- OpenCode server docs: https://opencode.ai/docs/server
- Current sidecar: [src-tauri/sidecar/](src-tauri/sidecar/)
