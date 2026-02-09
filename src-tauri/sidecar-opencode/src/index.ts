import readline from 'node:readline';
import { EventStream } from './event-stream';
import { logger } from './logger';
import { ProcessManager } from './process-manager';
import { SessionManager } from './session-manager';
import type {
  ApiKeys,
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

// ============================================================================
// Initialization
// ============================================================================

async function initialize(apiKeys?: ApiKeys, mcpServers?: Record<string, unknown>): Promise<void> {
  if (processManager) {
    return; // Already initialized
  }

  // Start process manager — picks a random available port and generates a password
  processManager = new ProcessManager();
  await processManager.ensureServerRunning({ apiKeys, mcpServers });

  const port = processManager.getPort();
  const password = processManager.getPassword();
  logger.info(`OpenCode server bound to port ${port}`);

  // Start event stream with auth
  eventStream = new EventStream({
    baseUrl: `http://127.0.0.1:${port}`,
    password,
  });

  // Initialize session manager with port and password (for dynamic system prompt with auth)
  sessionManager = new SessionManager(processManager.getClient(), eventStream, port, password);

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

  // Handle event stream errors (connection drops, reconnects, etc.)
  eventStream.on('stream-error', (error: unknown) => {
    logger.warn('Event stream error (will reconnect)', error);
    sendLog('warn', 'SSE connection lost, reconnecting...');
  });

  // Connect event stream
  eventStream.connect();
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleStartTask(taskId: string, payload: StartTaskPayload): Promise<void> {
  try {
    await initialize(payload.apiKeys, payload.mcpServers);

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
    await initialize(payload.apiKeys, payload.mcpServers);

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

async function handleCancelTask(_taskId: string): Promise<void> {
  sendLog('info', 'Cancel not supported in server mode, use abort_session instead');
}

async function handleUpdateMcpConfig(payload: UpdateMcpConfigPayload): Promise<void> {
  try {
    if (!processManager) {
      throw new Error('Process manager not initialized');
    }

    // Write to config files on disk so the next server start picks up MCP servers.
    // OpenCode does NOT dynamically initialize MCP servers from PATCH /config;
    // it only reads them at startup.
    processManager.updateMcpConfig(payload.mcpServers);

    // Also send PATCH /config to update the in-memory config (model, permissions, etc.)
    const client = processManager.getClient();
    await client.updateConfig({ mcp: payload.mcpServers }, payload.workingDirectory);
    logger.info('MCP config updated', { serverCount: Object.keys(payload.mcpServers).length });
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
        port: processManager.getPort(),
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

    case 'update_mcp_config':
      await handleUpdateMcpConfig(msg.payload);
      break;

    case 'get_session_todos': {
      try {
        if (!processManager) throw new Error('Not initialized');
        const client = processManager.getClient();
        const todos = await client.getSessionTodos(msg.sessionId);
        send({ type: 'todo_updated', taskId: msg.taskId, payload: { todos } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to get session todos', { error: message });
      }
      break;
    }

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
