import { EventEmitter } from 'node:events';
import EventSource from 'eventsource';
import { logger } from './logger';
import type { OpenCodeEvent } from './types';

export interface EventStreamOptions {
  baseUrl: string;
  directory?: string;
  reconnectInterval?: number;
  /** Server password for HTTP basic auth. When set, SSE connections include an Authorization header. */
  password?: string;
}

/**
 * GlobalBus event wrapper shape — `/global/event` emits
 *   { directory?: string, project?: string, payload: OpenCodeEvent }
 *
 * Server-only payloads (`server.connected`, `server.heartbeat`, `server.instance.disposed`)
 * arrive without `directory`; instance-scoped payloads (`session.*`, `message.*`,
 * `permission.asked`, etc.) always carry the workspace directory the event belongs to.
 *
 * We listen on `/global/event` rather than the per-instance `/event` because OpenCode
 * 1.14.x ties `/event` to per-request Effect/InstanceState lifecycle — the wildcard
 * PubSub fires `server.instance.disposed` and shuts down the moment the request scope
 * closes, severing the stream after the very first event. `/global/event` uses
 * GlobalBus (a plain Node EventEmitter) and is unaffected.
 */
interface GlobalEventEnvelope {
  directory?: string;
  project?: string;
  payload: OpenCodeEvent;
}

export class EventStream extends EventEmitter {
  private eventSource: EventSource | null = null;
  private baseUrl: string;
  private directory?: string;
  private reconnectInterval: number;
  private isConnected = false;
  private shouldReconnect = true;
  private authHeader?: string;

  constructor(options: EventStreamOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.directory = options.directory;
    this.reconnectInterval = options.reconnectInterval ?? 5000;
    if (options.password) {
      this.authHeader = `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`;
    }
  }

  connect(): void {
    if (this.eventSource) {
      this.disconnect();
    }

    this.shouldReconnect = true;

    // Use /global/event — OpenCode 1.14.x's /event endpoint terminates the chunked
    // response within ~1 ms because its wildcard PubSub is bound to per-request
    // Effect scope lifecycle (publishes server.instance.disposed and shuts down on
    // scope finalization). /global/event uses GlobalBus and stays open.
    const url = new URL('/global/event', this.baseUrl);

    logger.info(`Connecting to SSE stream: ${url.toString()} (filtering to directory=${this.directory ?? '<any>'})`);

    this.eventSource = new EventSource(url.toString(), this.authHeader ? { headers: { Authorization: this.authHeader } } : {});

    this.eventSource.onopen = () => {
      logger.info('SSE stream connected');
      this.isConnected = true;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      let envelope: GlobalEventEnvelope;
      try {
        envelope = JSON.parse(event.data) as GlobalEventEnvelope;
      } catch (error) {
        logger.error('Failed to parse SSE event data', { data: event.data, error });
        return;
      }

      // /global/event emits a stream-level envelope; unwrap to the OpenCode event payload.
      const data: OpenCodeEvent | undefined = envelope?.payload;
      if (!data || typeof data.type !== 'string') return;

      // Filter to events for our workspace. Server-only payloads (no `directory` on the
      // envelope) such as server.connected / server.heartbeat are always passed through;
      // workspace-scoped payloads are gated on directory match.
      if (envelope.directory && this.directory && envelope.directory !== this.directory) return;

      try {
        logger.serverEvent(data);
        this.emit('event', data);
        this.emit(data.type, data.properties);
      } catch (error) {
        logger.error('Error in SSE event handler', { type: data.type, error });
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
        logger.warn('SSE connection closed permanently, reconnecting manually...', error);
        setTimeout(() => this.connect(), this.reconnectInterval);
      } else {
        logger.debug('SSE stream error (EventSource will auto-reconnect)', error);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isConnected = false;
    logger.info('SSE stream disconnected');
  }

  /**
   * Reconnect the SSE stream with a new directory scope.
   * Used when the workspace changes to ensure session events are received.
   */
  reconnectWithDirectory(directory: string): void {
    this.directory = directory;
    this.disconnect();
    this.connect();
  }

  isActive(): boolean {
    return this.isConnected;
  }
}
