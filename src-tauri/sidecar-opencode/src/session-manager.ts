import { EventEmitter } from 'node:events';
import { buildSessionPermissions, buildSystemPrompt } from './config-builder';
import type { EventStream } from './event-stream';
import { buildFormAnswer, mapFormToQuestions, type QuestionBinding } from './form-mapper';
import { logger } from './logger';
import { type OpenCodeClient, OpenCodeHttpError } from './opencode-client';
import type {
  ExecutionFailedData,
  ExecutionInterruptedData,
  FormInfo,
  ModelRef,
  PermissionAsk,
  QuestionAnswer,
  ResumeSessionPayload,
  SessionOutcome,
  StartTaskPayload,
  TextDeltaData,
  Todo,
  ToolCalledData,
  ToolContentItem,
  ToolFailedData,
  ToolInputStartedData,
  ToolSuccessData,
} from './types';

/**
 * Maximum consecutive auto-compactions before the sidecar treats the session
 * as stuck in a compaction loop and auto-aborts.
 *
 * OpenCode's auto-compaction injects a synthetic "Continue if you have next
 * steps…" user message after each compaction.  When the system prompt is
 * large enough to nearly fill the context window, the agent's short reply
 * immediately triggers another compaction, creating an infinite loop.
 */
const COMPACTION_LOOP_THRESHOLD = 3;

/** Key of the session instructions entry that carries the Cowork-Z system prompt. */
const INSTRUCTIONS_KEY = 'cowork-z';

/** v2 tool names the frontend knows under their v1 names (artifact extraction only recognises `bash`). */
const V1_NAMES: Record<string, string> = { shell: 'bash', subagent: 'task' };
const toV1Name = (name: string): string => V1_NAMES[name] ?? name;

type Job = () => void | Promise<void>;

interface ToolCall {
  name?: string;
  messageId?: string;
  input?: unknown;
  startedAt?: number;
}

interface ManagedSession {
  taskId: string;
  sessionId: string;
  directory?: string;
  status: 'starting' | 'active' | 'completing' | 'completed' | 'error';
  currentMessageId?: string;
  textAccumulator: string;
  consecutiveCompactions: number;
  /**
   * True once any event confirmed the server is processing the turn.
   * Used to tell a prompt transport failure that means "the turn never started"
   * (must surface a task_error) from an ambiguous artifact such as a socket
   * timeout on a turn that is already running (2026-06-12 review #9).
   */
  turnConfirmed: boolean;
  /** When the prompt went out; a session outcome only counts for this turn if it is newer. */
  promptSentAt?: number;
  toolCalls: Map<string, ToolCall>;
  seenPermissions: Set<string>;
  seenForms: Set<string>;
  /** Per-session job queue: an async job (a name lookup) holds back the events behind it. */
  queue: Job[];
  draining: boolean;
}

interface PendingForm {
  taskId: string;
  sessionId: string;
  bindings: QuestionBinding[];
}

/**
 * Parse a composite model ID (e.g. "openrouter/minimax/minimax-m2.5") into
 * the { providerID, id } shape that OpenCode's session API expects.
 * This bypasses config-based model resolution, which fails for models not
 * in OpenCode's models.dev curated database.
 */
function parseModelId(modelId?: string): ModelRef | undefined {
  if (!modelId) return undefined;
  const slashIdx = modelId.indexOf('/');
  if (slashIdx <= 0) return undefined;
  return {
    providerID: modelId.slice(0, slashIdx),
    id: modelId.slice(slashIdx + 1),
  };
}

const isPromise = (value: unknown): value is Promise<void> => typeof (value as { then?: unknown } | undefined)?.then === 'function';

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A tool result for the UI: text items joined by newlines, files written as `[file: name or uri]`. */
function joinToolContent(content: ToolContentItem[] | undefined): string {
  return (content ?? []).map((item) => (item.type === 'text' ? item.text : `[file: ${item.name ?? item.uri}]`)).join('\n');
}

/** `todowrite` input → the Todo shape of the todo panel. */
function toTodos(input: unknown): Todo[] | undefined {
  const todos = (input as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(todos)) return undefined;
  return todos.map((todo: { content?: unknown; status?: unknown }, index) => ({
    id: String(index),
    content: String(todo?.content ?? ''),
    status: (todo?.status ?? 'pending') as Todo['status'],
    priority: 'medium' as const,
  }));
}

