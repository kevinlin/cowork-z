import { describe, expect, it } from '@jest/globals';
import { buildSessionPermissions, toV2McpConfig } from '../src/config-builder';
import type { FolderPermission, McpConfig, PermissionRule } from '../src/types';

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const WS_PATH = process.platform === 'win32' ? 'C:\\tmp\\my-ws' : '/tmp/my-ws';
const workspacePerm: FolderPermission = {
  path: WS_PATH,
  accessLevel: 'read-write',
  source: 'workspace',
};

/** The rules every session starts with: v2 allows external directories by default, so ask first. */
const LEADING_RULES: PermissionRule[] = [{ action: 'external_directory', resource: '*', effect: 'ask' }];

/** What the workspace entry itself contributes: the general edit rule plus the four convention folders. */
const WORKSPACE_RULES: PermissionRule[] = [
  { action: 'edit', resource: '*', effect: 'ask' },
  { action: 'edit', resource: 'Input/*', effect: 'deny' },
  { action: 'edit', resource: 'Output/*', effect: 'allow' },
  { action: 'edit', resource: 'Misc/*', effect: 'ask' },
  { action: 'edit', resource: 'Artefacts/*', effect: 'ask' },
];

/** Rules for one non-workspace folder; every one of them is an absolute pattern with forward slashes. */
const folderRules = (pattern: string, edit: 'deny' | 'ask' | 'allow'): PermissionRule[] => [
  { action: 'external_directory', resource: pattern, effect: 'allow' },
  { action: 'read', resource: pattern, effect: 'allow' },
  { action: 'edit', resource: pattern, effect: edit },
];

describe('buildSessionPermissions — workspace convention folders', () => {
  it('returns the full ordered rule list for a workspace-only payload', () => {
    expect(buildSessionPermissions([workspacePerm])).toEqual([...LEADING_RULES, ...WORKSPACE_RULES]);
  });

  it('uses location-relative patterns for the workspace, never an absolute workspace path', () => {
    const rules = buildSessionPermissions([workspacePerm]);

    expect(rules.filter((r) => r.resource.includes('my-ws'))).toEqual([]);
    expect(rules.filter((r) => r.action === 'edit').map((r) => r.resource)).toEqual(['*', 'Input/*', 'Output/*', 'Misc/*', 'Artefacts/*']);
  });

  it('does not treat the workspace as an external directory or add read rules for it', () => {
    const rules = buildSessionPermissions([workspacePerm]);

    expect(rules.filter((r) => r.action === 'external_directory')).toEqual(LEADING_RULES);
    expect(rules.filter((r) => r.action === 'read')).toEqual([]);
  });

  it('puts the general rules before the overrides so the last match wins', () => {
    const rules = buildSessionPermissions([workspacePerm]);
    const index = (resource: string) => rules.findIndex((r) => r.action === 'edit' && r.resource === resource);

    expect(rules[0]).toEqual({ action: 'external_directory', resource: '*', effect: 'ask' });
    expect(index('*')).toBe(1);
    expect(index('*')).toBeLessThan(index('Input/*'));
    expect(index('Input/*')).toBeLessThan(index('Output/*'));
  });

  it('never emits the removed doom_loop action', () => {
    const rules = buildSessionPermissions([workspacePerm, { path: '/tmp/ext', accessLevel: 'read' }]);

    expect(rules.some((r) => r.action === 'doom_loop')).toBe(false);
  });
});

