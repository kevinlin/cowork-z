import { EventEmitter } from 'node:events';
import EventSource from 'eventsource';
import { logger } from './logger';
import type { OpenCodeEventFrame } from './types';

export interface EventStreamOptions {
  baseUrl: string;
  directory?: string;
  reconnectInterval?: number;
  /** Server password for HTTP basic auth. When set, SSE connections include an Authorization header. */
  password?: string;
}

/** Upper bound for the exponential reconnect backoff. */
const MAX_RECONNECT_INTERVAL_MS = 60_000;

/** How long `connect()` waits for the server's first `server.connected` frame. */
const READY_TIMEOUT_MS = 10_000;

/**
 * v2 reports paths with forward slashes; the host may hand us Windows paths. Compare in one form.
 */
function normalizeDirectory(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '');
}

interface PendingReady {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Client for OpenCode 2.x `GET /api/event`.
 *
 * Frames are `{id, created, type, location?: {directory}, data}` sent as plain `data:` lines.
 * `server.connected` (the server's greeting) and `session.execution.*` carry no `location`.
 * The stream is volatile by contract: events sent while it is down are lost and there is no
 * replay, so every `server.connected` after the first emits `reconnected` and the session
 * manager rebuilds its state over REST.
 *
 * Emits: `event` (the whole frame), `<frame.type>` (the frame's `data`), `connected` (HTTP open),
 * `reconnected`, `stream-error`.
 */
export class EventStream extends EventEmitter {
  private eventSource: EventSource | null = null;
  private baseUrl: string;
  private directory?: string;
  private reconnectInterval: number;
  private isConnected = false;
  private shouldReconnect = true;
  private authHeader?: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private pendingReady: PendingReady | null = null;
  private hasBeenReady = false;

  constructor(options: EventStreamOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.directory = options.directory;
    this.reconnectInterval = options.reconnectInterval ?? 5000;
    if (options.password) {
      this.authHeader = `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`;
    }
  }

  /**
   * Open the stream. The returned promise resolves on the first `server.connected` frame and
   * rejects after 10 s (or when `disconnect()` runs first), so a caller can fail startup instead
   * of racing the first events of a turn.
   */
  connect(): Promise<void> {
    if (this.eventSource) {
      this.disconnect();
    }

    this.shouldReconnect = true;

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingReady?.timer === timer) this.pendingReady = null;
        logger.warn(`OpenCode event stream sent no server.connected within ${READY_TIMEOUT_MS}ms`);
        reject(new Error(`Timed out after ${READY_TIMEOUT_MS}ms waiting for server.connected on the OpenCode event stream`));
      }, READY_TIMEOUT_MS);
      this.pendingReady = { resolve, reject, timer };
    });

    const url = new URL('/api/event', this.baseUrl);

    logger.info(`Connecting to SSE stream: ${url.toString()} (filtering to directory=${this.directory ?? '<any>'})`);

    this.eventSource = new EventSource(url.toString(), this.authHeader ? { headers: { Authorization: this.authHeader } } : {});

    this.eventSource.onopen = () => {
      logger.info('SSE stream connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      let frame: OpenCodeEventFrame;
      try {
        frame = JSON.parse(event.data) as OpenCodeEventFrame;
      } catch (error) {
        logger.error('Failed to parse SSE event data', { data: event.data, error });
        return;
      }

      if (!frame || typeof frame.type !== 'string') return;

      if (frame.type === 'server.connected') {
        this.handleServerConnected();
      }

      // Filter to events for our workspace. Frames without a location (server.connected,
      // session.execution.*) always pass; workspace-scoped frames are gated on a directory
      // match. When this stream has no directory scope (e.g. the sidecar initialized for
      // Copilot OAuth before any task), workspace-scoped events are dropped rather than passed
      // through — routing them on the session map alone risks misattribution (2026-06-12
      // review #23). A task start re-scopes the stream via setDirectory.
      const frameDirectory = frame.location?.directory;
      if (frameDirectory) {
        if (!this.directory || normalizeDirectory(frameDirectory) !== normalizeDirectory(this.directory)) return;
      }

      try {
        logger.serverEvent(frame);
        this.emit('event', frame);
        this.emit(frame.type, frame.data);
      } catch (error) {
        logger.error('Error in SSE event handler', { type: frame.type, error });
      }
    };

    this.eventSource.onerror = (error) => {
      this.isConnected = false;
      // Use 'stream-error' instead of 'error' to avoid Node.js EventEmitter
      // throwing ERR_UNHANDLED_ERROR when no listener is attached.
      this.emit('stream-error', error);

      // Only manually reconnect if EventSource has given up (readyState CLOSED).
      // When readyState is CONNECTING, EventSource auto-reconnects on its own
      // and we should not create a competing second connection.
      if (this.eventSource?.readyState === EventSource.CLOSED && this.shouldReconnect) {
        this.scheduleReconnect(error);
      } else {
        logger.debug('SSE stream error (EventSource will auto-reconnect)', error);
      }
    };

    return ready;
  }

  /** First greeting resolves `connect()`; every later one means events may have been lost. */
  private handleServerConnected(): void {
    const pending = this.pendingReady;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingReady = null;
      pending.resolve();
    }
    if (this.hasBeenReady) {
      logger.info('SSE stream re-established — sessions must be rebuilt from REST');
      this.emit('reconnected');
    }
    this.hasBeenReady = true;
  }

  private settleReadyWithError(error: Error): void {
    const pending = this.pendingReady;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingReady = null;
      pending.reject(error);
    }
  }

  /**
   * Schedule a manual reconnect with bounded exponential backoff. The timer
   * handle is stored so disconnect() can cancel it, and the callback re-checks
   * shouldReconnect so a timer that was pending when disconnect() ran can
   * never resurrect the stream.
   */
  private scheduleReconnect(error: unknown): void {
    this.clearReconnectTimer();

    const delay = Math.min(this.reconnectInterval * 2 ** this.reconnectAttempts, MAX_RECONNECT_INTERVAL_MS);
    this.reconnectAttempts += 1;
    logger.warn(`SSE connection closed permanently, reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`, error);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        // Nobody awaits a background reconnect; the readiness result is only logged.
        this.connect().catch((readyError: unknown) => {
          logger.debug('Background SSE reconnect did not become ready', readyError);
        });
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.settleReadyWithError(new Error('Event stream disconnected before server.connected'));
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    logger.info('SSE stream disconnected');
  }

  /**
   * Scope the workspace filter to a new directory. v2 has one global stream and filters on the
   * client, so a workspace switch needs no reconnect (and opens no gap in which events are lost).
   */
  setDirectory(directory: string): void {
    this.directory = directory;
  }

  isActive(): boolean {
    return this.isConnected;
  }
}