export class SessionManager extends EventEmitter {
  private client: OpenCodeClient;
  private eventStream: EventStream;
  private sessions: Map<string, ManagedSession> = new Map();
  private sessionToTask: Map<string, string> = new Map();
  private serverPort: number;
  /** Last-seen todos per session id, from `todowrite` calls. Outlives the task so the UI can still ask. */
  private todosBySession: Map<string, Todo[]> = new Map();
  /** Pending permission request id → session id, so a reply still finds its session after cleanup. */
  private permissionSessions: Map<string, string> = new Map();
  /** Forms currently shown to the user, with the fields their answers belong to. */
  private pendingForms: Map<string, PendingForm> = new Map();

  constructor(client: OpenCodeClient, eventStream: EventStream, serverPort: number) {
    super();
    this.client = client;
    this.eventStream = eventStream;
    this.serverPort = serverPort;
    this.setupEventListeners();
  }

  // ==========================================================================
  // Event wiring
  // ==========================================================================

  /** Route one event type to the session it belongs to, through that session's queue. */
  private listen<T extends { sessionID: string }>(type: string, handler: (managed: ManagedSession, data: T) => void | Promise<void>): void {
    this.eventStream.on(type, (data: T) => {
      const managed = this.managedFor(data?.sessionID);
      if (!managed) return;
      this.dispatch(managed, () => handler(managed, data));
    });
  }

  private managedFor(sessionId: string | undefined): ManagedSession | undefined {
    if (!sessionId) return undefined;
    const taskId = this.sessionToTask.get(sessionId);
    return taskId ? this.sessions.get(taskId) : undefined;
  }

  /**
   * Run jobs for one session in arrival order. Sync jobs run immediately; an async job (a tool name
   * lookup, a REST recovery) pauses the queue until it settles, so a later event cannot overtake it.
   */
  private dispatch(managed: ManagedSession, job: Job): void {
    managed.queue.push(job);
    this.pump(managed);
  }

  private pump(managed: ManagedSession): void {
    if (managed.draining) return;

    managed.draining = true;
    while (managed.queue.length > 0) {
      const next = managed.queue.shift() as Job;
      if (this.sessions.get(managed.taskId) !== managed) {
        // The session was cleaned up while events were still queued.
        managed.queue.length = 0;
        break;
      }

      let result: void | Promise<void>;
      try {
        result = next();
      } catch (error) {
        logger.error('Error while handling a session event', { taskId: managed.taskId, error: errorMessage(error) });
        continue;
      }

      if (isPromise(result)) {
        result
          .catch((error: unknown) =>
            logger.error('Error while handling a session event', { taskId: managed.taskId, error: errorMessage(error) })
          )
          .finally(() => {
            managed.draining = false;
            this.pump(managed);
          });
        return;
      }
    }
    managed.draining = false;
  }

