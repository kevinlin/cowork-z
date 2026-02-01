import { EventEmitter } from 'events';
import { OpenCodeAdapter } from '../adapter';
import type {
  OpenCodeTextMessage,
  OpenCodeStepFinishMessage,
  PartialMessageUpdate,
  CompleteMessageUpdate,
} from '../types';

// Mock node-pty
jest.mock('node-pty', () => ({
  spawn: jest.fn(),
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  accessSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => '{}'),
  writeFileSync: jest.fn(),
  constants: {
    R_OK: 4,
    X_OK: 1,
  },
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({ status: 0 })),
  spawn: jest.fn(),
}));

// Mock cli-path
jest.mock('../cli-path', () => ({
  getOpenCodeCliPath: jest.fn(() => ({ command: 'opencode', args: [] })),
  isOpenCodeAvailable: jest.fn(() => true),
  OpenCodeCliNotFoundError: class extends Error {
    constructor() {
      super('OpenCode CLI not found');
    }
  },
}));

// Mock config-generator
jest.mock('../config-generator', () => ({
  generateOpenCodeConfig: jest.fn(() => '/tmp/config.json'),
  buildOpenCodeEnvironment: jest.fn(() => ({})),
  getOpenCodeConfigDir: jest.fn(() => '/tmp'),
  ACCOMPLISH_AGENT_NAME: 'accomplish',
}));

