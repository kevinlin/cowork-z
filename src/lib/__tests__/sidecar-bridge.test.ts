import type { SidecarEvent } from '@sidecar/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listenMock = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => listenMock(name, handler),
}));

import { onSidecarEvent, type SidecarEventType } from '../sidecar-bridge';

/**
 * Compile-time exhaustiveness guard. Adding a member to the sidecar's
 * `SidecarEvent` union breaks this file's compilation until it is listed here —
 * the closest thing to Rust's match exhaustiveness that TypeScript offers, and
 * the payoff for sharing types via the `@sidecar` alias.
 */
const ALL_EVENT_TYPES: Record<SidecarEventType, true> = {
  ready: true,
  pong: true,
  server_status: true,
  task_started: true,
  task_message: true,
  task_message_partial: true,
  task_message_complete: true,
  task_progress: true,
  permission_request: true,
  question_request: true,
  task_complete: true,
  task_error: true,
  todo_updated: true,
  mcp_status: true,
  mcp_tools: true,
  mcp_tools_changed: true,
  copilot_oauth_result: true,
  copilot_oauth_complete: true,
  copilot_models_result: true,
  request_api_keys: true,
  log: true,
  error: true,
};

/** Deliver a Tauri envelope to the handler registered by the last listen call. */
function emit(payload: unknown) {
  const calls = listenMock.mock.calls;
  const handler = calls[calls.length - 1][1] as (event: { payload: unknown }) => void;
  handler({ payload });
}

describe('onSidecarEvent', () => {
  beforeEach(() => {
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {
      /* unlisten */
    });
  });

  it('subscribes to the sidecar-prefixed event name', async () => {
    await onSidecarEvent('todo_updated', () => {
      /* noop */
    });
    expect(listenMock).toHaveBeenCalledWith('sidecar:todo_updated', expect.any(Function));
  });

  it('derives every event name by prefixing the sidecar type verbatim', async () => {
    for (const type of Object.keys(ALL_EVENT_TYPES) as SidecarEventType[]) {
      listenMock.mockClear();
      await onSidecarEvent(type, () => {
        /* noop */
      });
      expect(listenMock).toHaveBeenCalledWith(`sidecar:${type}`, expect.any(Function));
    }
  });

  it('unwraps the Tauri envelope exactly once', async () => {
    const handler = vi.fn();
    await onSidecarEvent('todo_updated', handler);

    const event: Extract<SidecarEvent, { type: 'todo_updated' }> = {
      type: 'todo_updated',
      taskId: 't1',
      payload: { todos: [] },
    };
    emit(event);

    // The handler receives {type, taskId, payload} — not {payload: {...}}.
    expect(handler).toHaveBeenCalledWith(event);
    expect(handler.mock.calls[0][0].taskId).toBe('t1');
    expect(handler.mock.calls[0][0].payload.todos).toEqual([]);
  });

  it('exposes taskId as a sibling of payload, not nested inside it', async () => {
    const handler = vi.fn();
    await onSidecarEvent('task_progress', handler);
    emit({ type: 'task_progress', taskId: 't9', payload: { stage: 'configuring' } });

    const received = handler.mock.calls[0][0];
    expect(received.taskId).toBe('t9');
    expect(received.payload.stage).toBe('configuring');
  });

  it('returns the unlisten function from listen', async () => {
    const unlisten = () => {
      /* noop */
    };
    listenMock.mockResolvedValue(unlisten);
    await expect(
      onSidecarEvent('pong', () => {
        /* noop */
      })
    ).resolves.toBe(unlisten);
  });
});