  private setupEventListeners(): void {
    this.listen<{ sessionID: string }>('session.execution.started', (managed) => {
      if (managed.status === 'completing') return;
      logger.debug('Session execution started', { sessionId: managed.sessionId });
      managed.status = 'active';
      managed.turnConfirmed = true;
      this.emit('progress', { taskId: managed.taskId, stage: 'executing' });
    });

    this.listen<{ sessionID: string }>('session.execution.succeeded', (managed) => {
      if (managed.status === 'completing') return;
      this.finishSuccess(managed);
    });

    this.listen<ExecutionFailedData>('session.execution.failed', (managed, data) => {
      if (managed.status === 'completing') return;
      logger.error('Session execution failed', data);
      this.finishFailed(managed, data.error?.message ?? 'The session failed');
    });

    this.listen<ExecutionInterruptedData>('session.execution.interrupted', (managed, data) => {
      this.finishInterrupted(managed, data.reason);
    });

    this.listen<TextDeltaData>('session.text.delta', (managed, data) => {
      managed.turnConfirmed = true;
      // A new assistant message first flushes the previous one
      if (managed.currentMessageId && managed.currentMessageId !== data.assistantMessageID) {
        this.flushText(managed);
      }
      managed.currentMessageId = data.assistantMessageID;
      managed.textAccumulator += data.delta;
      this.emit('message-partial', {
        taskId: managed.taskId,
        messageId: data.assistantMessageID,
        textSoFar: managed.textAccumulator,
        delta: data.delta,
        isStreaming: true,
      });
    });

    this.listen<ToolInputStartedData>('session.tool.input.started', (managed, data) => {
      managed.turnConfirmed = true;
      const call = managed.toolCalls.get(data.id) ?? {};
      call.name = data.name;
      call.messageId = data.assistantMessageID;
      managed.toolCalls.set(data.id, call);
    });

    this.listen<ToolCalledData>('session.tool.called', (managed, data) => {
      managed.turnConfirmed = true;
      const call = managed.toolCalls.get(data.id) ?? {};
      managed.toolCalls.set(data.id, call);
      call.input = data.input;
      call.messageId = data.assistantMessageID;
      call.startedAt = Date.now();
      if (call.name) {
        this.emitToolCalled(managed, data.id, call);
        return;
      }
      return this.lookupToolName(managed, data.id).then((name) => {
        call.name = name;
        this.emitToolCalled(managed, data.id, call);
      });
    });

    this.listen<ToolSuccessData>('session.tool.success', (managed, data) => {
      managed.turnConfirmed = true;
      return this.finishTool(managed, data.id, data.assistantMessageID, { status: 'completed', output: joinToolContent(data.content) });
    });

    this.listen<ToolFailedData>('session.tool.failed', (managed, data) => {
      managed.turnConfirmed = true;
      return this.finishTool(managed, data.id, data.assistantMessageID, { status: 'error', output: data.error?.message ?? 'Tool failed' });
    });

    this.listen<PermissionAsk>('permission.asked', (managed, ask) => {
      managed.turnConfirmed = true;
      logger.info('Permission request received', ask);
      this.presentPermission(managed, ask);
    });

    this.eventStream.on('form.created', (data: { form: FormInfo }) => {
      const form = data?.form;
      const managed = this.managedFor(form?.sessionID);
      if (!(managed && form)) return;
      this.dispatch(managed, () => {
        managed.turnConfirmed = true;
        logger.info('Form (question) received', form);
        this.presentForm(managed, form);
      });
    });

    this.listen<{ sessionID: string }>('session.compaction.ended', (managed) => {
      managed.consecutiveCompactions += 1;
      logger.warn('Session compacted', { sessionId: managed.sessionId, consecutiveCompactions: managed.consecutiveCompactions });

      if (managed.consecutiveCompactions < COMPACTION_LOOP_THRESHOLD) return;

      logger.error('Compaction loop detected — auto-aborting session', {
        taskId: managed.taskId,
        sessionId: managed.sessionId,
        consecutiveCompactions: managed.consecutiveCompactions,
      });

      managed.status = 'error';
      this.emit('error', {
        taskId: managed.taskId,
        error:
          "The model entered a compaction loop (the system prompt may be too large for this model's context window). " +
          'Try a model with a larger context window, or reduce the system prompt size.',
        sessionId: managed.sessionId,
      });

      this.client.interrupt(managed.sessionId).catch((err) => {
        logger.warn('Failed to interrupt compaction-looping session', { taskId: managed.taskId, error: errorMessage(err) });
      });

      this.cleanup(managed.taskId);
    });

    // The stream is volatile: events sent while it was down are gone. Rebuild every active session from REST.
    this.eventStream.on('reconnected', () => {
      for (const managed of Array.from(this.sessions.values())) {
        this.dispatch(managed, () => this.recoverSession(managed));
      }
    });
  }

  // ==========================================================================
  // Completion
  // ==========================================================================

  private flushText(managed: ManagedSession): void {
    if (managed.textAccumulator && managed.currentMessageId) {
      this.emit('message-complete', {
        taskId: managed.taskId,
        messageId: managed.currentMessageId,
        text: managed.textAccumulator,
      });
    }
    managed.textAccumulator = '';
    managed.currentMessageId = undefined;
  }

  private finishSuccess(managed: ManagedSession): void {
    this.flushText(managed);
    managed.status = 'completed';
    this.emit('complete', { taskId: managed.taskId, sessionId: managed.sessionId, status: 'success' });
    this.cleanup(managed.taskId);
  }

  private finishFailed(managed: ManagedSession, message: string): void {
    managed.status = 'error';
    this.emit('error', { taskId: managed.taskId, error: message, sessionId: managed.sessionId });
    this.cleanup(managed.taskId);
  }

