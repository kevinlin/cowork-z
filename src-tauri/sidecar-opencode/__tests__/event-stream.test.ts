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
  init: { headers?: Record<string, string> } | undefined;
  readyState = MockEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  close = jest.fn(() => {
    this.readyState = MockEventSource.CLOSED;
  });

  constructor(url: string, init?: { headers?: Record<string, string> }) {
    this.url = url;
    this.init = init;
    eventSourceInstances.push(this);
  }

  /** Simulate a permanent connection failure (readyState CLOSED). */
  failPermanently(): void {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Error('connection refused'));
  }

  /** Deliver one v2 frame: `{type, location?, data}`. */
  frame(type: string, data: unknown = {}, location?: { directory?: string }): void {
    this.onmessage?.({ data: JSON.stringify({ id: `evt_${type}`, type, ...(location ? { location } : {}), data }) });
  }
}

jest.mock('eventsource', () => MockEventSource);

import { EventStream } from '../src/event-stream';

/** connect() returns a readiness promise that rejects after 10 s; tests that only drive reconnects ignore it. */
function connectQuietly(stream: InstanceType<typeof EventStream>): Promise<void> {
  const ready = stream.connect();
  ready.catch(() => undefined);
  return ready;
}

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
    connectQuietly(stream);
    expect(eventSourceInstances).toHaveLength(1);

    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(1000);

    expect(eventSourceInstances).toHaveLength(2);
    stream.disconnect();
  });

  it('does not resurrect the stream when disconnect() runs while a reconnect timer is pending', () => {
    const stream = createStream();
    connectQuietly(stream);
    eventSourceInstances[0].failPermanently();

    // Timer is pending; disconnect must cancel it
    stream.disconnect();
    jest.advanceTimersByTime(60_000);

    expect(eventSourceInstances).toHaveLength(1);
  });

  it('applies bounded exponential backoff across consecutive failures', () => {
    const stream = createStream(1000);
    connectQuietly(stream);

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
    connectQuietly(stream);

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
    connectQuietly(stream);
    const received: string[] = [];
    stream.on('event', (frame: { type: string }) => received.push(frame.type));

    const es = eventSourceInstances[0];
    // Workspace-scoped event (frame carries a location) — must be dropped
    es.frame('session.text.delta', { sessionID: 'ses_1' }, { directory: '/some/workspace' });
    // Frame without a location — must pass through
    es.frame('session.execution.started', { sessionID: 'ses_1' });

    expect(received).toEqual(['session.execution.started']);
    stream.disconnect();
  });

  it('passes only matching workspace events when the stream is directory-scoped', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', directory: '/my/workspace' });
    connectQuietly(stream);
    const received: string[] = [];
    stream.on('event', (frame: { type: string }) => received.push(frame.type));

    const es = eventSourceInstances[0];
    es.frame('session.text.delta', {}, { directory: '/my/workspace' });
    es.frame('session.tool.called', {}, { directory: '/other/workspace' });

    expect(received).toEqual(['session.text.delta']);
    stream.disconnect();
  });

  it('matches directories regardless of slash style or a trailing slash (v2 normalises paths to forward slashes)', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', directory: 'C:\\Users\\me\\ws\\' });
    connectQuietly(stream);
    const received: string[] = [];
    stream.on('event', (frame: { type: string }) => received.push(frame.type));

    eventSourceInstances[0].frame('session.text.delta', {}, { directory: 'C:/Users/me/ws' });

    expect(received).toEqual(['session.text.delta']);
    stream.disconnect();
  });

  it('resets the backoff after a successful connection', () => {
    const stream = createStream(1000);
    connectQuietly(stream);

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

describe('EventStream v2 frames', () => {
  beforeEach(() => {
    eventSourceInstances.length = 0;
  });

  it('subscribes to /api/event with the basic-auth header', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', password: 'pw' });
    connectQuietly(stream);

    expect(eventSourceInstances[0].url).toBe('http://127.0.0.1:1234/api/event');
    expect(eventSourceInstances[0].init).toEqual({ headers: { Authorization: `Basic ${Buffer.from('opencode:pw').toString('base64')}` } });
    stream.disconnect();
  });

  it('emits the frame as "event" and its data under the event type', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', directory: '/ws' });
    connectQuietly(stream);
    const frames: unknown[] = [];
    const typed: unknown[] = [];
    stream.on('event', (frame) => frames.push(frame));
    stream.on('session.text.delta', (data) => typed.push(data));

    eventSourceInstances[0].frame('session.text.delta', { sessionID: 'ses_1', delta: 'hi' }, { directory: '/ws' });

    expect(typed).toEqual([{ sessionID: 'ses_1', delta: 'hi' }]);
    expect(frames).toEqual([
      expect.objectContaining({ type: 'session.text.delta', location: { directory: '/ws' }, data: { sessionID: 'ses_1', delta: 'hi' } }),
    ]);
    stream.disconnect();
  });

  it('ignores frames that are not JSON or have no type', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    connectQuietly(stream);
    const frames: unknown[] = [];
    stream.on('event', (frame) => frames.push(frame));

    eventSourceInstances[0].onmessage?.({ data: 'not json' });
    eventSourceInstances[0].onmessage?.({ data: JSON.stringify({ data: {} }) });

    expect(frames).toEqual([]);
    stream.disconnect();
  });

  it('setDirectory retargets the workspace filter without opening a new connection', () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', directory: '/a' });
    connectQuietly(stream);
    const received: string[] = [];
    stream.on('event', (frame: { type: string; location?: { directory: string } }) =>
      received.push(`${frame.type}@${frame.location?.directory}`)
    );

    stream.setDirectory('/b');
    eventSourceInstances[0].frame('session.tool.called', {}, { directory: '/a' });
    eventSourceInstances[0].frame('session.tool.called', {}, { directory: '/b' });

    expect(eventSourceInstances).toHaveLength(1);
    expect(received).toEqual(['session.tool.called@/b']);
    stream.disconnect();
  });
});

