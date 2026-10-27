import { describe, expect, it, jest } from '@jest/globals';
import { toV2McpConfig } from '../src/config-builder';
import { mcpConfigsEqual, reapplyMcpServers, toMcpStatusRecord } from '../src/mcp-runtime';
import { OpenCodeHttpError } from '../src/opencode-client';
import type { McpConfig, McpServerState } from '../src/types';

jest.mock('../src/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('toMcpStatusRecord', () => {
  it('maps the v2 list into the name → {status, error?} record the UI reads', () => {
    const servers: McpServerState[] = [
      { name: 'github', status: { status: 'connected' } },
      { name: 'files', status: { status: 'disabled' } },
    ];

    expect(toMcpStatusRecord(servers)).toEqual({
      github: { status: 'connected' },
      files: { status: 'disabled' },
    });
  });

  it.each([
    ['connected', undefined, { status: 'connected' }],
    ['disabled', undefined, { status: 'disabled' }],
    ['failed', 'spawn ENOENT', { status: 'failed', error: 'spawn ENOENT' }],
    ['needs_auth', 'Authorization required', { status: 'needs_auth', error: 'Authorization required' }],
  ])('passes the %s status through unchanged', (status, error, expected) => {
    const result = toMcpStatusRecord([{ name: 'srv', status: { status, ...(error ? { error } : {}) } }]);

    expect(result).toEqual({ srv: expected });
  });

  it('maps pending to the UI status initializing: the server is still connecting, so it is not connected yet', () => {
    expect(toMcpStatusRecord([{ name: 'srv', status: { status: 'pending' } }])).toEqual({ srv: { status: 'initializing' } });
  });

  it('does not add an error key when the server sent none', () => {
    const result = toMcpStatusRecord([{ name: 'srv', status: { status: 'connected' } }]);

    expect(Object.keys(result.srv)).toEqual(['status']);
  });

  it('leaves a status it does not know untouched, and ignores the integrationID', () => {
    const result = toMcpStatusRecord([{ name: 'srv', status: { status: 'needs_client_registration' }, integrationID: 'int_1' }]);

    expect(result).toEqual({ srv: { status: 'needs_client_registration' } });
  });

  it('returns an empty record for an empty list', () => {
    expect(toMcpStatusRecord([])).toEqual({});
  });
});

describe('mcpConfigsEqual', () => {
  it('compares the configs as the server would receive them', () => {
    const a: McpConfig = { type: 'local', command: ['npx', 'x'], enabled: true };
    const b: McpConfig = { type: 'local', command: ['npx', 'x'] };

    expect(mcpConfigsEqual(a, b)).toBe(true);
    expect(mcpConfigsEqual(a, { ...a, enabled: false })).toBe(false);
    expect(mcpConfigsEqual(a, { ...a, command: ['npx', 'y'] })).toBe(false);
  });
});

describe('reapplyMcpServers (workspace switch)', () => {
  const local = (command: string): McpConfig => ({ type: 'local', command: [command] });

  function fakeClient() {
    return {
      putMcpServer: jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined),
      removeMcpServer: jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue(undefined),
    };
  }

  it('puts every server whose config differs from the spawn-time one, at the new location', async () => {
    const client = fakeClient();
    const spawned = { same: local('a'), changed: local('b') };
    const applied = { same: local('a'), changed: local('b2'), added: local('c') };

    const failures = await reapplyMcpServers(client, '/new-ws', applied, spawned);

    expect(failures).toEqual([]);
    expect(client.putMcpServer).toHaveBeenCalledTimes(2);
    expect(client.putMcpServer).toHaveBeenCalledWith('changed', toV2McpConfig(applied.changed), '/new-ws');
    expect(client.putMcpServer).toHaveBeenCalledWith('added', toV2McpConfig(applied.added), '/new-ws');
    expect(client.removeMcpServer).not.toHaveBeenCalled();
  });

  it('deletes a spawn-time server that was removed since, at the new location', async () => {
    const client = fakeClient();

    await reapplyMcpServers(client, '/new-ws', { kept: local('a') }, { kept: local('a'), removed: local('b') });

    expect(client.removeMcpServer).toHaveBeenCalledTimes(1);
    expect(client.removeMcpServer).toHaveBeenCalledWith('removed', '/new-ws');
    expect(client.putMcpServer).not.toHaveBeenCalled();
  });

  it('makes no request when the applied set still equals the spawn-time set', async () => {
    const client = fakeClient();

    await reapplyMcpServers(client, '/new-ws', { a: local('a') }, { a: local('a') });

    expect(client.putMcpServer).not.toHaveBeenCalled();
    expect(client.removeMcpServer).not.toHaveBeenCalled();
  });

  it('keeps going after one server fails and reports each failure', async () => {
    const client = fakeClient();
    client.putMcpServer.mockImplementation(async (name: string) => {
      if (name === 'bad') throw new Error('connect timed out');
    });

    const failures = await reapplyMcpServers(client, '/new-ws', { bad: local('x'), good: local('y') }, {});

    expect(client.putMcpServer).toHaveBeenCalledTimes(2);
    expect(failures).toEqual(['bad: connect timed out']);
  });

  it('treats a 404 on delete as already gone', async () => {
    const client = fakeClient();
    client.removeMcpServer.mockRejectedValue(new OpenCodeHttpError(404, { _tag: 'McpServerNotFoundError' }));

    const failures = await reapplyMcpServers(client, '/new-ws', {}, { gone: local('a') });

    expect(failures).toEqual([]);
  });

  it('reports a non-404 delete failure', async () => {
    const client = fakeClient();
    client.removeMcpServer.mockRejectedValue(new OpenCodeHttpError(500, { message: 'boom' }));

    const failures = await reapplyMcpServers(client, '/new-ws', {}, { stuck: local('a') });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('stuck');
  });
});
