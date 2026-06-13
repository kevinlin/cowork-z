import { describe, expect, it } from '@jest/globals';
import { CommandQueue } from '../src/command-queue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('CommandQueue (2026-06-12 review #8)', () => {
  it('runs commands strictly in FIFO order, one at a time', async () => {
    const queue = new CommandQueue();
    const order: string[] = [];
    const first = deferred();

    queue.enqueue(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    }, jest.fn());
    queue.enqueue(async () => {
      order.push('b');
    }, jest.fn());

    // Let the first task start; the second must not run while it's pending
    await Promise.resolve();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('a failing handler does not break the chain for subsequent commands', async () => {
    const queue = new CommandQueue();
    const onError = jest.fn();
    const ran: string[] = [];

    queue.enqueue(() => Promise.reject(new Error('boom')), onError);
    queue.enqueue(async () => {
      ran.push('next');
    }, jest.fn());

    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ran).toEqual(['next']);
  });

  it('drops commands enqueued after shutdown begins', async () => {
    const queue = new CommandQueue();
    const ran: string[] = [];

    expect(
      queue.enqueue(async () => {
        ran.push('shutdown');
      }, jest.fn())
    ).toBe(true);
    queue.beginShutdown();
    expect(
      queue.enqueue(async () => {
        ran.push('late');
      }, jest.fn())
    ).toBe(false);

    await new Promise((r) => setImmediate(r));
    expect(ran).toEqual(['shutdown']);
    expect(queue.shuttingDown).toBe(true);
  });
});