describe('EventStream readiness and reconnect recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    eventSourceInstances.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves connect() only on the first server.connected frame, not on the HTTP open', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    let resolved = false;
    const ready = stream.connect().then(() => {
      resolved = true;
    });

    eventSourceInstances[0].readyState = MockEventSource.OPEN;
    eventSourceInstances[0].onopen?.();
    await Promise.resolve();
    expect(resolved).toBe(false);

    eventSourceInstances[0].frame('server.connected');
    await ready;
    expect(resolved).toBe(true);
    stream.disconnect();
  });

  it('rejects connect() after 10 seconds without server.connected', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    const ready = stream.connect();
    const outcome = ready.then(
      () => 'resolved',
      (error: Error) => error.message
    );

    jest.advanceTimersByTime(9999);
    await Promise.resolve();
    jest.advanceTimersByTime(1);

    await expect(outcome).resolves.toMatch(/server\.connected/);
    stream.disconnect();
  });

  it('does not reject once server.connected arrived before the timeout', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    const ready = stream.connect();
    eventSourceInstances[0].frame('server.connected');
    await ready;

    jest.advanceTimersByTime(60_000);

    await expect(ready).resolves.toBeUndefined();
    stream.disconnect();
  });

  it('rejects a pending connect() when disconnect() is called first', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    const ready = stream.connect();

    stream.disconnect();

    await expect(ready).rejects.toThrow(/disconnected/i);
  });

  it('emits "reconnected" on every later server.connected, but not on the first', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234' });
    const reconnected = jest.fn();
    stream.on('reconnected', reconnected);
    const ready = stream.connect();

    eventSourceInstances[0].frame('server.connected');
    await ready;
    expect(reconnected).not.toHaveBeenCalled();

    // EventSource auto-reconnects on the same instance and the server greets again
    eventSourceInstances[0].frame('server.connected');
    eventSourceInstances[0].frame('server.connected');

    expect(reconnected).toHaveBeenCalledTimes(2);
    stream.disconnect();
  });

  it('emits "reconnected" after a manual reconnect that follows a permanent failure', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', reconnectInterval: 1000 });
    const reconnected = jest.fn();
    stream.on('reconnected', reconnected);
    const ready = stream.connect();
    eventSourceInstances[0].frame('server.connected');
    await ready;

    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(1000);
    expect(eventSourceInstances).toHaveLength(2);
    expect(reconnected).not.toHaveBeenCalled();

    eventSourceInstances[1].frame('server.connected');

    expect(reconnected).toHaveBeenCalledTimes(1);
    stream.disconnect();
  });

  it('does not leave an unhandled rejection when a manual reconnect never becomes ready', async () => {
    const stream = new EventStream({ baseUrl: 'http://127.0.0.1:1234', reconnectInterval: 1000 });
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const ready = stream.connect();
    eventSourceInstances[0].frame('server.connected');
    await ready;

    eventSourceInstances[0].failPermanently();
    jest.advanceTimersByTime(1000); // manual reconnect starts a new readiness timer
    jest.advanceTimersByTime(10_000); // ...which times out with nobody awaiting it
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    stream.disconnect();
  });
});
