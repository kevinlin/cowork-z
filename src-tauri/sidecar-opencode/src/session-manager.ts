import { EventEmitter } from 'node:events';
import { buildSessionConfig, buildSystemPrompt } from './config-builder';
import type { EventStream } from './event-stream';
import { logger } from './logger';
import type { OpenCodeClient } from './opencode-client';
import type {
  MessageInfo,
  PartUpdate,
  PermissionRequest,
  QuestionRequest,
  ResumeSessionPayload,
  Session,
  StartTaskPayload,
  Todo,
} from './types';

interface ManagedSession {
  taskId: string;
  sessionId: string;
  session: Session;
  status: 'starting' | 'active' | 'completing' | 'completed' | 'error';
  currentMessageId?: string;
  textAccumulator: string;
}

/**
 * Parse a composite model ID (e.g. "openrouter/minimax/minimax-m2.5") into
 * the { providerID, modelID } shape that OpenCode's sendMessage API expects.
 * This bypasses config-based model resolution, which fails for models not
 * in OpenCode's models.dev curated database.
 */
function parseModelId(modelId?: string): { providerID: string; modelID: string } | undefined {
  if (!modelId) return undefined;
  const slashIdx = modelId.indexOf('/');
  if (slashIdx <= 0) return undefined;
  return {
    providerID: modelId.substring(0, slashIdx),
    modelID: modelId.substring(slashIdx + 1),
  };
}

export class SessionManager extends EventEmitter {
  private client: OpenCodeClient;
  private eventStream: EventStream;
  private sessions: Map<string, ManagedSession> = new Map();
  private sessionToTask: Map<string, string> = new Map();
  private serverPort: number;
  private serverPassword: string;