  /**
   * v2 reports a rejected permission, like a user stop, as an interrupted execution. With a local
   * abort pending, abortSession already reports the stop. Otherwise the turn simply ended (v1 ended
   * a rejected permission the same way and the task finished).
   */
  private finishInterrupted(managed: ManagedSession, reason: string | undefined): void {
    if (managed.status === 'completing') {
      logger.debug('Ignoring interrupted event: a local abort is pending', { sessionId: managed.sessionId, reason });
      return;
    }
    logger.info('Session execution interrupted', { sessionId: managed.sessionId, reason });
    this.finishSuccess(managed);
  }

  // ==========================================================================
  // Tools and todos
  // ==========================================================================

  /** The name of a tool call whose `input.started` event was missed, from the message history. Falls back to `tool`. */
  private async lookupToolName(managed: ManagedSession, callId: string): Promise<string> {
    try {
      const messages = await this.client.getSessionMessages(managed.sessionId);
      for (const message of messages) {
        for (const item of message.content ?? []) {
          if (item.type === 'tool' && item.id && item.name) {
            const known = managed.toolCalls.get(item.id) ?? {};
            known.name ??= item.name;
            managed.toolCalls.set(item.id, known);
          }
        }
      }
    } catch (error) {
      logger.warn('Could not read the message history to name a tool call', { sessionId: managed.sessionId, error: errorMessage(error) });
    }
    return managed.toolCalls.get(callId)?.name ?? 'tool';
  }

  private toolPart(managed: ManagedSession, callId: string, call: ToolCall, state: Record<string, unknown>): Record<string, unknown> {
    return {
      type: 'tool',
      tool: toV1Name(call.name ?? 'tool'),
      callID: callId,
      messageID: call.messageId,
      sessionID: managed.sessionId,
      state,
      time: { start: call.startedAt ?? Date.now() },
    };
  }

  private emitToolUse(managed: ManagedSession, callId: string, call: ToolCall, state: Record<string, unknown>): void {
    this.emit('tool-use', {
      taskId: managed.taskId,
      messageId: call.messageId,
      part: this.toolPart(managed, callId, call, state),
    });
  }

  private emitToolCalled(managed: ManagedSession, callId: string, call: ToolCall): void {
    this.emitToolUse(managed, callId, call, { status: 'running', input: call.input ?? {} });
    if (call.name === 'todowrite') {
      this.updateTodos(managed, call.input);
    }
  }

  private finishTool(
    managed: ManagedSession,
    callId: string,
    messageId: string,
    result: { status: 'completed' | 'error'; output: string }
  ): void | Promise<void> {
    const call = managed.toolCalls.get(callId) ?? {};
    managed.toolCalls.set(callId, call);
    call.messageId ??= messageId;

    const emit = () => this.emitToolUse(managed, callId, call, { status: result.status, input: call.input ?? {}, output: result.output });
    if (call.name) {
      emit();
      return;
    }
    return this.lookupToolName(managed, callId).then((name) => {
      call.name = name;
      emit();
    });
  }

  private updateTodos(managed: ManagedSession, input: unknown): void {
    const todos = toTodos(input);
    if (!todos) return;
    logger.debug('Todo update received', { sessionId: managed.sessionId, todoCount: todos.length });
    this.todosBySession.set(managed.sessionId, todos);
    this.emit('todo-updated', { taskId: managed.taskId, todos });
  }

  /** The last todo list the agent wrote in this session, or undefined when it never wrote one. */
  getSessionTodos(sessionId: string): Todo[] | undefined {
    return this.todosBySession.get(sessionId);
  }

  // ==========================================================================
  // Permissions and questions
  // ==========================================================================

  private presentPermission(managed: ManagedSession, ask: PermissionAsk): void {
    if (managed.seenPermissions.has(ask.id)) return;
    managed.seenPermissions.add(ask.id);
    this.permissionSessions.set(ask.id, managed.sessionId);
    this.emit('permission-request', {
      taskId: managed.taskId,
      id: ask.id,
      sessionId: managed.sessionId,
      permission: toV1Name(ask.action),
      patterns: ask.resources,
      metadata: ask.metadata ?? {},
    });
  }

