import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    serverEvent: jest.fn(),
    httpResponse: jest.fn(),
  },
}));

// Mock EventSource — captures created instances so tests can drive
// onopen/onerror and count reconnect attempts.
const eventSourceInstances: MockEventSource[] = [];

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  close = jest.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    eventSourceInstances.push(this);
  }

  /** Simulate a permanent connection failure (readyState CLOSED). */
  failPermanently(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Error('connection refused'));
  }
}

jest.mock('eventsource', () => MockEventSource);

import { EventStream } from '../src/event-stream';

describe('EventStream reconnect behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    eventSourceInstances.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createStream = (reconnectInterval = 1000) => new EventStream({ baseUrl: 'http://127.0.0.1:1234', reconnectInterval });

  it('reconnects after a permanent failure', () => {
    const stream = createStream();
    stream.connect();
    expect(eventSourceInstances).toHaveLength(1);

    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(1000);

    expect(eventSourceInstances).toHaveLength(2);
    stream.disconnect();
  });

  it('does not resurrect the stream when disconnect() runs while a reconnect timer is pending', () => {
    const stream = createStream();
    stream.connect();
    eventSourceInstances[0].failPermanently();

    // Timer is pending; disconnect must cancel it
    stream.disconnect();
    jest.advanceTimersByTime(60_000);

    expect(eventSourceInstances).toHaveLength(1);
  });

  it('applies bounded exponential backoff across consecutive failures', () => {
    const stream = createStream(1000);
    stream.connect();

    // 1st failure → 1000ms delay
    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(999);
    expect(eventSourceInstances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(eventSourceInstances).toHaveLength(2);

    // 2nd failure → 2000ms delay
    eventSourceInstances[1].failPermanently();
    jest.advanceTimersByTime(1999);
    expect(eventSourceInstances).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(eventSourceInstances).toHaveLength(3);

    // 3rd failure → 4000ms delay
    eventSourceInstances[2].failPermanently();
    jest.advanceTimersByTime(3999);
    expect(eventSourceInstances).toHaveLength(3);
    jest.advanceTimersByTime(1);
    expect(eventSourceInstances).toHaveLength(4);

    stream.disconnect();
  });

  it('caps the backoff delay at 60s', () => {
    const stream = createStream(1000);
    stream.connect();

    // Drive enough failures that uncapped backoff would exceed 60s (2^7 = 128s)
    for (let i = 0; i < 8; i++) {
      eventSourceInstances[eventSourceInstances.length - 1].failPermanently();
      jest.advanceTimersByTime(60_000);
    }

    // Every failure must have produced a reconnect within the 60s cap
    expect(eventSourceInstances).toHaveLength(9);
    stream.disconnect();
  });

  it('drops workspace-scoped events when the stream has no directory scope (2026-06-12 review #23)', () => {
    const stream = createStream();
    stream.connect();
    const received: string[] = [];
    stream.on('event', (data: { type: string }) => received.push(data.type));

    const es = eventSourceInstances[0];
    // Workspace-scoped event (envelope carries a directory) — must be dropped
    es.onmessage?.({
      data: JSON.stringify({
        directory: '/some/workspace',
        payload: { type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } },
      }),
    });
    // Server-only event (no directory) — must pass through
    es.onmessage?.({
      data: JSON.stringify({
        payload: { type: 'server.heartbeat', properties: {} },
      }),
    });

    expect(received).toEqual(['server.heartbeat']);
    stream.disconnect();
  });

  it('passes only matching workspace events when the stream is directory-scoped', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', directory: '/my/workspace' });
    stream.connect();
    const received: string[] = [];
    stream.on('event', (data: { type: string }) => received.push(data.type));

    const es = eventSourceInstances[0];
    es.onmessage?.({
      data: JSON.stringify({
        directory: '/my/workspace',
        payload: { type: 'session.status', properties: {} },
      }),
    });
    es.onmessage?.({
      data: JSON.stringify({
        directory: '/other/workspace',
        payload: { type: 'message.updated', properties: {} },
      }),
    });

    expect(received).toEqual(['session.status']);
    stream.disconnect();
  });

  it('resets the backoff after a successful connection', () => {
    const stream = createStream(1000);
    stream.connect();

    // Two failures → attempts = 2
    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(1000);
    eventSourceInstances[1].failPermanently();
    jest.advanceTimersByTime(2000);
    expect(eventSourceInstances).toHaveLength(3);

    // Successful open resets attempts
    eventSourceInstances[2].readyState = MockEventSource.OPEN;
    eventSourceInstances[2].onopen?.();

    // Next failure should use the base interval again (1000ms)
    eventSourceInstances[2].failPermanently();
    jest.advanceTimersByTime(1000);
    expect(eventSourceInstances).toHaveLength(4);

    stream.disconnect();
  });
});
