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
        managed.currentMessageId = props.info.id;
        this.emit('message', {
          taskId,
          message: props.info,
        });
      }
    });

    // Message part updates (streaming)
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
    }
  }

  async startTask(payload: StartTaskPayload): Promise<void> {
    const { taskId, prompt, workingDirectory, modelId, folderPermissions, customPrompt, mcpServers } = payload;

    logger.info('Starting task', { taskId, prompt: prompt.slice(0, 100) });

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
    managed.status = 'active';
    await this.client.sendMessage(session.id, {
      parts: [{ type: 'text', text: prompt }],
      directory: workingDirectory,
      system: buildSystemPrompt(this.serverPort, this.serverPassword, customPrompt),
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
    if (prompt) {
      managed.status = 'active';
      await this.client.sendMessage(sessionId, {
        parts: [{ type: 'text', text: prompt }],
        directory: workingDirectory,
        system: buildSystemPrompt(this.serverPort, this.serverPassword, customPrompt),
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

  async replyToPermission(taskId: string, requestId: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void> {
    logger.info('Replying to permission', { taskId, requestId, reply });
    await this.client.replyToPermission(requestId, reply, { message });
  }

  async replyToQuestion(taskId: string, requestId: string, answers: Array<{ labels: string[]; customText?: string }>): Promise<void> {
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