  constructor(client: OpenCodeClient, eventStream: EventStream, serverPort: number, serverPassword: string) {
    super();
    this.client = client;
    this.eventStream = eventStream;
    this.serverPort = serverPort;
    this.serverPassword = serverPassword;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Session status updates
    // Server sends { sessionID: string, status: { type: string } } not { session: Session }
    this.eventStream.on('session.status', (props: { sessionID: string; status: { type: string } }) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      logger.debug('Session status update', { sessionId: props.sessionID, status: props.status });

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
    // Server sends { info: MessageInfo } — sessionID is nested inside info
    this.eventStream.on('message.updated', (props: { info: MessageInfo }) => {
      const taskId = this.sessionToTask.get(props.info.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      if (props.info.role === 'assistant') {
        // Finalize previous message's accumulated text before starting new one
        if (managed.textAccumulator && managed.currentMessageId) {
          this.emit('message-complete', {
            taskId,
            messageId: managed.currentMessageId,
            text: managed.textAccumulator,
          });
          managed.textAccumulator = '';
        }
        managed.currentMessageId = props.info.id;
        this.emit('message', {
          taskId,
          message: props.info,
        });
      }
    });

    // Message part deltas (streaming text chunks)
    // Server sends incremental text via message.part.delta events
    this.eventStream.on(
      'message.part.delta',
      (props: { sessionID: string; messageID: string; partID: string; field: string; delta: string }) => {
        const taskId = this.sessionToTask.get(props.sessionID);
        if (!taskId) return;

        const managed = this.sessions.get(taskId);
        if (!managed) return;

        if (props.field === 'text') {
          managed.textAccumulator += props.delta;
          this.emit('message-partial', {
            taskId,
            messageId: props.messageID,
            textSoFar: managed.textAccumulator,
            delta: props.delta,
            isStreaming: true,
          });
        }
      }
    );

    // Message part updates (full part state, e.g. tool use, step-start/finish)
    // Server nests sessionID and messageID inside the part object itself
    this.eventStream.on('message.part.updated', (props: { part: PartUpdate; delta?: string }) => {
      const taskId = this.sessionToTask.get(props.part.sessionID);
      if (!taskId) return;

      const managed = this.sessions.get(taskId);
      if (!managed) return;

      if (props.part.type === 'text' && props.delta) {
        managed.textAccumulator += props.delta;
        this.emit('message-partial', {
          taskId,
          messageId: props.part.messageID,
          textSoFar: managed.textAccumulator,
          delta: props.delta,
          isStreaming: true,
        });
      } else if (props.part.type === 'tool') {
        this.emit('tool-use', {
          taskId,
          messageId: props.part.messageID,
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
      this.cleanup(taskId);
    });

    // Todo updates
    this.eventStream.on('todo.updated', (props: { sessionID: string; todos: Todo[] }) => {
      const taskId = this.sessionToTask.get(props.sessionID);
      if (!taskId) return;

      logger.debug('Todo update received', { sessionId: props.sessionID, todoCount: props.todos.length });
      this.emit('todo-updated', {
        taskId,
        todos: props.todos,
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

      this.cleanup(managed.taskId);
    }
  }

  async startTask(payload: StartTaskPayload): Promise<void> {
    const { taskId, prompt, workingDirectory, modelId, folderPermissions, customPrompt, mcpServers } = payload;

    logger.info('Starting task', { taskId, prompt: prompt.slice(0, 100) });

    // Clean up any stale sessions left over from previous tasks that completed,
    // errored, or were abandoned (e.g., user started a new task while the old
    // one was blocked on a question/permission prompt).
    const staleTaskIds = Array.from(this.sessions.keys()).filter((id) => id !== taskId);
    for (const oldTaskId of staleTaskIds) {
      const managed = this.sessions.get(oldTaskId);
      logger.info('Cleaning up stale session', { oldTaskId, sessionId: managed?.sessionId, status: managed?.status });
      this.cleanup(oldTaskId);
    }

    // Push session-specific config via PATCH /config
    const config = buildSessionConfig({ modelId, folderPermissions, mcpServers });
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

    // Send the initial message with system prompt injected directly.
    // OpenCode 1.1.48 ignores custom agents, so we bypass agent resolution
    // by passing the system prompt via the `system` field on sendMessage.
    // Also pass the model directly per-message to bypass config-based model
    // resolution, which fails for models not in OpenCode's models.dev database.
    managed.status = 'active';
    const messageModel = parseModelId(modelId);
    await this.client.sendMessage(session.id, {
      parts: [{ type: 'text', text: prompt }],
      directory: workingDirectory,
      system: buildSystemPrompt(this.serverPort, this.serverPassword, customPrompt),
      model: messageModel,
    });
  }

  async resumeSession(payload: ResumeSessionPayload): Promise<void> {
    const { taskId, sessionId, prompt, workingDirectory, modelId, folderPermissions, customPrompt, mcpServers } = payload;

    logger.info('Resuming session', { taskId, sessionId });

    // Push session-specific config via PATCH /config
    const config = buildSessionConfig({ modelId, folderPermissions, mcpServers });

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

    // Send follow-up message if provided, with system prompt injected directly.
    // Also pass the model directly per-message (same as startTask).
    if (prompt) {
      managed.status = 'active';
      const messageModel = parseModelId(modelId);
      await this.client.sendMessage(sessionId, {
        parts: [{ type: 'text', text: prompt }],
        directory: workingDirectory,
        system: buildSystemPrompt(this.serverPort, this.serverPassword, customPrompt),
        model: messageModel,
      });
    }
  }

  async abortSession(taskId: string, sessionId: string): Promise<void> {
    logger.info('Aborting session', { taskId, sessionId });

    const managed = this.sessions.get(taskId);
    if (managed) {
      managed.status = 'completing';
    }

    const directory = managed?.session?.directory;
    await this.client.abortSession(sessionId, directory);

    this.emit('complete', {
      taskId,
      sessionId,
      status: 'aborted',
    });

    this.cleanup(taskId);
  }

  async replyToPermission(taskId: string, requestId: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void> {
    const managed = this.sessions.get(taskId);
    const directory = managed?.session?.directory;
    logger.info('Replying to permission', { taskId, requestId, reply, directory });
    await this.client.replyToPermission(requestId, reply, { message, directory });
  }

  async replyToQuestion(taskId: string, requestId: string, answers: Array<{ labels: string[]; customText?: string }>): Promise<void> {
    const managed = this.sessions.get(taskId);
    const directory = managed?.session?.directory;
    // OpenCode server expects each answer as a flat string[] of selected labels,
    // not {labels, customText} objects. Transform before sending.
    const flatAnswers: string[][] = answers.map((a) => {
      if (a.customText) return [...a.labels, a.customText];
      return a.labels;
    });
    logger.info('Replying to question', { taskId, requestId, answers: flatAnswers, directory });
    await this.client.replyToQuestion(requestId, flatAnswers, directory);
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