  private presentForm(managed: ManagedSession, form: FormInfo): void {
    if (managed.seenForms.has(form.id)) return;
    managed.seenForms.add(form.id);

    const { bindings, unsupported } = mapFormToQuestions(form);
    if (unsupported) {
      logger.warn('Cancelling a form the app cannot show', { sessionId: managed.sessionId, formId: form.id, reason: unsupported });
      this.client.cancelForm(managed.sessionId, form.id, `Cowork-Z cannot show this form: ${unsupported}`).catch((err) => {
        logger.warn('Failed to cancel an unsupported form', { formId: form.id, error: errorMessage(err) });
      });
      return;
    }

    this.pendingForms.set(form.id, { taskId: managed.taskId, sessionId: managed.sessionId, bindings });
    this.emit('question-request', {
      taskId: managed.taskId,
      id: form.id,
      sessionId: managed.sessionId,
      questions: bindings.map((binding) => binding.question),
    });
  }

  // ==========================================================================
  // Recovery after a stream reconnect
  // ==========================================================================

  private isCurrent(managed: ManagedSession): boolean {
    return this.sessions.get(managed.taskId) === managed && managed.status !== 'completing';
  }

  private async recoverSession(managed: ManagedSession): Promise<void> {
    if (!this.isCurrent(managed)) return;
    logger.info('Rebuilding session after the event stream reconnected', { taskId: managed.taskId, sessionId: managed.sessionId });

    let info: Awaited<ReturnType<OpenCodeClient['getSession']>>;
    try {
      info = await this.client.getSession(managed.sessionId);
    } catch (error) {
      logger.warn('Could not read the session to recover it', { sessionId: managed.sessionId, error: errorMessage(error) });
      return;
    }
    if (!this.isCurrent(managed)) return;

    // The outcome only counts when it is newer than the prompt of this turn.
    if (info.outcome && managed.promptSentAt !== undefined && info.time.updated > managed.promptSentAt) {
      await this.finishFromOutcome(managed, info.outcome);
      return;
    }

    const [permissions, forms] = await Promise.allSettled([
      this.client.listSessionPermissions(managed.sessionId),
      this.client.listSessionForms(managed.sessionId),
    ]);
    if (!this.isCurrent(managed)) return;

    if (permissions.status === 'fulfilled') {
      for (const ask of permissions.value) this.presentPermission(managed, ask);
    } else {
      logger.warn('Could not list pending permissions to recover them', {
        sessionId: managed.sessionId,
        error: errorMessage(permissions.reason),
      });
    }
    if (forms.status === 'fulfilled') {
      for (const form of forms.value) this.presentForm(managed, form);
    } else {
      logger.warn('Could not list pending forms to recover them', { sessionId: managed.sessionId, error: errorMessage(forms.reason) });
    }
  }

  private async finishFromOutcome(managed: ManagedSession, outcome: SessionOutcome): Promise<void> {
    logger.info('Session finished while the event stream was down', { sessionId: managed.sessionId, outcome });
    if (outcome === 'succeeded') {
      this.finishSuccess(managed);
      return;
    }
    if (outcome === 'interrupted') {
      this.finishInterrupted(managed, 'recovered after reconnect');
      return;
    }

    let message = 'The session failed while the connection to the OpenCode server was down';
    try {
      const history = await this.client.getSessionMessages(managed.sessionId);
      const failed = history.find((entry) => entry.error?.message);
      if (failed?.error) message = failed.error.message;
    } catch (error) {
      logger.warn('Could not read the message history to explain a failed session', {
        sessionId: managed.sessionId,
        error: errorMessage(error),
      });
    }
    if (!this.isCurrent(managed)) return;
    this.finishFailed(managed, message);
  }

  // ==========================================================================
  // Commands
  // ==========================================================================

  private track(taskId: string, sessionId: string, directory?: string): ManagedSession {
    const previous = this.sessions.get(taskId);
    if (previous) this.sessionToTask.delete(previous.sessionId);

    const managed: ManagedSession = {
      taskId,
      sessionId,
      directory,
      status: 'starting',
      textAccumulator: '',
      consecutiveCompactions: 0,
      turnConfirmed: false,
      toolCalls: new Map(),
      seenPermissions: new Set(),
      seenForms: new Set(),
      queue: [],
      draining: false,
    };
    this.sessions.set(taskId, managed);
    this.sessionToTask.set(sessionId, taskId);
    return managed;
  }

