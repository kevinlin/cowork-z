import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildSessionPermissions, buildSystemPrompt } from '../src/config-builder';
import type { EventStream } from '../src/event-stream';
import { type OpenCodeClient, OpenCodeHttpError } from '../src/opencode-client';
import { parseModelId, SessionManager } from '../src/session-manager';
import type { FolderPermission, FormInfo, OpenCodeEventFrame, PermissionAsk, SessionInfo, SessionMessage } from '../src/types';

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    serverEvent: jest.fn(),
    httpResponse: jest.fn(),
  },
}));

const PORT = 54_321;
const WS = '/tmp/cowork-spike/ws';
const TOOLS_SESSION = 'ses_e81fa3603ffep9Vfmr9Bxad0Fx';
const REJECT_SESSION = 'ses_e81f8f353ffey1kp6ay6Fp3z6B';

const FIXTURES = path.join(__dirname, 'fixtures', 'v2');
const loadFrames = (name: string): OpenCodeEventFrame[] =>
  fs
    .readFileSync(path.join(FIXTURES, name), 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
const loadHistory = (): SessionMessage[] => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'session-messages.json'), 'utf-8')).data;

const sessionInfo = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  time: { created: 1, updated: 1 },
  location: { directory: '/test' },
  ...extra,
});

function createMockClient() {
  return {
    createSession: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(sessionInfo('ses_123')),
    getSession: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(sessionInfo('ses_456')),
    updateSession: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
    switchModel: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
    putInstructions: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
    prompt: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({}),
    interrupt: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ interrupted: true }),
    getSessionMessages: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([]),
    listSessionPermissions: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([]),
    listSessionForms: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([]),
    replyPermission: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
    replyForm: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
    cancelForm: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(undefined),
  };
}
type MockClient = ReturnType<typeof createMockClient>;

const EVENT_NAMES = [
  'started',
  'progress',
  'message-partial',
  'message-complete',
  'tool-use',
  'permission-request',
  'question-request',
  'complete',
  'error',
  'todo-updated',
] as const;

/** Record every event the manager emits, in order. */
function record(manager: SessionManager) {
  const log: Array<{ name: string; data: any }> = [];
  for (const name of EVENT_NAMES) {
    manager.on(name, (data: unknown) => log.push({ name, data }));
  }
  return { log, of: (name: string) => log.filter((entry) => entry.name === name).map((entry) => entry.data) };
}

/** Let promise chains and fire-and-forget calls settle. */
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Deliver frames the way EventStream does: emit(type, data). */
function replay(stream: EventStream, frames: OpenCodeEventFrame[]) {
  for (const frame of frames) (stream as unknown as EventEmitter).emit(frame.type, frame.data);
}

const rwWorkspace: FolderPermission[] = [{ path: '/test', accessLevel: 'read-write', source: 'workspace' }];

describe('parseModelId', () => {
  it('splits a composite id at the first slash', () => {
    expect(parseModelId('anthropic/claude-sonnet-4-5')).toEqual({ providerID: 'anthropic', id: 'claude-sonnet-4-5' });
    expect(parseModelId('openrouter/minimax/minimax-m2.5')).toEqual({ providerID: 'openrouter', id: 'minimax/minimax-m2.5' });
  });

  it('maps the github-copilot-enterprise prefix onto the single v2 provider github-copilot', () => {
    expect(parseModelId('github-copilot-enterprise/claude-haiku-5.5')).toEqual({ providerID: 'github-copilot', id: 'claude-haiku-5.5' });
  });

  it('leaves github-copilot ids alone', () => {
    expect(parseModelId('github-copilot/claude-haiku-5.5')).toEqual({ providerID: 'github-copilot', id: 'claude-haiku-5.5' });
  });

  it('returns undefined for no id or an id without a provider', () => {
    expect(parseModelId(undefined)).toBeUndefined();
    expect(parseModelId('')).toBeUndefined();
    expect(parseModelId('claude')).toBeUndefined();
    expect(parseModelId('/claude')).toBeUndefined();
  });
});

