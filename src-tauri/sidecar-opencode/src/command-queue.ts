/**
 * FIFO command queue for stdin IPC commands (2026-06-12 review #8).
 *
 * Each JSON line on stdin used to spawn an async handler with no
 * serialization, so overlapping commands (start_task + shutdown, two task
 * starts, OAuth + task start) raced on shared module state (processManager,
 * sessionManager, initializePromise, SSE reconnection). The queue chains
 * handlers so each command completes before the next is dispatched, and
 * rejects commands once shutdown has begun.
 *
 * Note: latency-sensitive / re-entrant commands (ping, api_keys_response)
 * must be handled OUTSIDE the queue — api_keys_response in particular
 * resolves a promise that a queued command is awaiting, so routing it
 * through the queue would deadlock.
 */
export class CommandQueue {
  private tail: Promise<void> = Promise.resolve();
  private shuttingDownFlag = false;

  get shuttingDown(): boolean {
    return this.shuttingDownFlag;
  }

  /** Mark the queue as shutting down; subsequent enqueue() calls are dropped. */
  beginShutdown(): void {
    this.shuttingDownFlag = true;
  }

  /**
   * Append a task to the FIFO chain. Returns true if accepted, false if
   * dropped because shutdown has begun. Errors are routed to onError so a
   * failing handler never breaks the chain for subsequent commands.
   */
  enqueue(task: () => Promise<void>, onError: (error: unknown) => void): boolean {
    if (this.shuttingDownFlag) {
      return false;
    }
    this.tail = this.tail.then(task).catch(onError);
    return true;
  }
}