describe('OpenCodeAdapter - Message Accumulation', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new OpenCodeAdapter('test-task-123');
  });

  afterEach(() => {
    adapter.dispose();
  });

  test('should create accumulator on first text event', (done) => {
    const textEvent: OpenCodeTextMessage = {
      type: 'text',
      part: {
        id: 'part-1',
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: 'Hello ',
      },
    };

    // Listen for partial message event
    adapter.once('message-partial', (update: PartialMessageUpdate) => {
      expect(update.messageId).toBe('msg-123');
      expect(update.textSoFar).toBe('Hello ');
      expect(update.isStreaming).toBe(true);
      done();
    });

    // Simulate receiving text event
    (adapter as any).handleMessage(textEvent);
  });

  test('should accumulate multiple text events for same messageID', (done) => {
    const events: OpenCodeTextMessage[] = [
      {
        type: 'text',
        part: {
          id: 'part-1',
          messageID: 'msg-123',
          sessionID: 'session-456',
          type: 'text',
          text: 'Hello ',
        },
      },
      {
        type: 'text',
        part: {
          id: 'part-2',
          messageID: 'msg-123',
          sessionID: 'session-456',
          type: 'text',
          text: 'world',
        },
      },
      {
        type: 'text',
        part: {
          id: 'part-3',
          messageID: 'msg-123',
          sessionID: 'session-456',
          type: 'text',
          text: '!',
        },
      },
    ];

    let lastTextSoFar = '';

    adapter.on('message-partial', (update: PartialMessageUpdate) => {
      lastTextSoFar = update.textSoFar;
    });

    // Emit all events
    events.forEach((event) => {
      (adapter as any).handleMessage(event);
    });

    // Wait for throttle period to ensure final update is emitted
    setTimeout(() => {
      expect(lastTextSoFar).toBe('Hello world!');
      done();
    }, 200);
  }, 10000);

  test('should throttle partial updates to 100ms', (done) => {
    jest.useFakeTimers();

    const events: OpenCodeTextMessage[] = Array.from({ length: 10 }, (_, i) => ({
      type: 'text',
      part: {
        id: `part-${i}`,
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: `chunk${i} `,
      },
    }));

    let emitCount = 0;

    adapter.on('message-partial', () => {
      emitCount++;
    });

    // Emit all events rapidly (within 50ms)
    events.forEach((event, i) => {
      setTimeout(() => {
        (adapter as any).handleMessage(event);
      }, i * 5); // 5ms apart
    });

    // Fast-forward 50ms (all events emitted)
    jest.advanceTimersByTime(50);

    // Should have emitted only once (first event)
    expect(emitCount).toBe(1);

    // Fast-forward another 100ms (throttle period)
    jest.advanceTimersByTime(100);

    // Should have emitted the pending update
    expect(emitCount).toBeGreaterThan(1);

    jest.useRealTimers();
    done();
  });

  test('should finalize accumulator on step_finish', (done) => {
    const textEvent: OpenCodeTextMessage = {
      type: 'text',
      part: {
        id: 'part-1',
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: 'Complete message',
      },
    };

    const finishEvent: OpenCodeStepFinishMessage = {
      type: 'step_finish',
      part: {
        id: 'part-2',
        sessionID: 'session-456',
        messageID: 'msg-finish',
        type: 'step-finish',
        reason: 'stop',
      },
    };

    let partialReceived = false;

    adapter.once('message-partial', () => {
      partialReceived = true;
    });

    adapter.once('message-complete', (update: CompleteMessageUpdate) => {
      expect(partialReceived).toBe(true);
      expect(update.messageId).toBe('msg-123');
      expect(update.text).toBe('Complete message');
      done();
    });

    // Emit text event
    (adapter as any).handleMessage(textEvent);

    // Wait for throttle, then emit finish
    setTimeout(() => {
      (adapter as any).handleMessage(finishEvent);
    }, 150);
  });

  test('should handle multiple concurrent accumulators', (done) => {
    const events: OpenCodeTextMessage[] = [
      {
        type: 'text',
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          sessionID: 'session-456',
          type: 'text',
          text: 'First',
        },
      },
      {
        type: 'text',
        part: {
          id: 'part-2',
          messageID: 'msg-2',
          sessionID: 'session-456',
          type: 'text',
          text: 'Second',
        },
      },
      {
        type: 'text',
        part: {
          id: 'part-3',
          messageID: 'msg-3',
          sessionID: 'session-456',
          type: 'text',
          text: 'Third',
        },
      },
    ];

    const receivedMessages = new Set<string>();

    adapter.on('message-partial', (update: PartialMessageUpdate) => {
      receivedMessages.add(update.messageId);

      if (receivedMessages.size === 3) {
        expect(receivedMessages.has('msg-1')).toBe(true);
        expect(receivedMessages.has('msg-2')).toBe(true);
        expect(receivedMessages.has('msg-3')).toBe(true);
        done();
      }
    });

    // Emit all events
    events.forEach((event) => {
      (adapter as any).handleMessage(event);
    });
  });

  test('should respect 100KB text limit per message', (done) => {
    const largeText = 'x'.repeat(101 * 1024); // 101KB

    const textEvent: OpenCodeTextMessage = {
      type: 'text',
      part: {
        id: 'part-1',
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: largeText,
      },
    };

    adapter.once('message-partial', (update: PartialMessageUpdate) => {
      // Should be truncated to 100KB
      expect(update.textSoFar.length).toBeLessThanOrEqual(100 * 1024);
      done();
    });

    (adapter as any).handleMessage(textEvent);
  });

  test('should clear accumulators on dispose', () => {
    const textEvent: OpenCodeTextMessage = {
      type: 'text',
      part: {
        id: 'part-1',
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: 'Test',
      },
    };

    (adapter as any).handleMessage(textEvent);

    // Verify accumulator exists
    expect((adapter as any).messageAccumulators.size).toBe(1);

    // Dispose adapter
    adapter.dispose();

    // Verify accumulators cleared
    expect((adapter as any).messageAccumulators.size).toBe(0);
    expect((adapter as any).pendingPartialEmits.size).toBe(0);
  });

  test('should not emit after dispose', (done) => {
    const textEvent: OpenCodeTextMessage = {
      type: 'text',
      part: {
        id: 'part-1',
        messageID: 'msg-123',
        sessionID: 'session-456',
        type: 'text',
        text: 'Test',
      },
    };

    let emitCount = 0;

    adapter.on('message-partial', () => {
      emitCount++;
    });

    // Dispose immediately
    adapter.dispose();

    // Try to emit event
    (adapter as any).handleMessage(textEvent);

    // Wait a bit to ensure no emission
    setTimeout(() => {
      expect(emitCount).toBe(0);
      done();
    }, 200);
  });
});
