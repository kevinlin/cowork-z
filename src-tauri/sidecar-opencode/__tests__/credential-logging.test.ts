import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-credential-log-test-'));

jest.mock('../src/paths', () => ({
  getOpenCodeLogDir: () => tmpLogDir,
  getAppOpenCodeConfigDir: () => path.join(tmpLogDir, 'app'),
}));

import { logger } from '../src/logger';
import { OpenCodeClient } from '../src/opencode-client';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/**
 * Field names the credential routes use for secrets (`key`, `access`, `refresh`) are not in the redaction
 * pattern, so the only thing keeping them out of the log is the client never handing the body to the logger.
 */
const SECRETS = ['sk-live-KEY-0001', 'gho_ACCESS_0002', 'ghr_REFRESH_0003'];
const secretBody = () => ({
  location: { directory: '/ws' },
  data: {
    attemptID: 'att_1',
    url: 'https://github.com/login/device',
    instructions: 'Enter code: ABCD-1234',
    mode: 'auto',
    status: 'complete',
    key: SECRETS[0],
    access: SECRETS[1],
    refresh: SECRETS[2],
    connections: [{ type: 'credential', id: 'cred_1', label: 'GitHub', method: 'oauth', access: SECRETS[1], refresh: SECRETS[2] }],
  },
});

const respond = (status: number, body: unknown) => ({ ok: status < 300, status, json: () => Promise.resolve(body) }) as Response;

async function readLogFile(): Promise<string> {
  // The write stream opens its file and flushes asynchronously: wait for the file and for logger.close()'s last line.
  let text = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    const [file] = fs.readdirSync(tmpLogDir).filter((name) => name.endsWith('.log'));
    text = file ? fs.readFileSync(path.join(tmpLogDir, file), 'utf-8') : '';
    if (text.includes('Log closed')) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return text;
}

describe('credential routes and the logger (payload logging on)', () => {
  const ipcLines: string[] = [];

  beforeAll(() => {
    logger.setPayloadLogging(true);
    logger.setIpcEmitter((_level, message) => ipcLines.push(message));
    logger.startSession('credential-test');
  });

  afterAll(async () => {
    // A failed test leaves the log stream open: close it and let its async open/flush finish before the directory goes.
    logger.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  it('writes nothing from a credential route response to the log file or the debug panel', async () => {
    const client = new OpenCodeClient({ port: 4096, password: 'test-pw' });

    // Control: an ordinary route's body IS logged with payload logging on, so a leak elsewhere would show.
    mockFetch.mockResolvedValueOnce(respond(200, { version: 'CONTROL-VISIBLE-9.9.9' }));
    await client.info();

    // Every route that can carry credential material, success path.
    mockFetch.mockResolvedValueOnce(respond(200, secretBody()));
    await client.listIntegrations('/ws');
    mockFetch.mockResolvedValueOnce(respond(200, secretBody()));
    await client.startOAuth('github-copilot', { methodID: 'device' }, '/ws');
    mockFetch.mockResolvedValueOnce(respond(200, secretBody()));
    await client.getOAuthAttempt('github-copilot', 'att_1', '/ws');
    mockFetch.mockResolvedValueOnce(respond(200, secretBody()));
    await client.completeOAuth('github-copilot', 'att_1', undefined, '/ws');
    mockFetch.mockResolvedValueOnce(respond(200, secretBody()));
    await client.deleteCredential('cred_1');

    // Error path: the thrown error is what handlers log.
    const errors: unknown[] = [];
    for (const call of [
      () => client.listIntegrations('/ws'),
      () => client.startOAuth('github-copilot', { methodID: 'device' }, '/ws'),
      () => client.getOAuthAttempt('github-copilot', 'att_1', '/ws'),
      () => client.completeOAuth('github-copilot', 'att_1', undefined, '/ws'),
      () => client.deleteCredential('cred_1'),
    ]) {
      mockFetch.mockResolvedValueOnce(respond(500, { ...secretBody(), message: 'boom' }));
      errors.push(await call().catch((error: unknown) => error));
    }
    for (const error of errors) {
      logger.error('credential route failed', { error: (error as Error).message });
    }

    logger.close();
    const logFile = await readLogFile();
    const everything = `${logFile}\n${ipcLines.join('\n')}`;

    // The control proves payload logging is really on and the capture works.
    expect(everything).toContain('CONTROL-VISIBLE-9.9.9');
    // Nothing from the credential responses, in either sink, by value or by field.
    for (const secret of SECRETS) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toContain('ABCD-1234');
    expect(everything).not.toContain('cred_1"'); // the connection object from the body (the path form `/api/credential/cred_1` is request metadata)
    // The calls themselves are still traced by method, path and status.
    expect(everything).toContain('DELETE /api/credential/cred_1 -> 200');
    expect(everything).toContain('POST /api/integration/github-copilot/connect/oauth -> 200');
    expect(errors.every((error) => (error as Error).message.includes('boom'))).toBe(true);
  });
});
