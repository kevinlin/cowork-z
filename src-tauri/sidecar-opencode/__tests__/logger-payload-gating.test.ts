import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-logger-test-'));

jest.mock('../src/paths', () => ({
  getOpenCodeLogDir: () => tmpLogDir,
}));

import { Logger } from '../src/logger';

describe('Logger payload gating (technical review #10)', () => {
  let captured: Array<{ level: string; message: string }>;
  let testLogger: Logger;

  beforeEach(() => {
    captured = [];
    testLogger = new Logger();
    testLogger.setIpcEmitter((level, message) => {
      captured.push({ level, message });
    });
  });

  afterAll(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it('logs only the event type when payload logging is disabled', () => {
    testLogger.setPayloadLogging(false);
    testLogger.serverEvent({ type: 'message.part.updated', properties: { part: { text: 'user file contents' } } });

    expect(captured).toHaveLength(1);
    expect(captured[0].message).toContain('message.part.updated');
    expect(captured[0].message).not.toContain('user file contents');
  });

  it('logs the full event payload when payload logging is enabled', () => {
    testLogger.setPayloadLogging(true);
    testLogger.serverEvent({ type: 'message.part.updated', properties: { detail: 'full-payload' } });

    expect(captured[0].message).toContain('full-payload');
  });

  it('omits HTTP response bodies when payload logging is disabled', () => {
    testLogger.setPayloadLogging(false);
    testLogger.httpResponse('POST', '/session/abc/message', 200, { secretContent: 'conversation text' });

    expect(captured).toHaveLength(1);
    expect(captured[0].message).toContain('POST /session/abc/message -> 200');
    expect(captured[0].message).not.toContain('conversation text');
  });

  it('includes HTTP response bodies when payload logging is enabled', () => {
    testLogger.setPayloadLogging(true);
    testLogger.httpResponse('GET', '/health', 200, { version: '1.2.3' });

    expect(captured[0].message).toContain('1.2.3');
  });

  it('still redacts secrets inside payloads when payload logging is enabled', () => {
    testLogger.setPayloadLogging(true);
    testLogger.httpResponse('GET', '/config', 200, { apiKey: 'sk-very-secret' });

    expect(captured[0].message).not.toContain('sk-very-secret');
    expect(captured[0].message).toContain('[REDACTED]');
  });
});