describe('SessionManager', () => {
  let client: MockClient;
  let eventStream: EventStream;
  let manager: SessionManager;

  const emit = (type: string, data: unknown) => (eventStream as unknown as EventEmitter).emit(type, data);

  const start = async (overrides: Record<string, unknown> = {}) => {
    await manager.startTask({ taskId: 'task_1', prompt: 'Do something', workingDirectory: '/test', ...overrides });
    await flush();
  };

  beforeEach(() => {
    client = createMockClient();
    eventStream = new EventEmitter() as unknown as EventStream;
    manager = new SessionManager(client as unknown as OpenCodeClient, eventStream, PORT);
  });

  describe('startTask', () => {
    it('creates the session with location, model and permissions, writes the instructions entry, then prompts with only the text', async () => {
      const events: string[] = [];
      manager.on('progress', (data) => events.push(`progress:${data.stage}`));
      manager.on('started', () => events.push('started'));

      await start({ modelId: 'anthropic/claude-sonnet-4-5', folderPermissions: rwWorkspace, customPrompt: 'Be brief.' });

      expect(client.createSession).toHaveBeenCalledWith({
        directory: '/test',
        model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
        permissions: buildSessionPermissions(rwWorkspace),
      });
      const prompt = buildSystemPrompt(PORT, '/test', 'Be brief.');
      expect(client.putInstructions).toHaveBeenCalledWith('ses_123', 'cowork-z', prompt);
      expect(client.prompt).toHaveBeenCalledTimes(1);
      expect(client.prompt.mock.calls[0]).toEqual(['ses_123', 'Do something']);
      expect(events).toEqual(['progress:configuring', 'started', 'progress:executing']);

      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(client.createSession)).toBeLessThan(order(client.putInstructions));
      expect(order(client.putInstructions)).toBeLessThan(order(client.prompt));
    });

    it('keeps the model composite id intact after the first slash (openrouter models contain slashes)', async () => {
      await start({ modelId: 'openrouter/minimax/minimax-m2.5' });

      expect(client.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: { providerID: 'openrouter', id: 'minimax/minimax-m2.5' } })
      );
    });

    it('creates the session on github-copilot for a stored github-copilot-enterprise model id', async () => {
      await start({ modelId: 'github-copilot-enterprise/claude-haiku-5.5' });

      expect(client.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ model: { providerID: 'github-copilot', id: 'claude-haiku-5.5' } })
      );
    });

    it('sends no model when none was chosen, and still sends the leading external_directory ask rule', async () => {
      await manager.startTask({ taskId: 'task_1', prompt: 'Do something' });

      const body = client.createSession.mock.calls[0][0];
      expect(body.model).toBeUndefined();
      expect(body.permissions).toEqual([{ action: 'external_directory', resource: '*', effect: 'ask' }]);
    });

    it('does not send a title: v2 names the session itself (session.renamed)', async () => {
      await manager.startTask({ taskId: 'task_1', prompt: 'A'.repeat(100) });

      expect(client.createSession.mock.calls[0][0]).not.toHaveProperty('title');
    });

    it('makes no PATCH /config call: the client has no config method for a session to use', async () => {
      await start({ skipConfig: true });

      expect(Object.keys(client)).not.toContain('updateConfig');
      expect(client.createSession).toHaveBeenCalledTimes(1);
    });

    it('gives each arena session its own permissions even when skipConfig is set', async () => {
      await start({ arenaId: 'arena_1', skipConfig: true, folderPermissions: rwWorkspace });

      expect(client.createSession.mock.calls[0][0].permissions).toEqual(buildSessionPermissions(rwWorkspace));
    });
  });

  describe('resumeSession', () => {
    const resume = async (overrides: Record<string, unknown> = {}) => {
      await manager.resumeSession({
        taskId: 'task_2',
        sessionId: 'ses_456',
        prompt: 'Continue working',
        workingDirectory: '/test',
        ...overrides,
      });
      await flush();
    };

    it('reapplies permissions with PATCH /api/session/{id}, refreshes the instructions entry and prompts, in that order', async () => {
      const events: string[] = [];
      manager.on('started', () => events.push('started'));
      manager.on('progress', (data) => events.push(`progress:${data.stage}`));

      await resume({ folderPermissions: rwWorkspace });

      expect(client.getSession).toHaveBeenCalledWith('ses_456');
      expect(client.updateSession).toHaveBeenCalledWith('ses_456', { permissions: buildSessionPermissions(rwWorkspace) });
      expect(client.putInstructions).toHaveBeenCalledWith('ses_456', 'cowork-z', buildSystemPrompt(PORT, '/test'));
      expect(client.prompt.mock.calls[0]).toEqual(['ses_456', 'Continue working']);
      expect(client.createSession).not.toHaveBeenCalled();
      expect(events).toEqual(['progress:configuring', 'started', 'progress:executing']);

      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(client.getSession)).toBeLessThan(order(client.updateSession));
      expect(order(client.updateSession)).toBeLessThan(order(client.putInstructions));
      expect(order(client.putInstructions)).toBeLessThan(order(client.prompt));
    });

    it('applies a revoked folder grant: the new rule list replaces the old one', async () => {
      await resume({ folderPermissions: [...rwWorkspace, { path: '/tmp/granted', accessLevel: 'read', source: 'user' }] });
      await resume({ taskId: 'task_3', folderPermissions: rwWorkspace });

      const [, second] = client.updateSession.mock.calls;
      expect(second[1].permissions).toEqual(buildSessionPermissions(rwWorkspace));
      expect(JSON.stringify(second[1].permissions)).not.toContain('/tmp/granted');
    });

    it('switches the model when the session runs another one', async () => {
      client.getSession.mockResolvedValue(sessionInfo('ses_456', { model: { providerID: 'anthropic', id: 'claude-old' } }));

      await resume({ modelId: 'anthropic/claude-new' });

      expect(client.switchModel).toHaveBeenCalledWith('ses_456', { providerID: 'anthropic', id: 'claude-new' });
      const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
      expect(order(client.updateSession)).toBeLessThan(order(client.switchModel));
      expect(order(client.switchModel)).toBeLessThan(order(client.putInstructions));
    });

    it('does not switch the model when it is unchanged', async () => {
      client.getSession.mockResolvedValue(sessionInfo('ses_456', { model: { providerID: 'anthropic', id: 'claude-same' } }));

      await resume({ modelId: 'anthropic/claude-same' });

      expect(client.switchModel).not.toHaveBeenCalled();
    });

    it('does not touch the model when the payload names none', async () => {
      await resume();

      expect(client.switchModel).not.toHaveBeenCalled();
    });

    it('creates a new session in the same task when the old id is unknown (404), carrying permissions and model on create', async () => {
      client.getSession.mockRejectedValueOnce(new OpenCodeHttpError(404, { _tag: 'SessionNotFoundError' }));
      client.createSession.mockResolvedValueOnce(sessionInfo('ses_new'));
      const { of } = record(manager);

      await resume({ modelId: 'anthropic/claude-new', folderPermissions: rwWorkspace });

      expect(client.createSession).toHaveBeenCalledWith({
        directory: '/test',
        model: { providerID: 'anthropic', id: 'claude-new' },
        permissions: buildSessionPermissions(rwWorkspace),
      });
      expect(client.updateSession).not.toHaveBeenCalled();
      expect(client.switchModel).not.toHaveBeenCalled();
      expect(client.putInstructions).toHaveBeenCalledWith('ses_new', 'cowork-z', expect.any(String));
      expect(client.prompt.mock.calls[0]).toEqual(['ses_new', 'Continue working']);
      expect(of('started')).toEqual([{ taskId: 'task_2', sessionId: 'ses_new' }]);
    });

    it('lets other getSession failures through', async () => {
      client.getSession.mockRejectedValueOnce(new OpenCodeHttpError(500, { error: 'boom' }));

      await expect(manager.resumeSession({ taskId: 'task_2', sessionId: 'ses_456', prompt: 'x' })).rejects.toThrow('HTTP 500');
      expect(client.createSession).not.toHaveBeenCalled();
    });

    it('does not prompt or write instructions when no prompt is provided', async () => {
      await resume({ prompt: undefined });

      expect(client.getSession).toHaveBeenCalledWith('ses_456');
      expect(client.updateSession).toHaveBeenCalled();
      expect(client.putInstructions).not.toHaveBeenCalled();
      expect(client.prompt).not.toHaveBeenCalled();
    });
  });

  describe('stale session cleanup (2026-06-12 review #21)', () => {
    it('interrupts a still-active stale session on the server when a new task starts', async () => {
      await start({ taskId: 'task_old', prompt: 'First task' });
      client.createSession.mockResolvedValueOnce(sessionInfo('ses_new'));

      await start({ taskId: 'task_new', prompt: 'Second task' });

      expect(client.interrupt).toHaveBeenCalledWith('ses_123');
      expect(manager.activeSessionCount()).toBe(1);
    });

    it('does not interrupt a stale session that already completed', async () => {
      await start({ taskId: 'task_old', prompt: 'First task' });
      emit('session.execution.succeeded', { sessionID: 'ses_123' });
      expect(manager.activeSessionCount()).toBe(0);

      await start({ taskId: 'task_new', prompt: 'Second task' });

      expect(client.interrupt).not.toHaveBeenCalled();
    });

    it('does not interrupt coexisting arena sessions', async () => {
      await start({ taskId: 'task_arena_1', prompt: 'Arena slot 1', arenaId: 'arena_1' });
      client.createSession.mockResolvedValueOnce(sessionInfo('ses_arena_2'));

      await start({ taskId: 'task_arena_2', prompt: 'Arena slot 2', arenaId: 'arena_1' });

      expect(client.interrupt).not.toHaveBeenCalled();
      expect(manager.activeSessionCount()).toBe(2);
    });
  });

  describe('prompt failure surfacing (2026-06-12 review #9, v2 rules)', () => {
    const deferred = () => {
      let reject!: (err: Error) => void;
      const promise = new Promise<never>((_resolve, rej) => {
        reject = rej;
      });
      return { promise, reject };
    };

    it('transport failure before any event confirmed the turn: emits task error and interrupts the session', async () => {
      client.prompt.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      const { of } = record(manager);

      await start();

      expect(of('error')).toHaveLength(1);
      expect(of('error')[0]).toEqual(expect.objectContaining({ taskId: 'task_1', sessionId: 'ses_123' }));
      expect(of('error')[0].error).toContain('ECONNREFUSED');
      expect(client.interrupt).toHaveBeenCalledWith('ses_123');
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('transport failure after an event confirmed the turn: stays quiet and keeps tracking', async () => {
      const pending = deferred();
      client.prompt.mockReturnValueOnce(pending.promise);
      const { of } = record(manager);
      await start();

      emit('session.execution.started', { sessionID: 'ses_123' });
      pending.reject(new Error('socket hang up'));
      await flush();

      expect(of('error')).toHaveLength(0);
      expect(client.interrupt).not.toHaveBeenCalled();
      expect(manager.activeSessionCount()).toBe(1);
    });

    it('HTTP error response: emits task error and cleans up even when an event already confirmed the turn', async () => {
      const pending = deferred();
      client.prompt.mockReturnValueOnce(pending.promise);
      const { of } = record(manager);
      await start();

      emit('session.execution.started', { sessionID: 'ses_123' });
      pending.reject(new OpenCodeHttpError(500, { error: 'model unavailable' }));
      await flush();

      expect(of('error')).toHaveLength(1);
      expect(of('error')[0].error).toContain('HTTP 500');
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('HTTP error response: the turn never started, so there is nothing to interrupt', async () => {
      client.prompt.mockRejectedValueOnce(new OpenCodeHttpError(401, { error: 'unauthorized' }));
      record(manager);

      await start();

      expect(client.interrupt).not.toHaveBeenCalled();
    });

    it('a failed instructions write is an HTTP error too: task error and no prompt', async () => {
      client.putInstructions.mockRejectedValueOnce(new OpenCodeHttpError(400, { error: 'bad value' }));
      const { of } = record(manager);

      await start();

      expect(of('error')).toHaveLength(1);
      expect(client.prompt).not.toHaveBeenCalled();
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('a resumed session whose follow-up prompt fails unconfirmed emits task error and interrupts', async () => {
      client.prompt.mockRejectedValueOnce(new Error('401 Unauthorized'));
      const { of } = record(manager);

      await manager.resumeSession({ taskId: 'task_2', sessionId: 'ses_456', prompt: 'Continue working', workingDirectory: '/test' });
      await flush();

      expect(of('error')).toHaveLength(1);
      expect(of('error')[0].taskId).toBe('task_2');
      expect(of('error')[0].error).toContain('401');
      expect(client.interrupt).toHaveBeenCalledWith('ses_456');
    });
  });

  describe('abortSession', () => {
    it('interrupts the session and emits one complete event with status aborted', async () => {
      await start({ workingDirectory: undefined });
      const { of } = record(manager);

      await manager.abortSession('task_1', 'ses_123');

      expect(client.interrupt).toHaveBeenCalledWith('ses_123');
      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'aborted' }]);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('ignores the interrupted event that follows a local abort (no duplicate completion)', async () => {
      await start();
      const { of } = record(manager);

      await manager.abortSession('task_1', 'ses_123');
      emit('session.execution.interrupted', { sessionID: 'ses_123', reason: 'user' });
      await flush();

      expect(of('complete')).toHaveLength(1);
      expect(of('complete')[0].status).toBe('aborted');
    });

    it('ignores an interrupted event that arrives while the interrupt request is still in flight', async () => {
      await start();
      const { of } = record(manager);
      let release!: () => void;
      client.interrupt.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ interrupted: true });
        })
      );

      const aborting = manager.abortSession('task_1', 'ses_123');
      emit('session.execution.interrupted', { sessionID: 'ses_123', reason: 'user' });
      expect(of('complete')).toHaveLength(0);
      release();
      await aborting;

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'aborted' }]);
    });

    it('a failed interrupt leaves the session running, so its real completion is still reported', async () => {
      await start();
      const { of } = record(manager);
      client.interrupt.mockRejectedValueOnce(new Error('network down'));

      await expect(manager.abortSession('task_1', 'ses_123')).rejects.toThrow('network down');
      emit('session.execution.succeeded', { sessionID: 'ses_123' });

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'success' }]);
    });
  });

  describe('replyToPermission', () => {
    it('forwards the decision to the session permission reply route', async () => {
      await start();
      emit('permission.asked', { id: 'per_123', sessionID: 'ses_123', action: 'edit', resources: ['Misc/b.txt'] });

      await manager.replyToPermission('task_1', 'per_123', 'once', 'allowed');

      expect(client.replyPermission).toHaveBeenCalledWith('ses_123', 'per_123', 'once', 'allowed');
    });

    it('sends reject without a message', async () => {
      await start();

      await manager.replyToPermission('task_1', 'per_9', 'reject');

      expect(client.replyPermission).toHaveBeenCalledWith('ses_123', 'per_9', 'reject', undefined);
    });

    it('still reaches the right session after a rejection ended the turn and cleaned the task up', async () => {
      await start();
      emit('permission.asked', { id: 'per_5', sessionID: 'ses_123', action: 'edit', resources: ['notes.txt'] });
      emit('session.execution.interrupted', { sessionID: 'ses_123', reason: 'shutdown' });
      expect(manager.activeSessionCount()).toBe(0);

      await manager.replyToPermission('task_1', 'per_5', 'reject');

      expect(client.replyPermission).toHaveBeenCalledWith('ses_123', 'per_5', 'reject', undefined);
    });

    it('rejects when the request and the task are both unknown', async () => {
      await expect(manager.replyToPermission('task_x', 'per_unknown', 'once')).rejects.toThrow(/no active session/i);
    });
  });

  describe('replyToQuestion', () => {
    const colorForm: FormInfo = {
      id: 'frm_1',
      sessionID: 'ses_123',
      title: 'Questions',
      fields: [
        {
          key: 'q0',
          title: 'Color choice',
          description: 'Which color?',
          type: 'string',
          options: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
          ],
          custom: true,
        },
      ],
    };

    it('forwards the mapped answer to the session form reply route', async () => {
      await start();
      emit('form.created', { form: colorForm });

      await manager.replyToQuestion('task_1', 'frm_1', [{ labels: ['Blue'] }]);

      expect(client.replyForm).toHaveBeenCalledWith('ses_123', 'frm_1', { q0: 'blue' });
    });

    it('sends typed custom text as the answer', async () => {
      await start();
      emit('form.created', { form: colorForm });

      await manager.replyToQuestion('task_1', 'frm_1', [{ labels: [], customText: 'green' }]);

      expect(client.replyForm).toHaveBeenCalledWith('ses_123', 'frm_1', { q0: 'green' });
    });

    it('rejects a reply for a form it never showed', async () => {
      await start();

      await expect(manager.replyToQuestion('task_1', 'frm_nope', [{ labels: ['Red'] }])).rejects.toThrow(/frm_nope/);
      expect(client.replyForm).not.toHaveBeenCalled();
    });

    it('asks again when the server rejects the answer (FormInvalidAnswerError): same request id, note on the first question, no error thrown', async () => {
      await start();
      const numberForm: FormInfo = {
        id: 'frm_n',
        sessionID: 'ses_123',
        title: 'Q',
        fields: [{ key: 'n', description: 'How many?', type: 'integer' }],
      };
      emit('form.created', { form: numberForm });
      const { of } = record(manager);
      client.replyForm.mockRejectedValueOnce(
        new OpenCodeHttpError(400, { _tag: 'FormInvalidAnswerError', id: 'frm_n', message: 'n must be an integer' })
      );

      await manager.replyToQuestion('task_1', 'frm_n', [{ labels: [], customText: 'lots' }]);

      expect(client.replyForm).toHaveBeenCalledWith('ses_123', 'frm_n', { n: 'lots' });
      expect(of('question-request')).toHaveLength(1);
      expect(of('question-request')[0].id).toBe('frm_n');
      expect(of('question-request')[0].questions[0].question).toContain('n must be an integer');
      expect(of('question-request')[0].questions[0].question).toContain('How many?');

      // The retry goes through the same form
      await manager.replyToQuestion('task_1', 'frm_n', [{ labels: [], customText: '3' }]);
      expect(client.replyForm).toHaveBeenLastCalledWith('ses_123', 'frm_n', { n: 3 });
    });

    it('throws other reply failures so the host can show them', async () => {
      await start();
      emit('form.created', { form: colorForm });
      client.replyForm.mockRejectedValueOnce(new OpenCodeHttpError(404, { _tag: 'FormNotFoundError', message: 'gone' }));

      await expect(manager.replyToQuestion('task_1', 'frm_1', [{ labels: ['Red'] }])).rejects.toThrow('HTTP 404');
    });
  });

  describe('SSE event handling', () => {
    it('emits progress when the execution starts', async () => {
      await start();
      const { of } = record(manager);

      emit('session.execution.started', { sessionID: 'ses_123' });

      expect(of('progress')).toEqual([{ taskId: 'task_1', stage: 'executing' }]);
    });

    it('emits complete with status success when the execution succeeds', async () => {
      await start();
      const { of } = record(manager);

      emit('session.execution.succeeded', { sessionID: 'ses_123' });

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'success' }]);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('emits message-partial on text deltas, accumulating the text', async () => {
      await start();
      const { of } = record(manager);

      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'Hello ' });
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'world!' });

      expect(of('message-partial')).toHaveLength(2);
      expect(of('message-partial')[0]).toEqual({
        taskId: 'task_1',
        messageId: 'msg_1',
        textSoFar: 'Hello ',
        delta: 'Hello ',
        isStreaming: true,
      });
      expect(of('message-partial')[1]).toEqual(expect.objectContaining({ delta: 'world!', textSoFar: 'Hello world!' }));
    });

    it('flushes the previous message as message-complete when a new assistant message starts streaming', async () => {
      await start();
      const { log } = record(manager);

      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'First' });
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_2', ordinal: 0, delta: 'Second' });

      expect(log.map((e) => e.name)).toEqual(['message-partial', 'message-complete', 'message-partial']);
      expect(log[1].data).toEqual({ taskId: 'task_1', messageId: 'msg_1', text: 'First' });
      expect(log[2].data.textSoFar).toBe('Second');
    });

    it('emits message-complete with the accumulated text before complete', async () => {
      await start();
      const { log } = record(manager);
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'Final answer' });

      emit('session.execution.succeeded', { sessionID: 'ses_123' });

      const tail = log.slice(-2);
      expect(tail.map((e) => e.name)).toEqual(['message-complete', 'complete']);
      expect(tail[0].data).toEqual({ taskId: 'task_1', messageId: 'msg_1', text: 'Final answer' });
    });

    it('emits tool-use with a rebuilt v1 part: running on called, completed on success with string output', async () => {
      await start();
      const { of } = record(manager);

      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', name: 'write' });
      emit('session.tool.called', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        input: { path: 'Output/a.txt', content: 'hi' },
      });
      emit('session.tool.success', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        content: [{ type: 'text', text: 'Created file successfully: Output/a.txt' }],
      });
      await flush();

      const parts = of('tool-use').map((e) => e.part);
      expect(of('tool-use')[0].taskId).toBe('task_1');
      expect(parts).toEqual([
        {
          type: 'tool',
          tool: 'write',
          callID: 'call_1',
          messageID: 'msg_1',
          sessionID: 'ses_123',
          state: { status: 'running', input: { path: 'Output/a.txt', content: 'hi' } },
          time: { start: expect.any(Number) },
        },
        {
          type: 'tool',
          tool: 'write',
          callID: 'call_1',
          messageID: 'msg_1',
          sessionID: 'ses_123',
          state: { status: 'completed', input: { path: 'Output/a.txt', content: 'hi' }, output: 'Created file successfully: Output/a.txt' },
          time: { start: parts[0].time.start },
        },
      ]);
    });

    it('names tools the way the frontend expects: shell becomes bash and subagent becomes task', async () => {
      await start();
      const { of } = record(manager);

      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_sh', name: 'shell' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_sh', input: { command: 'ls' } });
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_sub', name: 'subagent' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_sub', input: {} });
      await flush();

      expect(of('tool-use').map((e) => e.part.tool)).toEqual(['bash', 'task']);
    });

    it('joins text items with newlines and writes file items as [file: name or uri]', async () => {
      await start();
      const { of } = record(manager);
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', name: 'read' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', input: {} });

      emit('session.tool.success', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
          { type: 'file', uri: 'file:///tmp/b.bin', mime: 'application/octet-stream' },
          { type: 'text', text: 'line two' },
        ],
      });
      await flush();

      expect(of('tool-use')[1].part.state.output).toBe('line one\n[file: a.png]\n[file: file:///tmp/b.bin]\nline two');
    });

    it('turns a failed tool into status error with the error message as output', async () => {
      await start();
      const { of } = record(manager);
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', name: 'write' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', input: { path: 'Input/c.txt' } });

      emit('session.tool.failed', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        error: { type: 'permission.rejected', message: 'Permission denied: edit' },
      });
      await flush();

      expect(of('tool-use')[1].part.state).toEqual({ status: 'error', input: { path: 'Input/c.txt' }, output: 'Permission denied: edit' });
    });

    it('emits permission-request with resources as patterns and maps shell back to bash', async () => {
      await start();
      const { of } = record(manager);

      emit('permission.asked', {
        id: 'per_1',
        sessionID: 'ses_123',
        action: 'shell',
        resources: ['ls -la'],
        metadata: { command: 'ls -la' },
      });

      expect(of('permission-request')).toEqual([
        { taskId: 'task_1', id: 'per_1', sessionId: 'ses_123', permission: 'bash', patterns: ['ls -la'], metadata: { command: 'ls -la' } },
      ]);
    });

    it('defaults permission metadata to an empty object', async () => {
      await start();
      const { of } = record(manager);

      emit('permission.asked', { id: 'per_1', sessionID: 'ses_123', action: 'external_directory', resources: ['/etc/*'] });

      expect(of('permission-request')[0]).toEqual(
        expect.objectContaining({ permission: 'external_directory', patterns: ['/etc/*'], metadata: {} })
      );
    });

    it('emits question-request on form.created with the form id and the mapped questions', async () => {
      await start();
      const { of } = record(manager);

      emit('form.created', {
        form: {
          id: 'frm_1',
          sessionID: 'ses_123',
          title: 'Questions',
          fields: [
            {
              key: 'q0',
              description: 'Which option?',
              type: 'string',
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
              custom: false,
            },
          ],
        },
      });

      expect(of('question-request')).toEqual([
        {
          taskId: 'task_1',
          id: 'frm_1',
          sessionId: 'ses_123',
          questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false, custom: false }],
        },
      ]);
    });

    it('cancels a form it cannot show (external field) instead of asking the user', async () => {
      await start();
      const { of } = record(manager);

      emit('form.created', {
        form: {
          id: 'frm_x',
          sessionID: 'ses_123',
          title: 'Sign in',
          fields: [{ key: 'auth', type: 'external', url: 'https://example.test/auth' }],
        },
      });
      await flush();

      expect(of('question-request')).toHaveLength(0);
      expect(client.cancelForm).toHaveBeenCalledWith('ses_123', 'frm_x', expect.stringMatching(/external/i));
    });

    it('emits error on execution.failed with the error message and cleans up', async () => {
      await start();
      const { of } = record(manager);

      emit('session.execution.failed', { sessionID: 'ses_123', error: { type: 'provider', message: 'API rate limit exceeded' } });

      expect(of('error')).toEqual([{ taskId: 'task_1', error: 'API rate limit exceeded', sessionId: 'ses_123' }]);
      expect(of('complete')).toHaveLength(0);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('treats an interrupted execution without a local abort as a finished turn (a rejected permission ends the turn this way)', async () => {
      await start();
      const { log } = record(manager);
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'I could not do that.' });

      emit('session.execution.interrupted', { sessionID: 'ses_123', reason: 'shutdown' });

      expect(log.slice(-2).map((e) => e.name)).toEqual(['message-complete', 'complete']);
      expect(log[log.length - 1].data).toEqual({ taskId: 'task_1', sessionId: 'ses_123', status: 'success' });
      expect(log.some((e) => e.name === 'error')).toBe(false);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('ignores events for unknown sessions', () => {
      const { log } = record(manager);

      emit('session.execution.started', { sessionID: 'unknown_session' });
      emit('session.text.delta', { sessionID: 'unknown_session', assistantMessageID: 'msg_1', ordinal: 0, delta: 'x' });
      emit('permission.asked', { id: 'per_1', sessionID: 'unknown_session', action: 'edit', resources: ['a'] });
      emit('form.created', { form: { id: 'frm_1', sessionID: 'unknown_session', title: 'Q', fields: [{ key: 'q', type: 'string' }] } });

      expect(log).toHaveLength(0);
    });
  });

  describe('todos (2.3)', () => {
    const todoInput = {
      todos: [
        { content: 'Plan', status: 'in_progress' },
        { content: 'Build', status: 'pending' },
      ],
    };
    const callTodowrite = (id = 'call_todo', input: unknown = todoInput) => {
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id, name: 'todowrite' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id, input });
    };

    it('emits todo-updated with todos mapped to {id: index, content, status, priority: medium}', async () => {
      await start();
      const { of } = record(manager);

      callTodowrite();
      await flush();

      expect(of('todo-updated')).toEqual([
        {
          taskId: 'task_1',
          todos: [
            { id: '0', content: 'Plan', status: 'in_progress', priority: 'medium' },
            { id: '1', content: 'Build', status: 'pending', priority: 'medium' },
          ],
        },
      ]);
    });

    it('still emits the tool-use card for the todowrite call', async () => {
      await start();
      const { of } = record(manager);

      callTodowrite();
      await flush();

      expect(of('tool-use').map((e) => e.part.tool)).toEqual(['todowrite']);
    });

    it('keeps the last-seen todos per session for get_session_todos, also after the session ended', async () => {
      await start();
      callTodowrite('call_a');
      callTodowrite('call_b', { todos: [{ content: 'Only', status: 'completed' }] });
      await flush();

      expect(manager.getSessionTodos('ses_123')).toEqual([{ id: '0', content: 'Only', status: 'completed', priority: 'medium' }]);

      emit('session.execution.succeeded', { sessionID: 'ses_123' });
      expect(manager.getSessionTodos('ses_123')).toEqual([{ id: '0', content: 'Only', status: 'completed', priority: 'medium' }]);
    });

    it('has no todos for a session that never wrote any', async () => {
      await start();

      expect(manager.getSessionTodos('ses_123')).toBeUndefined();
      expect(manager.getSessionTodos('ses_other')).toBeUndefined();
    });

    it('ignores a todowrite input that carries no todo list', async () => {
      await start();
      const { of } = record(manager);

      callTodowrite('call_bad', { nope: true });
      await flush();

      expect(of('todo-updated')).toHaveLength(0);
      expect(manager.getSessionTodos('ses_123')).toBeUndefined();
    });
  });

  describe('todos after a sidecar restart (2.3)', () => {
    const todoItem = (todos: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'tool',
      id: 'toolu_x',
      name: 'todowrite',
      state: { status: 'completed', input: { todos } },
      ...extra,
    });
    const assistant = (id: string, content: unknown[]) => ({ id, type: 'assistant', content });

    it('rebuilds the newest todo list from session-messages.json when nothing is in memory', async () => {
      client.getSessionMessages.mockResolvedValue(loadHistory());

      const todos = await manager.loadSessionTodos('ses_cold');

      expect(client.getSessionMessages).toHaveBeenCalledWith('ses_cold');
      // The fixture holds two todowrite calls: the in-progress one early on, the completed one later. Newest wins.
      expect(todos).toEqual([
        { id: '0', content: 'Ask the user a red/blue multiple-choice question', status: 'completed', priority: 'medium' },
        {
          id: '1',
          content: 'Write hi to Output/a.txt, Misc/b.txt, Input/c.txt and read /etc/hosts, then reply DONE',
          status: 'completed',
          priority: 'medium',
        },
      ]);
    });

    it('caches the rebuilt list: the next ask is answered from memory', async () => {
      client.getSessionMessages.mockResolvedValue(loadHistory());

      const first = await manager.loadSessionTodos('ses_cold');
      const second = await manager.loadSessionTodos('ses_cold');

      expect(second).toEqual(first);
      expect(manager.getSessionTodos('ses_cold')).toEqual(first);
      expect(client.getSessionMessages).toHaveBeenCalledTimes(1);
    });

    it('does not read the history when the todos are already in memory', async () => {
      await start();
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', name: 'todowrite' });
      emit('session.tool.called', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'call_1',
        input: { todos: [{ content: 'Live', status: 'pending' }] },
      });
      await flush();

      await expect(manager.loadSessionTodos('ses_123')).resolves.toEqual([
        { id: '0', content: 'Live', status: 'pending', priority: 'medium' },
      ]);

      expect(client.getSessionMessages).not.toHaveBeenCalled();
    });

    it('answers undefined (todos: null for the UI) when the history has no todowrite call', async () => {
      client.getSessionMessages.mockResolvedValue(
        loadHistory().filter((message) => !message.content?.some((item) => item.name === 'todowrite'))
      );

      await expect(manager.loadSessionTodos('ses_cold')).resolves.toBeUndefined();

      expect(manager.getSessionTodos('ses_cold')).toBeUndefined();
    });

    it('answers undefined for an empty history', async () => {
      client.getSessionMessages.mockResolvedValue([]);

      await expect(manager.loadSessionTodos('ses_cold')).resolves.toBeUndefined();
    });

    it('answers undefined, and does not throw, when the history cannot be read', async () => {
      client.getSessionMessages.mockRejectedValue(new Error('connection refused'));

      await expect(manager.loadSessionTodos('ses_cold')).resolves.toBeUndefined();
    });

    it('skips a todowrite call without a todo list and uses the next older one', async () => {
      client.getSessionMessages.mockResolvedValue([
        assistant('msg_3', [todoItem(undefined, { state: { status: 'pending', input: {} } })]),
        assistant('msg_2', [{ type: 'tool', id: 't2', name: 'read', state: { status: 'completed', input: { path: 'a' } } }]),
        assistant('msg_1', [todoItem([{ content: 'Older', status: 'in_progress' }])]),
      ] as SessionMessage[]);

      await expect(manager.loadSessionTodos('ses_cold')).resolves.toEqual([
        { id: '0', content: 'Older', status: 'in_progress', priority: 'medium' },
      ]);
    });

    it('takes the last todowrite of a message that holds several, since content is in call order', async () => {
      client.getSessionMessages.mockResolvedValue([
        assistant('msg_1', [
          todoItem([{ content: 'First write', status: 'pending' }], { id: 'a' }),
          todoItem([{ content: 'Second write', status: 'completed' }], { id: 'b' }),
        ]),
      ] as SessionMessage[]);

      await expect(manager.loadSessionTodos('ses_cold')).resolves.toEqual([
        { id: '0', content: 'Second write', status: 'completed', priority: 'medium' },
      ]);
    });
  });

  describe('tool-name fallback from the message history', () => {
    it('looks the call id up in GET /api/session/{id}/message when input.started was missed', async () => {
      await start();
      client.getSessionMessages.mockResolvedValue(loadHistory());
      const { of } = record(manager);

      emit('session.tool.called', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'toolu_01PXrnZLZsPcKN2dFFJZ2mVM',
        input: { todos: [{ content: 'A', status: 'pending' }] },
      });
      await flush();

      expect(client.getSessionMessages).toHaveBeenCalledWith('ses_123');
      expect(of('tool-use')[0].part.tool).toBe('todowrite');
      expect(of('todo-updated')).toHaveLength(1);
    });

    it('uses the name "tool" when the history does not know the call', async () => {
      await start();
      client.getSessionMessages.mockResolvedValue(loadHistory());
      const { of } = record(manager);

      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'toolu_unknown', input: {} });
      await flush();

      expect(of('tool-use')[0].part.tool).toBe('tool');
    });

    it('uses the name "tool" when the history request fails', async () => {
      await start();
      client.getSessionMessages.mockRejectedValue(new Error('offline'));
      const { of } = record(manager);

      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'toolu_x', input: {} });
      await flush();

      expect(of('tool-use')[0].part.tool).toBe('tool');
    });

    it('does not look anything up when input.started supplied the name', async () => {
      await start();
      emit('session.tool.input.started', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', name: 'read' });
      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'call_1', input: {} });
      await flush();

      expect(client.getSessionMessages).not.toHaveBeenCalled();
    });

    it('keeps events in order while a name is being looked up', async () => {
      await start();
      let release!: (history: SessionMessage[]) => void;
      client.getSessionMessages.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        })
      );
      const { log } = record(manager);

      emit('session.tool.called', { sessionID: 'ses_123', assistantMessageID: 'msg_1', id: 'toolu_01PXrnZLZsPcKN2dFFJZ2mVM', input: {} });
      emit('session.tool.success', {
        sessionID: 'ses_123',
        assistantMessageID: 'msg_1',
        id: 'toolu_01PXrnZLZsPcKN2dFFJZ2mVM',
        content: [{ type: 'text', text: 'done' }],
      });
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'after' });
      emit('session.execution.succeeded', { sessionID: 'ses_123' });
      expect(log).toHaveLength(0);

      release(loadHistory());
      await flush();

      expect(log.map((e) => `${e.name}${e.data.part ? `:${e.data.part.state.status}` : ''}`)).toEqual([
        'tool-use:running',
        'tool-use:completed',
        'message-partial',
        'message-complete',
        'complete',
      ]);
    });
  });

  describe('compaction loop detection', () => {
    it('auto-interrupts after 3 consecutive compactions', async () => {
      await start();
      const { of } = record(manager);

      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.compaction.ended', { sessionID: 'ses_123' });

      expect(of('error')).toHaveLength(1);
      expect(of('error')[0].taskId).toBe('task_1');
      expect(of('error')[0].error).toContain('compaction loop');
      expect(client.interrupt).toHaveBeenCalledWith('ses_123');
    });

    it('does not interrupt before reaching the threshold', async () => {
      await start();
      const { of } = record(manager);

      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.compaction.ended', { sessionID: 'ses_123' });

      expect(of('error')).toHaveLength(0);
      expect(client.interrupt).not.toHaveBeenCalled();
    });

    it('starts the counter at zero for a resumed session that sends a new message', async () => {
      await start();
      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.execution.succeeded', { sessionID: 'ses_123' });

      await manager.resumeSession({ taskId: 'task_2', sessionId: 'ses_456', prompt: 'Continue', workingDirectory: '/test' });
      await flush();
      const { of } = record(manager);
      emit('session.compaction.ended', { sessionID: 'ses_456' });
      emit('session.compaction.ended', { sessionID: 'ses_456' });

      expect(of('error')).toHaveLength(0);
    });

    it('ignores compaction events for unknown sessions', () => {
      const { of } = record(manager);

      emit('session.compaction.ended', { sessionID: 'unknown_session' });
      emit('session.compaction.ended', { sessionID: 'unknown_session' });
      emit('session.compaction.ended', { sessionID: 'unknown_session' });

      expect(of('error')).toHaveLength(0);
    });

    it('emits nothing further after cleanup from a compaction loop', async () => {
      await start();
      const { of } = record(manager);
      for (let i = 0; i < 3; i++) emit('session.compaction.ended', { sessionID: 'ses_123' });
      expect(of('error')).toHaveLength(1);

      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.compaction.ended', { sessionID: 'ses_123' });
      emit('session.execution.interrupted', { sessionID: 'ses_123', reason: 'user' });

      expect(of('error')).toHaveLength(1);
      expect(of('complete')).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('clears all state and removes listeners', async () => {
      await start();

      manager.dispose();

      const events: unknown[] = [];
      manager.on('progress', (data) => events.push(data));
      emit('session.execution.started', { sessionID: 'ses_123' });

      expect(events).toHaveLength(0);
      expect(manager.activeSessionCount()).toBe(0);
    });
  });

  describe('recovery after the event stream reconnected', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    const running = (updated = 1) => sessionInfo('ses_123', { time: { created: 1, updated } });

    it('emits the completion of a turn that finished while the stream was down', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'succeeded', time: { created: 1, updated: 2000 } }));
      const { log, of } = record(manager);
      emit('session.text.delta', { sessionID: 'ses_123', assistantMessageID: 'msg_1', ordinal: 0, delta: 'Done.' });

      emit('reconnected', undefined);
      await flush();

      expect(log.slice(-2).map((e) => e.name)).toEqual(['message-complete', 'complete']);
      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'success' }]);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('does not complete twice when the real event shows up after recovery', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'succeeded', time: { created: 1, updated: 2000 } }));
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();
      emit('session.execution.succeeded', { sessionID: 'ses_123' });

      expect(of('complete')).toHaveLength(1);
    });

    it('reports a failed turn that ended during the gap as a task error with the message from the history', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'failed', time: { created: 1, updated: 2000 } }));
      client.getSessionMessages.mockResolvedValue([
        { id: 'msg_idle', type: 'idle', outcome: 'failed' },
        { id: 'msg_a', type: 'assistant', error: { type: 'provider', message: 'Quota exceeded' } },
      ]);
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(of('error')).toEqual([{ taskId: 'task_1', error: 'Quota exceeded', sessionId: 'ses_123' }]);
      expect(of('complete')).toHaveLength(0);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('falls back to a generic message when a failed turn left no error in the history', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'failed', time: { created: 1, updated: 2000 } }));
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(of('error')).toHaveLength(1);
      expect(of('error')[0].error).toMatch(/failed/i);
    });

    it('treats an interrupted outcome like the interrupted event: success without a local abort', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'interrupted', time: { created: 1, updated: 2000 } }));
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'success' }]);
    });

    it('leaves a session alone while a local abort is pending', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'interrupted', time: { created: 1, updated: 2000 } }));
      let release!: () => void;
      client.interrupt.mockReturnValueOnce(
        new Promise((resolve) => {
          release = () => resolve({ interrupted: true });
        })
      );
      const { of } = record(manager);

      const aborting = manager.abortSession('task_1', 'ses_123');
      emit('reconnected', undefined);
      await flush();
      release();
      await aborting;

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'aborted' }]);
    });

    it('ignores an outcome left over from an earlier turn (session not updated since the prompt was sent)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      await start();
      client.getSession.mockResolvedValue(sessionInfo('ses_123', { outcome: 'succeeded', time: { created: 1, updated: 500 } }));
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(of('complete')).toHaveLength(0);
      expect(manager.activeSessionCount()).toBe(1);
    });

    const ask: PermissionAsk = {
      id: 'per_missed',
      sessionID: 'ses_123',
      action: 'edit',
      resources: ['Misc/b.txt'],
      metadata: { files: [] },
    };

    it('re-emits a permission ask that was missed while the stream was down', async () => {
      await start();
      client.getSession.mockResolvedValue(running());
      client.listSessionPermissions.mockResolvedValue([ask]);
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(client.listSessionPermissions).toHaveBeenCalledWith('ses_123');
      expect(of('permission-request')).toEqual([
        { taskId: 'task_1', id: 'per_missed', sessionId: 'ses_123', permission: 'edit', patterns: ['Misc/b.txt'], metadata: { files: [] } },
      ]);
    });

    it('does not re-emit an ask the UI already saw, and does not repeat it on a second reconnect', async () => {
      await start();
      client.getSession.mockResolvedValue(running());
      client.listSessionPermissions.mockResolvedValue([ask]);
      const { of } = record(manager);
      emit('permission.asked', ask);

      emit('reconnected', undefined);
      await flush();
      emit('reconnected', undefined);
      await flush();

      expect(of('permission-request')).toHaveLength(1);
    });

    it('re-emits a form that was missed, mapped to questions and answerable afterwards', async () => {
      await start();
      client.getSession.mockResolvedValue(running());
      const missed: FormInfo = {
        id: 'frm_missed',
        sessionID: 'ses_123',
        title: 'Questions',
        fields: [{ key: 'q0', description: 'Pick', type: 'string', options: [{ value: 'a', label: 'A' }], custom: true }],
      };
      client.listSessionForms.mockResolvedValue([missed]);
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();
      emit('reconnected', undefined);
      await flush();

      expect(of('question-request')).toEqual([
        {
          taskId: 'task_1',
          id: 'frm_missed',
          sessionId: 'ses_123',
          questions: [{ question: 'Pick', options: [{ label: 'A' }], multiSelect: false, custom: true }],
        },
      ]);
      await manager.replyToQuestion('task_1', 'frm_missed', [{ labels: ['A'] }]);
      expect(client.replyForm).toHaveBeenCalledWith('ses_123', 'frm_missed', { q0: 'a' });
    });

    it('recovers every active session, each against its own id', async () => {
      await start({ taskId: 'task_a', arenaId: 'arena' });
      client.createSession.mockResolvedValueOnce(sessionInfo('ses_b'));
      await start({ taskId: 'task_b', arenaId: 'arena' });
      client.getSession.mockImplementation(async (id: string) => sessionInfo(id));

      emit('reconnected', undefined);
      await flush();

      expect(client.getSession.mock.calls.map((c) => c[0]).sort()).toEqual(['ses_123', 'ses_b']);
      expect(client.listSessionPermissions.mock.calls.map((c) => c[0]).sort()).toEqual(['ses_123', 'ses_b']);
    });

    it('survives REST failures during recovery and keeps the session', async () => {
      await start();
      client.getSession.mockRejectedValue(new Error('offline'));
      const { log } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(log).toHaveLength(0);
      expect(manager.activeSessionCount()).toBe(1);
    });

    it('still re-emits asks when only one of the two listings fails', async () => {
      await start();
      client.getSession.mockResolvedValue(running());
      client.listSessionForms.mockRejectedValue(new Error('boom'));
      client.listSessionPermissions.mockResolvedValue([ask]);
      const { of } = record(manager);

      emit('reconnected', undefined);
      await flush();

      expect(of('permission-request')).toHaveLength(1);
    });
  });

  describe('fixture replay: turn with todo, question, permissions and tools', () => {
    const frames = loadFrames('turn-tools-form-todo.events.jsonl');
    const turnEnd = frames.findIndex((f) => f.type === 'session.execution.succeeded');
    const turnFrames = frames.slice(0, turnEnd + 1);
    const ofType = (type: string) => turnFrames.filter((f) => f.type === type).map((f) => f.data as any);

    beforeEach(() => {
      client.createSession.mockResolvedValue(sessionInfo(TOOLS_SESSION, { location: { directory: WS } }));
    });

    const startReplay = async () => {
      await start({ workingDirectory: WS, folderPermissions: [{ path: WS, accessLevel: 'read-write', source: 'workspace' }] });
      return record(manager);
    };

    it('streams partials per delta and flushes each assistant message as message-complete', async () => {
      const { log, of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      const deltas = ofType('session.text.delta');
      const [textA, textC] = ofType('session.text.ended').map((d) => d.text as string);
      const partials = of('message-partial');
      expect(partials).toHaveLength(deltas.length);
      expect(partials.map((p) => p.delta)).toEqual(deltas.map((d) => d.delta));
      expect(partials[1].textSoFar).toBe(deltas[0].delta + deltas[1].delta);
      expect(partials.map((p) => p.messageId)).toEqual(deltas.map((d) => d.assistantMessageID));
      expect(partials.every((p) => p.isStreaming)).toBe(true);

      expect(of('message-complete')).toEqual([
        { taskId: 'task_1', messageId: deltas[0].assistantMessageID, text: textA },
        { taskId: 'task_1', messageId: deltas[2].assistantMessageID, text: textC },
      ]);
      // The first message is flushed before the second message's first partial
      const firstFlush = log.findIndex((e) => e.name === 'message-complete');
      const secondStream = log.findIndex((e) => e.name === 'message-partial' && e.data.messageId === deltas[2].assistantMessageID);
      expect(firstFlush).toBeLessThan(secondStream);
    });

    it('emits tool_use messages with a rebuilt v1 part for every call: running, then completed with string output', async () => {
      const { of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      const parts = of('tool-use').map((e) => e.part);
      const calls = ofType('session.tool.called');
      expect(parts).toHaveLength(calls.length * 2);
      expect(parts.every((p) => p.type === 'tool' && typeof p.callID === 'string' && p.sessionID === TOOLS_SESSION)).toBe(true);

      const write = parts.filter((p) => p.callID === 'toolu_01GW7aD54oYL1SY7XLoHsRJo');
      expect(write.map((p) => p.state.status)).toEqual(['running', 'completed']);
      expect(write[0]).toEqual(
        expect.objectContaining({
          tool: 'write',
          messageID: 'msg_17e05d881001JIkbS3WsdapwNm',
          state: { status: 'running', input: { path: 'Output/a.txt', content: 'hi' } },
        })
      );
      expect(write[1].state.output).toBe('Created file successfully: Output/a.txt');
      expect(typeof write[1].state.output).toBe('string');

      const read = parts.filter((p) => p.callID === 'toolu_012Khsh4PkX8vZ5U3u9TmXUY');
      expect(read[1].state.output).toMatch(/^Read file \/etc\/hosts/);

      const question = parts.filter((p) => p.callID === 'toolu_01Hv8tTuGFD5yeyLpyyjhMvj');
      expect(question.map((p) => p.tool)).toEqual(['question', 'question']);
      expect(question[1].state.output).toContain('User has answered your questions');
    });

    it('emits question_request with the form id and custom, mapped from the form field', async () => {
      const { of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      expect(of('question-request')).toEqual([
        {
          taskId: 'task_1',
          id: 'frm_17e05d871001KUuOvyrfT190iq',
          sessionId: TOOLS_SESSION,
          questions: [
            {
              question: 'Which color do you pick?',
              header: 'Color choice',
              options: [
                { label: 'red', description: 'Choose red' },
                { label: 'blue', description: 'Choose blue' },
              ],
              multiSelect: false,
              custom: true,
            },
          ],
        },
      ]);
    });

    it('answers that question with the option value', async () => {
      await startReplay();
      const formIndex = frames.findIndex((f) => f.type === 'form.created');
      replay(eventStream, frames.slice(0, formIndex + 1));
      await flush();

      await manager.replyToQuestion('task_1', 'frm_17e05d871001KUuOvyrfT190iq', [{ labels: ['red'] }]);

      expect(client.replyForm).toHaveBeenCalledWith(TOOLS_SESSION, 'frm_17e05d871001KUuOvyrfT190iq', { q0: 'red' });
    });

    it('emits permission_request for every ask with the resources as patterns', async () => {
      const { of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      const asks = ofType('permission.asked');
      expect(asks.map((a) => a.action)).toEqual(['edit', 'edit', 'edit', 'external_directory']);
      expect(of('permission-request')).toEqual(
        asks.map((a) => ({
          taskId: 'task_1',
          id: a.id,
          sessionId: TOOLS_SESSION,
          permission: a.action,
          patterns: a.resources,
          metadata: a.metadata ?? {},
        }))
      );
      expect(of('permission-request')[3].patterns).toEqual(['/etc/*']);
    });

    it('emits todo_updated for each todowrite call and keeps the last list', async () => {
      const { of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      const todoCalls = ofType('session.tool.called').filter((d) => d.input && Array.isArray(d.input.todos));
      expect(todoCalls).toHaveLength(2);
      const expected = todoCalls.map((d) =>
        d.input.todos.map((t: any, i: number) => ({ id: String(i), content: t.content, status: t.status, priority: 'medium' }))
      );
      expect(of('todo-updated').map((e) => e.todos)).toEqual(expected);
      expect(manager.getSessionTodos(TOOLS_SESSION)).toEqual(expected[1]);
    });

    it('finishes with exactly one complete(success) after the last message-complete, and no error', async () => {
      const { log, of } = await startReplay();

      replay(eventStream, turnFrames);
      await flush();

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: TOOLS_SESSION, status: 'success' }]);
      expect(of('error')).toHaveLength(0);
      expect(log.slice(-2).map((e) => e.name)).toEqual(['message-complete', 'complete']);
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('ignores the next turn of the same session once the task has completed (no duplicate completion)', async () => {
      const { log } = await startReplay();
      replay(eventStream, turnFrames);
      await flush();
      const before = log.length;

      replay(eventStream, frames.slice(turnEnd + 1));
      await flush();

      expect(log).toHaveLength(before);
    });

    it('maps the shell tool to bash and ends on interrupted(user) as a finished task when no local abort is pending', async () => {
      await manager.resumeSession({ taskId: 'task_2', sessionId: TOOLS_SESSION, prompt: 'Run the shell command', workingDirectory: WS });
      await flush();
      const { of } = record(manager);
      const secondTurn = frames.slice(frames.findIndex((f, i) => i > turnEnd && f.type === 'session.execution.started'));

      replay(eventStream, secondTurn);
      await flush();

      const shell = of('tool-use')
        .map((e) => e.part)
        .filter((p) => p.callID === 'toolu_01AFq46cBkfEWz1zm2BuqtJz');
      expect(shell.map((p) => [p.tool, p.state.status])).toEqual([
        ['bash', 'running'],
        ['bash', 'error'],
      ]);
      expect(shell[0].state.input).toEqual({ command: 'sleep 30 && echo finished' });
      expect(shell[1].state.output).toBe('Tool execution interrupted');
      expect(of('complete')).toEqual([{ taskId: 'task_2', sessionId: TOOLS_SESSION, status: 'success' }]);
    });

    it('does not complete twice when the user aborts and the interrupted(user) event follows', async () => {
      await manager.resumeSession({ taskId: 'task_2', sessionId: TOOLS_SESSION, prompt: 'Run the shell command', workingDirectory: WS });
      await flush();
      const { of } = record(manager);
      const secondTurn = frames.slice(frames.findIndex((f, i) => i > turnEnd && f.type === 'session.execution.started'));
      const interruptedAt = secondTurn.findIndex((f) => f.type === 'session.execution.interrupted');
      replay(eventStream, secondTurn.slice(0, interruptedAt));

      await manager.abortSession('task_2', TOOLS_SESSION);
      replay(eventStream, secondTurn.slice(interruptedAt));
      await flush();

      expect(of('complete')).toEqual([{ taskId: 'task_2', sessionId: TOOLS_SESSION, status: 'aborted' }]);
    });
  });

  describe('fixture replay: rejected permissions', () => {
    const frames = loadFrames('turn-permissions-reject.events.jsonl');
    const interruptedAt = frames.findIndex((f) => f.type === 'session.execution.interrupted');

    beforeEach(() => {
      client.createSession.mockResolvedValue(sessionInfo(REJECT_SESSION, { location: { directory: WS } }));
    });

    const startReplay = async () => {
      await start({ workingDirectory: WS, folderPermissions: [{ path: WS, accessLevel: 'read-write', source: 'workspace' }] });
      return record(manager);
    };

    it('ends the task with one complete(success) when the turn is interrupted after a rejected permission', async () => {
      const { log, of } = await startReplay();

      replay(eventStream, frames.slice(0, interruptedAt + 1));
      await flush();

      expect(of('complete')).toEqual([{ taskId: 'task_1', sessionId: REJECT_SESSION, status: 'success' }]);
      expect(of('error')).toHaveLength(0);
      expect(log[log.length - 1].name).toBe('complete');
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('reports the rejected and declined calls as errored tool parts with the server message', async () => {
      const { of } = await startReplay();

      replay(eventStream, frames.slice(0, interruptedAt + 1));
      await flush();

      const errored = of('tool-use')
        .map((e) => e.part)
        .filter((p) => p.state.status === 'error');
      const failedFrames = frames.slice(0, interruptedAt + 1).filter((f) => f.type === 'session.tool.failed');
      expect(errored.map((p) => [p.callID, p.state.output])).toEqual(failedFrames.map((f: any) => [f.data.id, f.data.error.message]));
      expect(errored.map((p) => p.state.output)).toEqual(
        expect.arrayContaining(['Permission denied: edit', 'The user declined this tool call'])
      );
    });

    it('surfaces the asks of the turn, including the rejected ones', async () => {
      const { of } = await startReplay();

      replay(eventStream, frames.slice(0, interruptedAt + 1));
      await flush();

      const asked = frames.filter((f) => f.type === 'permission.asked').map((f: any) => f.data);
      expect(of('permission-request').map((p) => p.id)).toEqual(asked.map((a) => a.id));
      expect(of('permission-request').map((p) => p.patterns)).toEqual(asked.map((a) => a.resources));
    });

    it('ignores everything the session does afterwards, including its next successful turn', async () => {
      const { log } = await startReplay();
      replay(eventStream, frames.slice(0, interruptedAt + 1));
      await flush();
      const before = log.length;

      replay(eventStream, frames.slice(interruptedAt + 1));
      await flush();

      expect(log).toHaveLength(before);
    });
  });
});
