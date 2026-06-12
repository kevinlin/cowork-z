import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EventStream } from '../src/event-stream';
import type { OpenCodeClient } from '../src/opencode-client';
import { SessionManager } from '../src/session-manager';

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

// Mock config-builder
jest.mock('../src/config-builder', () => ({
  buildSessionConfig: jest.fn(() => ({
    default_agent: 'accomplish',
    permission: { doom_loop: 'deny' },
    agent: { accomplish: { description: 'test', prompt: 'test', mode: 'primary' } },
  })),
  buildSystemPrompt: jest.fn((port: number, workspaceDir: string) => `mock-system-prompt-port-${port}-ws-${workspaceDir}`),
}));

function createMockClient(): jest.Mocked<OpenCodeClient> {
  return {
    health: jest.fn(),
    isServerRunning: jest.fn(),
    disposeGlobal: jest.fn(),
    disposeInstance: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn<() => Promise<any>>().mockResolvedValue({}),
    listSessions: jest.fn(),
    createSession: jest.fn<() => Promise<any>>().mockResolvedValue({
      id: 'ses_123',
      slug: 'test',
      projectID: 'proj_1',
      directory: '/test',
      title: 'Test',
      version: '1',
      time: { created: Date.now(), updated: Date.now() },
    }),
    getSession: jest.fn<() => Promise<any>>().mockResolvedValue({
      id: 'ses_456',
      slug: 'resumed',
      projectID: 'proj_1',
      directory: '/test',
      title: 'Resumed',
      version: '1',
      time: { created: Date.now(), updated: Date.now() },
    }),
    deleteSession: jest.fn(),
    abortSession: jest.fn<() => Promise<any>>().mockResolvedValue(true),
    getMessages: jest.fn(),
    sendMessage: jest.fn<() => Promise<any>>().mockResolvedValue({
      info: { id: 'msg_1', role: 'assistant' },
      parts: [],
    }),
    listPermissions: jest.fn(),
    replyToPermission: jest.fn<() => Promise<any>>().mockResolvedValue(true),
    listQuestions: jest.fn(),
    replyToQuestion: jest.fn<() => Promise<any>>().mockResolvedValue(true),
    rejectQuestion: jest.fn(),
  } as unknown as jest.Mocked<OpenCodeClient>;
}

function createMockEventStream(): EventStream {
  return new EventEmitter() as unknown as EventStream;
}

