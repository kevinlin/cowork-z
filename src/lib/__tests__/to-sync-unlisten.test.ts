import { describe, expect, it, vi } from 'vitest';

import { toSyncUnlisten } from '../tauri-api';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('toSyncUnlisten', () => {
  it('unsubscribes normally when the registration resolved before cleanup', async () => {
    const unlistenFn = vi.fn();
    const cancel = toSyncUnlisten(Promise.resolve(unlistenFn));

    await flushMicrotasks();
    expect(unlistenFn).not.toHaveBeenCalled();

    cancel();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on late resolution when cleanup ran first', async () => {
    const unlistenFn = vi.fn();
    let resolveRegistration: (fn: () => void) => void = () => {};
    const registration = new Promise<() => void>((resolve) => {
      resolveRegistration = resolve;
    });

    const cancel = toSyncUnlisten(registration);
    cancel();
    expect(unlistenFn).not.toHaveBeenCalled();

    resolveRegistration(unlistenFn);
    await flushMicrotasks();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the registration rejects', async () => {
    const cancel = toSyncUnlisten(Promise.reject(new Error('listen failed')));
    await flushMicrotasks();
    expect(() => cancel()).not.toThrow();
  });
});
