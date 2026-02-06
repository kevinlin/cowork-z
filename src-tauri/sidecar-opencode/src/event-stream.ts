import { EventEmitter } from 'node:events';
import EventSource from 'eventsource';
import { logger } from './logger';
import type { OpenCodeEvent } from './types';

export interface EventStreamOptions {
  baseUrl: string;
  directory?: string;
  reconnectInterval?: number;
}

export class EventStream extends EventEmitter {
  private eventSource: EventSource | null = null;
  private baseUrl: string;
  private directory?: string;
  private reconnectInterval: number;
  private isConnected = false;
  private shouldReconnect = true;

  constructor(options: EventStreamOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.directory = options.directory;
    this.reconnectInterval = options.reconnectInterval ?? 5000;
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

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      logger.info('SSE stream connected');
      this.isConnected = true;
      this.emit('connected');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as OpenCodeEvent;
        logger.serverEvent(data);
        this.emit('event', data);
        this.emit(data.type, data.properties);
      } catch (error) {
        logger.error('Failed to parse SSE event', { data: event.data, error });
      }
    };

    this.eventSource.onerror = (error) => {
      logger.error('SSE stream error', error);
      this.isConnected = false;
      this.emit('error', error);

      if (this.shouldReconnect) {
        logger.info(`Reconnecting in ${this.reconnectInterval}ms...`);
        setTimeout(() => this.connect(), this.reconnectInterval);
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

  isActive(): boolean {
    return this.isConnected;
  }
}