  async startTask(payload: StartTaskPayload): Promise<void> {
    const { taskId, prompt, workingDirectory, modelId, folderPermissions, customPrompt, arenaId } = payload;

    logger.info('Starting task', { taskId, prompt: prompt.slice(0, 100), arenaId });

    // Clean up stale sessions — but skip cleanup for arena tasks (all 3 must coexist)
    if (!arenaId) {
      const staleTaskIds = Array.from(this.sessions.keys()).filter((id) => id !== taskId);
      for (const oldTaskId of staleTaskIds) {
        const managed = this.sessions.get(oldTaskId);
        logger.info('Cleaning up stale session', { oldTaskId, sessionId: managed?.sessionId, status: managed?.status });
        // A session still starting/active keeps running on the server after
        // local cleanup — consuming tokens and possibly executing tools.
        // Interrupt it server-side first (2026-06-12 review #21). Fire-and-forget:
        // a failed interrupt must not block the new task.
        if (managed && (managed.status === 'starting' || managed.status === 'active')) {
          this.client.interrupt(managed.sessionId).catch((err) => {
            logger.warn('Failed to interrupt stale session on server', {
              oldTaskId,
              sessionId: managed.sessionId,
              error: errorMessage(err),
            });
          });
        }
        this.cleanup(oldTaskId);
      }
    }

    this.emit('progress', { taskId, stage: 'configuring' });

    // Permissions are per session in v2: every session, arena ones included, carries its own rules.
    const session = await this.client.createSession({
      directory: workingDirectory,
      model: parseModelId(modelId),
      permissions: buildSessionPermissions(folderPermissions),
    });

    const managed = this.track(taskId, session.id, workingDirectory);

    logger.info('Session created', { taskId, sessionId: session.id });

    this.emit('started', { taskId, sessionId: session.id });
    this.emit('progress', { taskId, stage: 'executing' });

    // Fire-and-forget: session lifecycle is managed entirely via events, and a failure is
    // surfaced by sendTurn itself.
    this.sendTurn(managed, prompt, customPrompt);
  }

  async resumeSession(payload: ResumeSessionPayload): Promise<void> {
    const { taskId, sessionId, prompt, workingDirectory, modelId, folderPermissions, customPrompt, arenaId } = payload;

    logger.info('Resuming session', { taskId, sessionId, arenaId });

    this.emit('progress', { taskId, stage: 'configuring' });

    const permissions = buildSessionPermissions(folderPermissions);
    const model = parseModelId(modelId);

    // 1. Get the session. A 404 means it predates the upgrade (v1 ids are unknown to v2).
    let existing: Awaited<ReturnType<OpenCodeClient['getSession']>> | undefined;
    try {
      existing = await this.client.getSession(sessionId);
    } catch (error) {
      if (!(error instanceof OpenCodeHttpError && error.status === 404)) throw error;
      logger.warn('Session not found on the server; starting a new session in the same task', { taskId, sessionId });
    }

    let activeSessionId = sessionId;
    if (existing) {
      // 2. Reapply permissions: a revoked or changed folder grant has no effect on an existing session otherwise.
      await this.client.updateSession(sessionId, { permissions });
      // 3. Switch the model when it changed.
      if (model && (existing.model?.providerID !== model.providerID || existing.model?.id !== model.id)) {
        await this.client.switchModel(sessionId, model);
      }
    } else {
      const created = await this.client.createSession({
        directory: workingDirectory,
        model,
        permissions,
      });
      activeSessionId = created.id;
    }

    const managed = this.track(taskId, activeSessionId, workingDirectory);

    this.emit('started', { taskId, sessionId: activeSessionId });
    this.emit('progress', { taskId, stage: 'executing' });

    // 4 + 5. Refresh the instructions entry, then prompt (same fire-and-forget as startTask).
    if (prompt) {
      this.sendTurn(managed, prompt, customPrompt);
    }
  }

  /**
   * Write the system prompt into the session's instructions entry, then send the turn. Never throws:
   * a failure is surfaced as a task error or logged, depending on what it proves about the turn.
   */
  private async sendTurn(managed: ManagedSession, prompt: string, customPrompt?: string): Promise<void> {
    managed.status = 'active';
    managed.consecutiveCompactions = 0;
    try {
      await this.client.putInstructions(
        managed.sessionId,
        INSTRUCTIONS_KEY,
        buildSystemPrompt(this.serverPort, managed.directory ?? '.', customPrompt)
      );
      managed.promptSentAt = Date.now();
      await this.client.prompt(managed.sessionId, prompt);
    } catch (err) {
      this.handleSendFailure(managed, err);
    }
  }

