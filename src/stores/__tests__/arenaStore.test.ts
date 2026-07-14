import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskMessage } from '@/shared';
import { type ArenaColumns, useArenaStore } from '../arenaStore';

vi.mock('@/lib/tauri-api', () => ({
  isRunningInTauri: () => false,
  saveTaskMessage: vi.fn().mockResolvedValue(undefined),
  completeTask: vi.fn().mockResolvedValue(undefined),
  saveTaskSession: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '@/lib/tauri-api';

function makeTask(id: string): Task {
  return {
    id,
    prompt: 'arena prompt',
    status: 'running',
    messages: [],
    createdAt: new Date().toISOString(),
  };
}

function makeMessage(id: string, content: string): TaskMessage {
  return { id, type: 'assistant', content, timestamp: new Date().toISOString() };
}

function columnsWithTask(taskId: string): ArenaColumns {
  const empty = {
    modelId: null,
    modelDisplayName: '',
    taskId: null,
    task: null,
    status: 'idle' as const,
    partialMessages: new Map(),
    error: null,
  };
  return [
    {
      ...empty,
      modelId: 'anthropic/claude',
      modelDisplayName: 'Claude',
      taskId,
      task: makeTask(taskId),
      status: 'running' as const,
    },
    { ...empty },
    { ...empty },
  ];
}

describe('arenaStore — single-owner persistence (review 2026-06-12 #11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useArenaStore.setState({
      arenaId: 'arena-1',
      columns: columnsWithTask('task-a'),
      pendingTaskIds: new Set<string>(),
      eventBuffer: [],
      arenas: [],
    });
  });

  it('handleTaskUpdate does not persist messages (taskStore global handler owns it)', () => {
    useArenaStore.getState().handleTaskUpdate({
      taskId: 'task-a',
      type: 'message',
      message: makeMessage('m1', 'hello'),
    });

    expect(api.saveTaskMessage).not.toHaveBeenCalled();
    expect(useArenaStore.getState().columns[0].task?.messages).toHaveLength(1);
  });

  it('handleTaskUpdate does not persist complete/error/started events', () => {
    const store = useArenaStore.getState();
    store.handleTaskUpdate({
      taskId: 'task-a',
      type: 'complete',
      result: { status: 'success', sessionId: 'sess-1' },
    });
    store.handleTaskUpdate({ taskId: 'task-a', type: 'error', error: 'boom' });
    store.handleTaskUpdate({ taskId: 'task-a', type: 'started', sessionId: 'sess-1' });

    expect(api.completeTask).not.toHaveBeenCalled();
    expect(api.saveTaskSession).not.toHaveBeenCalled();
  });

  it('handleTaskUpdate dedupes re-delivered messages by ID', () => {
    const store = useArenaStore.getState();
    const message = makeMessage('m1', 'first');
    store.handleTaskUpdate({ taskId: 'task-a', type: 'message', message });
    store.handleTaskUpdate({ taskId: 'task-a', type: 'message', message: { ...message, content: 'updated' } });

    const messages = useArenaStore.getState().columns[0].task?.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0].content).toBe('updated');
  });

  it('handlePartialMessageComplete persists exactly once and dedupes the UI append', () => {
    const store = useArenaStore.getState();
    store.handlePartialMessageComplete({ taskId: 'task-a', messageId: 'm1', text: 'streamed' });
    store.handlePartialMessageComplete({ taskId: 'task-a', messageId: 'm1', text: 'streamed again' });

    // Sole persister for arena streamed messages — one call per event
    expect(api.saveTaskMessage).toHaveBeenCalledTimes(2);
    const messages = useArenaStore.getState().columns[0].task?.messages;
    expect(messages).toHaveLength(1);
    expect(messages?.[0].content).toBe('streamed again');
  });
});
