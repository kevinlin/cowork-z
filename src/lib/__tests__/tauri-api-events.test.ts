import { beforeEach, describe, expect, it, vi } from 'vitest';

const listenMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => listenMock(name, handler),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import { onTaskProgress, onTaskUpdate } from '../tauri-api';

/** Deliver a Tauri envelope to the handler registered for `eventName`. */
function emitTo(eventName: string, payload: unknown) {
  const call = listenMock.mock.calls.find(([name]) => name === eventName);
  if (!call) {
    throw new Error(`no listener registered for ${eventName}`);
  }
  (call[1] as (event: { payload: unknown }) => void)({ payload });
}

describe('onTaskProgress', () => {
  beforeEach(() => {
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {
      /* unlisten */
    });
  });

  /**
   * Regression test for the startup-stage indicator, which never worked: the
   * wrapper typed the payload as a bare TaskProgress while Rust wrapped it as
   * {taskId, payload:{stage}}, so every field read as undefined.
   */
  it('delivers the stage and taskId from the wrapped sidecar payload', async () => {
    const handler = vi.fn();
    await onTaskProgress(handler);

    emitTo('sidecar:task_progress', {
      type: 'task_progress',
      taskId: 't1',
      payload: { stage: 'configuring', message: 'Starting OpenCode server…' },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        stage: 'configuring',
        message: 'Starting OpenCode server…',
      })
    );
  });
});

describe('onTaskUpdate', () => {
  beforeEach(() => {
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {
      /* unlisten */
    });
  });

  it('maps an aborted task_complete to an interrupted result', async () => {
    const handler = vi.fn();
    await onTaskUpdate(handler);

    emitTo('sidecar:task_complete', {
      type: 'task_complete',
      taskId: 't1',
      payload: { status: 'aborted', sessionId: 's1' },
    });

    expect(handler).toHaveBeenCalledWith({
      taskId: 't1',
      type: 'complete',
      result: { status: 'interrupted', sessionId: 's1', error: undefined },
    });
  });

  it('no longer subscribes to task:update or task:progress', async () => {
    await onTaskUpdate(() => {
      /* noop */
    });
    const names = listenMock.mock.calls.map(([name]) => name);
    expect(names).not.toContain('task:update');
    expect(names).not.toContain('task:progress');
    expect(names).not.toContain('sidecar:task_progress');
    expect(names).toEqual(['sidecar:task_message', 'sidecar:task_complete', 'sidecar:task_error', 'sidecar:task_started']);
  });

  it('stringifies a non-string task_error payload', async () => {
    const handler = vi.fn();
    await onTaskUpdate(handler);

    emitTo('sidecar:task_error', {
      type: 'task_error',
      taskId: 't1',
      payload: { error: { code: 500 }, sessionId: 's1' },
    });

    expect(handler).toHaveBeenCalledWith({
      taskId: 't1',
      type: 'error',
      error: '{"code":500}',
      sessionId: 's1',
    });
  });
});