  /**
   * An HTTP error response means the server refused: the turn never started, so surface it whatever
   * the events said. A failure without an HTTP status (timeout, socket reset) is ambiguous because
   * the input may already be admitted: an event that confirmed the turn means it is running
   * (2026-06-12 review #9).
   */
  private handleSendFailure(managed: ManagedSession, err: unknown): void {
    const msg = errorMessage(err);
    const { taskId, sessionId } = managed;

    if (this.sessions.get(taskId) !== managed) {
      logger.debug('prompt failed after the session ended — nothing to surface', { taskId, sessionId, error: msg });
      return;
    }

    const refused = err instanceof OpenCodeHttpError;
    if (!refused && managed.turnConfirmed) {
      logger.warn('prompt request failed after the turn started (session still active via events)', { taskId, sessionId, error: msg });
      return;
    }

    logger.error('prompt failed before the turn started — surfacing task error', { taskId, sessionId, error: msg, refused });
    managed.status = 'error';
    this.emit('error', {
      taskId,
      error: `Failed to send message to the model: ${msg}`,
      sessionId,
    });

    // The input may have been admitted: stop the orphaned session so it cannot keep running detached.
    if (!refused) {
      this.client.interrupt(sessionId).catch((interruptErr) => {
        logger.warn('Failed to interrupt orphaned session after prompt failure', { taskId, sessionId, error: errorMessage(interruptErr) });
      });
    }

    this.cleanup(taskId);
  }

  async abortSession(taskId: string, sessionId: string): Promise<void> {
    logger.info('Aborting session', { taskId, sessionId });

    const managed = this.sessions.get(taskId);
    const previousStatus = managed?.status;
    if (managed) {
      // Marks the abort as local: the interrupted event that follows must not complete the task a second time.
      managed.status = 'completing';
    }

    try {
      await this.client.interrupt(sessionId);
    } catch (error) {
      // The session keeps running, so its real completion must still be reported.
      if (managed && managed.status === 'completing' && previousStatus) managed.status = previousStatus;
      throw error;
    }

    this.emit('complete', {
      taskId,
      sessionId,
      status: 'aborted',
    });

    this.cleanup(taskId);
  }

  async replyToPermission(taskId: string, requestId: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void> {
    const sessionId = this.sessions.get(taskId)?.sessionId ?? this.permissionSessions.get(requestId);
    if (!sessionId) {
      throw new Error(`No active session for task ${taskId} and permission request ${requestId}`);
    }
    logger.info('Replying to permission', { taskId, requestId, reply, sessionId });
    await this.client.replyPermission(sessionId, requestId, reply, message);
    this.permissionSessions.delete(requestId);
  }

  async replyToQuestion(taskId: string, requestId: string, answers: QuestionAnswer[]): Promise<void> {
    const pending = this.pendingForms.get(requestId);
    if (!pending) {
      throw new Error(`No pending question ${requestId} (it may already be answered or cancelled)`);
    }

    const answer = buildFormAnswer(pending.bindings, answers);
    logger.info('Replying to question', { taskId, requestId, answer, sessionId: pending.sessionId });

    try {
      await this.client.replyForm(pending.sessionId, requestId, answer);
    } catch (error) {
      if (error instanceof OpenCodeHttpError && (error.body as { _tag?: string } | null)?._tag === 'FormInvalidAnswerError') {
        this.askAgain(requestId, pending, (error.body as { message?: string }).message ?? 'The answer was not accepted');
        return;
      }
      throw error;
    }
    this.pendingForms.delete(requestId);
  }

  /** The server refused an answer (FormInvalidAnswerError) and the form is still open: show the same questions again with the reason. */
  private askAgain(requestId: string, pending: PendingForm, reason: string): void {
    logger.warn('Question answer rejected by the server; asking again', { requestId, reason });
    const questions = pending.bindings.map((binding, index) =>
      index === 0 ? { ...binding.question, question: `Invalid answer: ${reason}\n\n${binding.question.question}` } : binding.question
    );
    this.emit('question-request', { taskId: pending.taskId, id: requestId, sessionId: pending.sessionId, questions });
  }

  /** Number of sessions currently tracked (started and not yet completed/cleaned up). */
  activeSessionCount(): number {
    return this.sessions.size;
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
    this.todosBySession.clear();
    this.permissionSessions.clear();
    this.pendingForms.clear();
    this.removeAllListeners();
  }
}