describe('buildSessionPermissions — non-workspace folders', () => {
  it('read-only folder: external_directory and read allow, edit deny', () => {
    const rules = buildSessionPermissions([workspacePerm, { path: '/tmp/ext', accessLevel: 'read', source: 'user' }]);

    expect(rules).toEqual([...LEADING_RULES, ...WORKSPACE_RULES, ...folderRules('/tmp/ext/*', 'deny')]);
  });

  it('read-write folder added by the user: edit ask', () => {
    const rules = buildSessionPermissions([workspacePerm, { path: '/tmp/ext', accessLevel: 'read-write', source: 'user' }]);

    expect(rules).toEqual([...LEADING_RULES, ...WORKSPACE_RULES, ...folderRules('/tmp/ext/*', 'ask')]);
  });

  it('a folder without a source counts as user-added: read-write asks, read denies', () => {
    expect(buildSessionPermissions([{ path: '/tmp/a', accessLevel: 'read-write' }])).toEqual([
      ...LEADING_RULES,
      { action: 'edit', resource: '*', effect: 'ask' },
      ...folderRules('/tmp/a/*', 'ask'),
    ]);
    expect(buildSessionPermissions([{ path: '/tmp/a', accessLevel: 'read' }])).toEqual([
      ...LEADING_RULES,
      { action: 'edit', resource: '*', effect: 'ask' },
      ...folderRules('/tmp/a/*', 'deny'),
    ]);
  });

  it('adhoc read-write folder (granted from a permission prompt): edit allow', () => {
    const rules = buildSessionPermissions([workspacePerm, { path: '/tmp/ext', accessLevel: 'read-write', source: 'adhoc' }]);

    expect(rules).toEqual([...LEADING_RULES, ...WORKSPACE_RULES, ...folderRules('/tmp/ext/*', 'allow')]);
  });

  it('adhoc folder with read-only access still denies edits', () => {
    const rules = buildSessionPermissions([workspacePerm, { path: '/tmp/ext', accessLevel: 'read', source: 'adhoc' }]);

    expect(rules).toEqual([...LEADING_RULES, ...WORKSPACE_RULES, ...folderRules('/tmp/ext/*', 'deny')]);
  });

  it('turns Windows backslashes into forward slashes and drops a trailing separator', () => {
    const rules = buildSessionPermissions([{ path: 'C:\\Users\\me\\Docs\\', accessLevel: 'read', source: 'user' }]);

    expect(rules.slice(2)).toEqual(folderRules('C:/Users/me/Docs/*', 'deny'));
  });

  it('emits folders in payload order, each after the general rules', () => {
    const rules = buildSessionPermissions([
      { path: '/tmp/one', accessLevel: 'read', source: 'user' },
      workspacePerm,
      { path: '/tmp/two', accessLevel: 'read-write', source: 'adhoc' },
    ]);

    expect(rules).toEqual([
      ...LEADING_RULES,
      { action: 'edit', resource: '*', effect: 'ask' },
      ...folderRules('/tmp/one/*', 'deny'),
      ...WORKSPACE_RULES.slice(1),
      ...folderRules('/tmp/two/*', 'allow'),
    ]);
  });
});

describe('buildSessionPermissions — no folders', () => {
  it('still starts with the external_directory ask rule so the sandbox does not open', () => {
    expect(buildSessionPermissions([])).toEqual(LEADING_RULES);
    expect(buildSessionPermissions()).toEqual(LEADING_RULES);
  });
});

describe('toV2McpConfig', () => {
  it('passes type, command, url, environment and headers through unchanged', () => {
    const config: McpConfig = {
      type: 'local',
      command: ['npx', '-y', 'server'],
      url: 'https://example.test/mcp',
      environment: { TOKEN: 'abc' },
      headers: { Authorization: 'Bearer x' },
    };

    expect(toV2McpConfig(config)).toEqual(config);
  });

  it('maps enabled: false to disabled: true and leaves enabled: true or absent alone', () => {
    expect(toV2McpConfig({ type: 'local', command: ['x'], enabled: false })).toEqual({ type: 'local', command: ['x'], disabled: true });
    expect(toV2McpConfig({ type: 'local', command: ['x'], enabled: true })).toEqual({ type: 'local', command: ['x'] });
    expect(toV2McpConfig({ type: 'local', command: ['x'] })).toEqual({ type: 'local', command: ['x'] });
  });

  it('maps a numeric timeout to {execution}', () => {
    expect(toV2McpConfig({ type: 'remote', url: 'https://x.test', timeout: 5000 })).toEqual({
      type: 'remote',
      url: 'https://x.test',
      timeout: { execution: 5000 },
    });
  });

  it('ignores a timeout that is not a number', () => {
    expect(toV2McpConfig({ type: 'remote', url: 'https://x.test', timeout: undefined })).toEqual({ type: 'remote', url: 'https://x.test' });
  });

  it('maps oauth credentials to snake_case and keeps oauth: false', () => {
    expect(
      toV2McpConfig({ type: 'remote', url: 'https://x.test', oauth: { clientId: 'id', clientSecret: 'sec', scope: 'read' } }).oauth
    ).toEqual({ client_id: 'id', client_secret: 'sec', scope: 'read' });
    expect(toV2McpConfig({ type: 'remote', url: 'https://x.test', oauth: { clientId: 'id', clientSecret: 'sec' } }).oauth).toEqual({
      client_id: 'id',
      client_secret: 'sec',
    });
    expect(toV2McpConfig({ type: 'remote', url: 'https://x.test', oauth: false }).oauth).toBe(false);
  });

  it('does not mutate its input', () => {
    const config: McpConfig = { type: 'local', command: ['x'], enabled: false, timeout: 10 };
    const copy = JSON.parse(JSON.stringify(config));

    toV2McpConfig(config);

    expect(config).toEqual(copy);
  });
});
