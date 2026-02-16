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

    const url = new URL('/event', this.baseUrl);
    if (this.directory) {
      url.searchParams.set('directory', this.directory);
    }

    logger.info(`Connecting to SSE stream: ${url.toString()}`);

    this.eventSource = new EventSource(url.toString(), this.authHeader ? { headers: { Authorization: this.authHeader } } : {});

    this.eventSource.onopen = () => {
      logger.info('SSE stream connected');
      this.isConnected = true;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      let data: OpenCodeEvent;
      try {
        data = JSON.parse(event.data) as OpenCodeEvent;
      } catch (error) {
        logger.error('Failed to parse SSE event data', { data: event.data, error });
        return;
      }

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
