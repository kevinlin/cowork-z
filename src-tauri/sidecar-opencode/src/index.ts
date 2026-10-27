import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { CommandQueue } from './command-queue';
import { toV2McpConfig } from './config-builder';
import { copilotDirectory, disconnectCopilot, listCopilotModels, startCopilotLogin } from './copilot';
import { EventStream } from './event-stream';
import { logger } from './logger';
import { mcpConfigsEqual, reapplyMcpServers, toMcpStatusRecord } from './mcp-runtime';
import { ProcessManager } from './process-manager';
import { SessionManager } from './session-manager';
import type {
  ApiKeys,
  ApiKeysResponsePayload,
  McpConfig,
  PermissionReplyPayload,
  QuestionInfo,
  QuestionReplyPayload,
  ResumeSessionPayload,
  SidecarCommand,
  SidecarEvent,
  StartTaskPayload,
  Todo,
  UpdateMcpConfigPayload,
} from './types';

const SIDECAR_VERSION = '0.2.0';

// ============================================================================
// IPC Communication
// ============================================================================

function send(event: SidecarEvent): void {
  console.log(JSON.stringify(event));
}

function sendLog(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  send({ type: 'log', payload: { level, message } });
}

// Wire logger to IPC so all logger.* calls also appear in the frontend debug panel
logger.setIpcEmitter(sendLog);

// ============================================================================
// State
// ============================================================================

let processManager: ProcessManager | null = null;
let eventStream: EventStream | null = null;
let sessionManager: SessionManager | null = null;
let currentDirectory: string | undefined;
let initializePromise: Promise<void> | null = null;
let appliedApiKeysFingerprint: string | undefined;
/** Whether the running server was spawned with the OpenRouter config overlay. */
let appliedOpenRouter = false;
/** MCP servers the running server has: its startup config plus every runtime put/delete since. */
let appliedMcpServers: Record<string, McpConfig> = {};
/** MCP servers the running server was spawned with. They reach every workspace; runtime changes reach one. */
let spawnMcpServers: Record<string, McpConfig> = {};

const isOpenRouterModel = (modelId: string | undefined): boolean => modelId?.startsWith('openrouter/') === true;

// ============================================================================
// API-key bridge (2026-06-12 review #5)
//
// Task payloads carry only a credential fingerprint. The sidecar pulls the
// actual keys from the host through a request/response pair on the existing
// stdin/stdout IPC, and only when it is about to (re)spawn the OpenCode
// server — keys no longer cross the process boundary on every task start.
// ============================================================================

const API_KEY_REQUEST_TIMEOUT_MS = 10_000;

const pendingApiKeyRequests = new Map<string, (response: ApiKeysResponsePayload | undefined) => void>();

function requestApiKeysFromHost(): Promise<ApiKeysResponsePayload | undefined> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApiKeyRequests.delete(requestId);
      logger.warn('Timed out waiting for API keys from host — starting server without provider credentials');
      resolve(undefined);
    }, API_KEY_REQUEST_TIMEOUT_MS);

    pendingApiKeyRequests.set(requestId, (response) => {
      clearTimeout(timer);
      pendingApiKeyRequests.delete(requestId);
      resolve(response);
    });

    send({ type: 'request_api_keys', payload: { requestId } });
  });
}