describe('SessionManager', () => {
  let client: jest.Mocked<OpenCodeClient>;
  let eventStream: EventStream;
  let manager: SessionManager;

  beforeEach(() => {
    client = createMockClient();
    eventStream = createMockEventStream();
    manager = new SessionManager(client, eventStream, 54_321);
  });

  describe('startTask', () => {
    it('should create a session and send the initial message', async () => {
      const events: string[] = [];
      manager.on('progress', (data) => events.push(`progress:${data.stage}`));
      manager.on('started', () => events.push('started'));

      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
        workingDirectory: '/test',
      });

      expect(client.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ default_agent: 'accomplish' }), '/test');
      expect(client.createSession).toHaveBeenCalledWith({
        directory: '/test',
        title: 'Do something',
      });
      expect(client.sendMessage).toHaveBeenCalledWith('ses_123', {
        parts: [{ type: 'text', text: 'Do something' }],
        directory: '/test',
        system: 'mock-system-prompt-port-54321-ws-/test',
      });
      expect(events).toEqual(['progress:configuring', 'started', 'progress:executing']);
    });

    it('should truncate long prompts for session title', async () => {
      const longPrompt = 'A'.repeat(100);

      await manager.startTask({
        taskId: 'task_1',
        prompt: longPrompt,
      });

      expect(client.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          title: longPrompt.slice(0, 50),
        })
      );
    });
  });

  describe('resumeSession', () => {
    it('should get existing session and send follow-up message', async () => {
      const events: string[] = [];
      manager.on('started', () => events.push('started'));
      manager.on('progress', (data) => events.push(`progress:${data.stage}`));

      await manager.resumeSession({
        taskId: 'task_2',
        sessionId: 'ses_456',
        prompt: 'Continue working',
        workingDirectory: '/test',
      });

      expect(client.updateConfig).toHaveBeenCalled();
      expect(client.getSession).toHaveBeenCalledWith('ses_456', '/test');
      expect(client.sendMessage).toHaveBeenCalledWith('ses_456', {
        parts: [{ type: 'text', text: 'Continue working' }],
        directory: '/test',
        system: 'mock-system-prompt-port-54321-ws-/test',
      });
      expect(events).toEqual(['progress:configuring', 'started', 'progress:executing']);
    });

    it('should not send a message if no prompt is provided', async () => {
      await manager.resumeSession({
        taskId: 'task_2',
        sessionId: 'ses_456',
      });

      expect(client.getSession).toHaveBeenCalledWith('ses_456', undefined);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage failure surfacing (2026-06-12 review #9)', () => {
    function flush(): Promise<void> {
      return new Promise((r) => setImmediate(r));
    }

    it('emits error and aborts the session when sendMessage rejects before any SSE confirmation', async () => {
      client.sendMessage.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const errors: Array<{ taskId: string; error: string; sessionId?: string }> = [];
      manager.on('error', (data) => errors.push(data));

      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
        workingDirectory: '/test',
      });
      await flush();

      expect(errors).toHaveLength(1);
      expect(errors[0].taskId).toBe('task_1');
      expect(errors[0].error).toContain('ECONNREFUSED');
      expect(client.abortSession).toHaveBeenCalledWith('ses_123', '/test');
      // Session cleaned up — later SSE events for it are ignored
      expect(manager.activeSessionCount()).toBe(0);
    });

    it('does not emit error when sendMessage rejects after SSE confirmed the turn', async () => {
      let rejectSend!: (err: Error) => void;
      client.sendMessage.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        }) as never
      );

      const errors: unknown[] = [];
      manager.on('error', (data) => errors.push(data));

      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
        workingDirectory: '/test',
      });

      // SSE confirms the server is processing the turn
      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'busy' },
      });

      // Then the HTTP request times out (long-running turn artifact)
      rejectSend(new Error('socket hang up'));
      await flush();

      expect(errors).toHaveLength(0);
      expect(client.abortSession).not.toHaveBeenCalled();
      expect(manager.activeSessionCount()).toBe(1);
    });

    it('emits error for a resumed session when the follow-up message fails unconfirmed', async () => {
      client.sendMessage.mockRejectedValueOnce(new Error('401 Unauthorized'));

      const errors: Array<{ taskId: string; error: string }> = [];
      manager.on('error', (data) => errors.push(data));

      await manager.resumeSession({
        taskId: 'task_2',
        sessionId: 'ses_456',
        prompt: 'Continue working',
        workingDirectory: '/test',
      });
      await flush();

      expect(errors).toHaveLength(1);
      expect(errors[0].taskId).toBe('task_2');
      expect(errors[0].error).toContain('401');
      expect(client.abortSession).toHaveBeenCalledWith('ses_456', '/test');
    });
  });

  describe('abortSession', () => {
    it('should abort the session and emit complete event', async () => {
      // First start a task so there's a managed session
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const events: Array<{ taskId: string; status: string }> = [];
      manager.on('complete', (data) => events.push(data));

      await manager.abortSession('task_1', 'ses_123');

      expect(client.abortSession).toHaveBeenCalledWith('ses_123', '/test');
      expect(events).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'aborted' }]);
    });
  });

  describe('replyToPermission', () => {
    it('should forward permission reply to client', async () => {
      await manager.replyToPermission('task_1', 'per_123', 'once', 'allowed');

      expect(client.replyToPermission).toHaveBeenCalledWith('per_123', 'once', { message: 'allowed' });
    });
  });

  describe('replyToQuestion', () => {
    it('should forward question reply to client', async () => {
      const answers = [{ labels: ['Option A'] }];
      await manager.replyToQuestion('task_1', 'que_123', answers);

      expect(client.replyToQuestion).toHaveBeenCalledWith('que_123', [['Option A']], undefined);
    });
  });

  describe('SSE event handling', () => {
    it('should emit progress when session becomes busy', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const events: Array<{ taskId: string; stage: string }> = [];
      manager.on('progress', (data) => events.push(data));

      // Simulate session.status busy event (server sends sessionID, not session object)
      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'busy' },
      });

      expect(events).toEqual([{ taskId: 'task_1', stage: 'executing' }]);
    });

    it('should emit complete when active session becomes idle', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const completeEvents: Array<{ taskId: string; status: string }> = [];
      manager.on('complete', (data) => completeEvents.push(data));

      // Session goes idle (task is 'active' after startTask completes)
      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'idle' },
      });

      expect(completeEvents).toEqual([{ taskId: 'task_1', sessionId: 'ses_123', status: 'success' }]);
    });

    it('should emit message-partial on text part deltas', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const partials: Array<{ delta: string; textSoFar: string }> = [];
      manager.on('message-partial', (data) => partials.push(data));

      // Simulate streaming text deltas via message.part.delta events
      eventStream.emit('message.part.delta', {
        sessionID: 'ses_123',
        messageID: 'msg_1',
        partID: 'prt_1',
        field: 'text',
        delta: 'Hello ',
      });
      eventStream.emit('message.part.delta', {
        sessionID: 'ses_123',
        messageID: 'msg_1',
        partID: 'prt_1',
        field: 'text',
        delta: 'world!',
      });

      expect(partials).toHaveLength(2);
      expect(partials[0]).toEqual(expect.objectContaining({ delta: 'Hello ', textSoFar: 'Hello ' }));
      expect(partials[1]).toEqual(expect.objectContaining({ delta: 'world!', textSoFar: 'Hello world!' }));
    });

    it('should emit message-complete with accumulated text on idle', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      // Set a currentMessageId via message.updated (server sends { info: MessageInfo })
      eventStream.emit('message.updated', {
        info: { id: 'msg_1', role: 'assistant', sessionID: 'ses_123' },
      });

      // Accumulate some text via message.part.delta
      eventStream.emit('message.part.delta', {
        sessionID: 'ses_123',
        messageID: 'msg_1',
        partID: 'prt_1',
        field: 'text',
        delta: 'Final answer',
      });

      const completeMessages: Array<{ messageId: string; text: string }> = [];
      manager.on('message-complete', (data) => completeMessages.push(data));

      // Session goes idle
      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'idle' },
      });

      expect(completeMessages).toEqual([{ taskId: 'task_1', messageId: 'msg_1', text: 'Final answer' }]);
    });

    it('should emit tool-use on tool part updates', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const toolEvents: unknown[] = [];
      manager.on('tool-use', (data) => toolEvents.push(data));

      eventStream.emit('message.part.updated', {
        part: { type: 'tool', name: 'bash', sessionID: 'ses_123', messageID: 'msg_1', id: 'prt_2' },
      });

      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 'task_1',
          part: expect.objectContaining({ type: 'tool', name: 'bash' }),
        })
      );
    });

    it('should emit permission-request on permission.asked event', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const permEvents: unknown[] = [];
      manager.on('permission-request', (data) => permEvents.push(data));

      eventStream.emit('permission.asked', {
        id: 'per_1',
        sessionID: 'ses_123',
        permission: 'bash',
        patterns: ['ls -la'],
        metadata: { command: 'ls -la' },
        always: [],
      });

      expect(permEvents).toHaveLength(1);
      expect(permEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 'task_1',
          id: 'per_1',
          permission: 'bash',
        })
      );
    });

    it('should emit question-request on question.asked event', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const questionEvents: unknown[] = [];
      manager.on('question-request', (data) => questionEvents.push(data));

      eventStream.emit('question.asked', {
        id: 'que_1',
        sessionID: 'ses_123',
        questions: [{ question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] }],
      });

      expect(questionEvents).toHaveLength(1);
      expect(questionEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 'task_1',
          id: 'que_1',
          questions: expect.arrayContaining([expect.objectContaining({ question: 'Which option?' })]),
        })
      );
    });

    it('should emit error on session.error event', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const errors: unknown[] = [];
      manager.on('error', (data) => errors.push(data));

      eventStream.emit('session.error', {
        sessionID: 'ses_123',
        error: 'API rate limit exceeded',
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          taskId: 'task_1',
          error: 'API rate limit exceeded',
        })
      );
    });

    it('should ignore events for unknown sessions', () => {
      const events: unknown[] = [];
      manager.on('progress', (data) => events.push(data));
      manager.on('message', (data) => events.push(data));

      // These should be silently ignored (no managed session for this ID)
      eventStream.emit('session.status', {
        sessionID: 'unknown_session',
        status: { type: 'busy' },
      });
      eventStream.emit('message.updated', {
        info: { id: 'msg_1', role: 'assistant', sessionID: 'unknown_session' },
      });

      expect(events).toHaveLength(0);
    });
  });

  describe('compaction loop detection', () => {
    it('should auto-abort after 3 consecutive compactions', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const errors: Array<{ taskId: string; error: string }> = [];
      manager.on('error', (data) => errors.push(data));

      // Simulate 3 consecutive compaction events
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });

      expect(errors).toHaveLength(1);
      expect(errors[0].taskId).toBe('task_1');
      expect(errors[0].error).toContain('compaction loop');
      expect(client.abortSession).toHaveBeenCalledWith('ses_123', '/test');
    });

    it('should not abort before reaching the threshold', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const errors: unknown[] = [];
      manager.on('error', (data) => errors.push(data));

      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });

      expect(errors).toHaveLength(0);
      expect(client.abortSession).not.toHaveBeenCalled();
    });

    it('should reset compaction counter when resumeSession sends a new message', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      // 2 compactions (below threshold)
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });

      // Simulate session going idle so cleanup happens, then resume
      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'idle' },
      });

      // Resume creates a fresh managed session with counter at 0
      await manager.resumeSession({
        taskId: 'task_2',
        sessionId: 'ses_456',
        prompt: 'Continue',
        workingDirectory: '/test',
      });

      const errors: unknown[] = [];
      manager.on('error', (data) => errors.push(data));

      // Only 2 compactions after resume — should not trigger
      eventStream.emit('session.compacted', { sessionID: 'ses_456' });
      eventStream.emit('session.compacted', { sessionID: 'ses_456' });

      expect(errors).toHaveLength(0);
    });

    it('should ignore compaction events for unknown sessions', () => {
      const errors: unknown[] = [];
      manager.on('error', (data) => errors.push(data));

      eventStream.emit('session.compacted', { sessionID: 'unknown_session' });
      eventStream.emit('session.compacted', { sessionID: 'unknown_session' });
      eventStream.emit('session.compacted', { sessionID: 'unknown_session' });

      expect(errors).toHaveLength(0);
    });

    it('should not emit further events after cleanup from compaction loop', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      const errors: Array<{ taskId: string }> = [];
      manager.on('error', (data) => errors.push(data));

      // Trigger compaction loop
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });

      expect(errors).toHaveLength(1);

      // Further compaction events should be ignored (session cleaned up)
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });
      eventStream.emit('session.compacted', { sessionID: 'ses_123' });

      expect(errors).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should clear all state and remove listeners', async () => {
      await manager.startTask({
        taskId: 'task_1',
        prompt: 'Do something',
      });

      manager.dispose();

      // After dispose, events should not cause issues
      const events: unknown[] = [];
      manager.on('progress', (data) => events.push(data));

      eventStream.emit('session.status', {
        sessionID: 'ses_123',
        status: { type: 'busy' },
      });

      // The session was cleared, so the event lookup returns early
      expect(events).toHaveLength(0);
    });
  });
});