function handleApiKeysResponse(payload: ApiKeysResponsePayload): void {
  const resolver = pendingApiKeyRequests.get(payload.requestId);
  if (resolver) {
    resolver(payload);
  } else {
    logger.warn('Received api_keys_response with no pending request', { requestId: payload.requestId });
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initialize(
  apiKeysFingerprint?: string,
  mcpServers?: Record<string, McpConfig>,
  modelId?: string,
  workingDirectory?: string
): Promise<void> {
  if (sessionManager) {
    // API keys are applied as env vars when the server process spawns, so a
    // key added or rotated after initialization needs a deliberate server
    // restart to take effect (technical review finding #14). Callers that
    // pass no fingerprint (e.g. Copilot OAuth) express no opinion and skip
    // the check.
    const keysChanged = apiKeysFingerprint !== undefined && apiKeysFingerprint !== appliedApiKeysFingerprint;

    // The OpenRouter overlay (small-model pin, provider registration) is part of the config the
    // server reads at spawn time, and v2 has no runtime route for it. A switch between an OpenRouter
    // and a non-OpenRouter model therefore needs a restart as well. A caller that passes no model
    // (e.g. Copilot OAuth) expresses no opinion and skips the check.
    const openRouterChanged = modelId !== undefined && isOpenRouterModel(modelId) !== appliedOpenRouter;

    if ((keysChanged || openRouterChanged) && sessionManager.activeSessionCount() === 0) {
      logger.info('Server spawn config changed since initialization — restarting OpenCode server to apply it', {
        keysChanged,
        openRouterChanged,
      });
      initializePromise = (async () => {
        await teardown();
        await doInitialize(mcpServers ?? appliedMcpServers, modelId, workingDirectory);
      })();
      try {
        await initializePromise;
      } finally {
        initializePromise = null;
      }
      return;
    }

    if (keysChanged || openRouterChanged) {
      logger.warn(
        'Server spawn config changed but sessions are still active; restart deferred — it will be applied when the next task starts while idle',
        { keysChanged, openRouterChanged }
      );
    }

    // Fully initialized — but re-scope the event stream if the directory changed
    if (eventStream && workingDirectory && workingDirectory !== currentDirectory) {
      logger.info('Workspace directory changed, re-scoping the event stream', { from: currentDirectory, to: workingDirectory });
      currentDirectory = workingDirectory;
      eventStream.setDirectory(workingDirectory);
      await reapplyMcpToDirectory(workingDirectory);
    }
    return;
  }

  // Another call is already initializing — wait for it
  if (initializePromise) {
    await initializePromise;
    return;
  }

  initializePromise = doInitialize(mcpServers, modelId, workingDirectory);
  try {
    await initializePromise;
  } finally {
    initializePromise = null;
  }
}

/**
 * MCP changes made at runtime (`handleUpdateMcpConfig`) land on one workspace's location only. When the
 * workspace changes, bring the new location in line with what the app currently has. Never throws: a
 * server that fails to connect must not stop the task from starting.
 */
async function reapplyMcpToDirectory(directory: string): Promise<void> {
  if (!processManager) return;
  try {
    const failures = await reapplyMcpServers(processManager.getClient(), directory, appliedMcpServers, spawnMcpServers);
    if (failures.length > 0) {
      logger.warn('Some MCP servers could not be applied to the new workspace', { directory, failures });
    }
  } catch (error) {
    logger.warn('Could not apply MCP servers to the new workspace', {
      directory,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function doInitialize(mcpServers?: Record<string, McpConfig>, modelId?: string, workingDirectory?: string): Promise<void> {
  currentDirectory = workingDirectory;
  appliedOpenRouter = isOpenRouterModel(modelId);
  appliedMcpServers = { ...mcpServers };
  spawnMcpServers = { ...mcpServers };

  // Pull credentials from the host at spawn time (2026-06-12 review #5)
  const keyResponse = await requestApiKeysFromHost();
  const apiKeys: ApiKeys | undefined = keyResponse?.apiKeys;
  appliedApiKeysFingerprint = keyResponse?.fingerprint;

  // Start process manager — picks a random available port and generates a password
  processManager = new ProcessManager();
  await processManager.ensureServerRunning({ apiKeys, mcpServers, modelId });

  const port = processManager.getPort();
  const password = processManager.getPassword();
  logger.info(`OpenCode server bound to port ${port}`);

  // Start event stream with auth, scoped to the workspace directory
  eventStream = new EventStream({
    baseUrl: `http://127.0.0.1:${port}`,
    password,
    directory: workingDirectory,
  });

  // Initialize session manager with the port (the system prompt references
  // the auth password via env var only — 2026-06-12 review #1)
  sessionManager = new SessionManager(processManager.getClient(), eventStream, port);

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
      payload: {
        stage: data.stage as 'starting' | 'connecting' | 'configuring' | 'executing' | 'completing',
        message: data.message,
      },
    });
  });

  sessionManager.on(
    'message-partial',
    (data: { taskId: string; messageId: string; textSoFar: string; delta?: string; isStreaming: boolean }) => {
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
    }
  );

  sessionManager.on('message-complete', (data: { taskId: string; messageId: string; text: string }) => {
    send({
      type: 'task_message_complete',
      taskId: data.taskId,
      payload: { messageId: data.messageId, text: data.text },
    });
  });

  // Forward tool-use events as task_message so artifacts panel can track write_file calls.
  // The message is sent in OpenCode format (type: 'tool_use') which the frontend's
  // normalizeIncomingMessage handles via normalizeOpenCodeMessage.
  sessionManager.on('tool-use', (data: { taskId: string; messageId: string; part: Record<string, unknown> }) => {
    // Build OpenCode-format tool message for the frontend normalizer
    const toolMessage = {
      type: 'tool_use' as const,
      timestamp: ((data.part.time as Record<string, unknown> | undefined)?.start as number | undefined) ?? Date.now(),
      part: data.part,
    };
    send({
      type: 'task_message',
      taskId: data.taskId,
      payload: { message: toolMessage },
    } as unknown as SidecarEvent);
  });

  sessionManager.on(
    'permission-request',
    (data: {
      taskId: string;
      id: string;
      sessionId: string;
      permission: string;
      patterns: string[];
      metadata: Record<string, unknown>;
    }) => {
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
    }
  );

  sessionManager.on('question-request', (data: { taskId: string; id: string; sessionId: string; questions: QuestionInfo[] }) => {
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
        status: data.status as 'success' | 'error' | 'cancelled' | 'aborted',
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

  sessionManager.on('todo-updated', (data: { taskId: string; todos: Todo[] }) => {
    send({
      type: 'todo_updated',
      taskId: data.taskId,
      payload: { todos: data.todos },
    });
  });

  // Forward MCP tools changed SSE event to Tauri
  eventStream.on('mcp.tools.changed', (props: { server: string }) => {
    send({ type: 'mcp_tools_changed', payload: { server: props.server } });
  });

  // Handle event stream errors (connection drops, reconnects, etc.)
  eventStream.on('stream-error', (error: unknown) => {
    logger.warn('Event stream error (will reconnect)', error);
    sendLog('warn', 'SSE connection lost, reconnecting...');
  });

  // Connect the event stream and wait for the server's first `server.connected`: a prompt sent before
  // the subscription is live would lose its early events (the stream has no replay).
  try {
    await eventStream.connect();
  } catch (error) {
    await teardown();
    throw error;
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleStartTask(taskId: string, payload: StartTaskPayload): Promise<void> {
  try {
    await initialize(payload.apiKeysFingerprint, payload.mcpServers, payload.modelId, payload.workingDirectory);

    if (!(sessionManager && processManager)) {
      throw new Error('Session manager not initialized');
    }

    await sessionManager.startTask(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
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
    await initialize(payload.apiKeysFingerprint, payload.mcpServers, payload.modelId, payload.workingDirectory);

    if (!(sessionManager && processManager)) {
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

async function handleCancelTask(_taskId: string): Promise<void> {
  sendLog('info', 'Cancel not supported in server mode, use abort_session instead');
}

async function handleUpdateMcpConfig(payload: UpdateMcpConfigPayload): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    // MCP servers are put and deleted on the running server, so no restart. A server that is already
    // there with the same config is left alone (a put would reconnect it).
    const client = processManager.getClient();
    const directory = payload.workingDirectory ?? currentDirectory;
    const desired = payload.mcpServers ?? {};
    const failures: string[] = [];

    for (const [name, config] of Object.entries(desired)) {
      const known = appliedMcpServers[name];
      if (known && mcpConfigsEqual(known, config)) continue;
      try {
        await client.putMcpServer(name, toV2McpConfig(config), directory);
        appliedMcpServers[name] = config;
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const name of Object.keys(appliedMcpServers)) {
      if (name in desired) continue;
      try {
        await client.removeMcpServer(name, directory);
        delete appliedMcpServers[name];
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('; '));
    }
    logger.info('MCP config updated', { serverCount: Object.keys(desired).length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update MCP config', { error: message });
    send({
      type: 'error',
      payload: { message: `Failed to update MCP config: ${message}` },
    });
  }
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
    // Surface the failure — otherwise the UI shows the permission as
    // answered while the agent stays blocked waiting for the reply
    // (2026-06-12 review #24; mirrors handleQuestionReply).
    send({
      type: 'task_error',
      taskId,
      payload: { error: `Failed to reply to permission: ${message}` },
    });
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
    send({
      type: 'task_error',
      taskId,
      payload: { error: `Failed to reply to question: ${message}` },
    });
  }
}

async function handleCopilotOAuthAuthorize(enterpriseUrl?: string): Promise<void> {
  try {
    await initialize();

    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    const { done } = await startCopilotLogin(processManager.getClient(), {
      directory: copilotDirectory(currentDirectory),
      enterpriseUrl,
      emit: send,
    });

    // Watching the attempt takes minutes and never rejects; the command queue must not wait for it.
    done.catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Copilot OAuth authorize failed', { error: message });
    send({
      type: 'copilot_oauth_complete',
      payload: { connected: false, error: message },
    });
  }
}

async function handleCopilotGetModels(): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    send({
      type: 'copilot_models_result',
      payload: await listCopilotModels(processManager.getClient(), copilotDirectory(currentDirectory)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get Copilot models', { error: message });
    send({
      type: 'copilot_models_result',
      payload: { success: false, error: message },
    });
  }
}

async function handleCopilotDisconnect(): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    await disconnectCopilot(processManager.getClient(), copilotDirectory(currentDirectory));

    send({
      type: 'copilot_oauth_complete',
      payload: { connected: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to disconnect Copilot', { error: message });
    send({
      type: 'error',
      payload: { message: `Failed to disconnect Copilot: ${message}` },
    });
  }
}

async function handleGetMcpStatus(): Promise<void> {
  try {
    if (!processManager) {
      send({ type: 'mcp_status', payload: { servers: {} } });
      return;
    }

    const servers = await processManager.getClient().listMcpServers(currentDirectory);
    send({ type: 'mcp_status', payload: { servers: toMcpStatusRecord(servers) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get MCP status', { error: message });
    send({ type: 'mcp_status', payload: { servers: {} } });
  }
}

/** OpenCode 2.x has no route that lists tools, so no server has a tool list to show. The UI renders servers without one. */
async function handleGetMcpTools(): Promise<void> {
  send({ type: 'mcp_tools', payload: { toolIds: [] } });
}

async function handleConnectMcpServer(name: string): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    const client = processManager.getClient();
    await client.connectMcp(name, currentDirectory);
    // Refresh status after connect
    const servers = await client.listMcpServers(currentDirectory);
    send({ type: 'mcp_status', payload: { servers: toMcpStatusRecord(servers) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to connect MCP server', { name, error: message });
    send({ type: 'error', payload: { message: `Failed to connect MCP server "${name}": ${message}` } });
  }
}

async function handleDisconnectMcpServer(name: string): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    const client = processManager.getClient();
    await client.disconnectMcp(name, currentDirectory);
    // Refresh status after disconnect
    const servers = await client.listMcpServers(currentDirectory);
    send({ type: 'mcp_status', payload: { servers: toMcpStatusRecord(servers) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to disconnect MCP server', { name, error: message });
    send({ type: 'error', payload: { message: `Failed to disconnect MCP server "${name}": ${message}` } });
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
    const info = await client.info();
    send({
      type: 'server_status',
      payload: {
        running: true,
        port: processManager.getPort(),
        version: info.version,
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
  // Never log full command payloads — start_task/resume_session carry
  // API keys (2026-06-12 review #6). Type + taskId is enough to trace flow.
  logger.debug('Received command', {
    type: msg.type,
    taskId: 'taskId' in msg ? msg.taskId : undefined,
  });

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

    case 'check_server':
      await handleCheckServer();
      break;

    case 'update_mcp_config':
      await handleUpdateMcpConfig(msg.payload);
      break;

    case 'get_mcp_status':
      await handleGetMcpStatus();
      break;

    case 'get_mcp_tools':
      await handleGetMcpTools();
      break;

    case 'connect_mcp_server':
      await handleConnectMcpServer(msg.payload.name);
      break;

    case 'disconnect_mcp_server':
      await handleDisconnectMcpServer(msg.payload.name);
      break;

    case 'copilot_oauth_authorize':
      await handleCopilotOAuthAuthorize(msg.enterpriseUrl);
      break;

    case 'copilot_get_models':
      await handleCopilotGetModels();
      break;

    case 'copilot_disconnect':
      await handleCopilotDisconnect();
      break;

    case 'get_session_todos': {
      // OpenCode 2.x has no todo route: answer from the todos this run saw, else rebuild them from the
      // message history (null when the agent never wrote any, or no server is running to read them from).
      const todos = (await sessionManager?.loadSessionTodos(msg.sessionId)) ?? null;
      send({ type: 'todo_updated', taskId: msg.taskId, payload: { todos } } as unknown as SidecarEvent);
      break;
    }

    case 'shutdown':
      // Graceful shutdown: stop OpenCode server, then exit
      logger.info('Received shutdown command, cleaning up...');
      try {
        await cleanup();
      } catch {
        // Best-effort cleanup
      }
      process.exit(0);
      break;

    default:
      logger.warn('Unknown command type', msg);
  }
}

// ============================================================================
// Cleanup
// ============================================================================

/** Tear down the session manager, event stream, and OpenCode server process. */
async function teardown(): Promise<void> {
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
}

async function cleanup(): Promise<void> {
  logger.info('Cleaning up...');
  await teardown();
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

  // Serialize command handling: each stdin line used to spawn a concurrent
  // handler, racing on processManager/sessionManager/initializePromise
  // (2026-06-12 review #8). Commands now run strictly FIFO.
  const queue = new CommandQueue();

  rl.on('line', (line: string) => {
    let msg: SidecarCommand;
    try {
      msg = JSON.parse(line) as SidecarCommand;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse command', { line, error: message });
      send({
        type: 'error',
        payload: { message: `Failed to parse command: ${message}` },
      });
      return;
    }

    // Handled outside the queue: api_keys_response resolves a promise that a
    // queued command (doInitialize) is awaiting — queueing it would deadlock.
    // ping stays out so liveness checks aren't delayed by long-running tasks.
    if (msg.type === 'api_keys_response') {
      handleApiKeysResponse(msg.payload);
      return;
    }
    if (msg.type === 'ping') {
      send({ type: 'pong', payload: { timestamp: Date.now() } });
      return;
    }

    const accepted = queue.enqueue(
      () => handleMessage(msg),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Command handler failed', { type: msg.type, error: message });
      }
    );
    if (!accepted) {
      logger.warn('Dropping command received after shutdown began', { type: msg.type });
      return;
    }

    if (msg.type === 'shutdown') {
      // The shutdown command itself is queued (so in-flight commands finish
      // before teardown); anything arriving after it is dropped.
      queue.beginShutdown();
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
