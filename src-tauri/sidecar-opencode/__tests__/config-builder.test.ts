import { describe, expect, it } from '@jest/globals';
import { buildSessionConfig } from '../src/config-builder';
import type { FolderPermission, PermissionAction, PermissionConfig } from '../src/types';

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('buildSessionConfig — workspace convention folders', () => {
  const sep = process.platform === 'win32' ? '\\' : '/';
  const WS_PATH = process.platform === 'win32' ? 'C:\\tmp\\my-ws' : '/tmp/my-ws';
  const workspacePerm: FolderPermission = {
    path: WS_PATH,
    accessLevel: 'read-write',
    source: 'workspace',
  };

  function getRules(): {
    editRules: Record<string, PermissionAction>;
    readRules: Record<string, PermissionAction>;
    permission: PermissionConfig;
  } {
    const cfg = buildSessionConfig({ folderPermissions: [workspacePerm] });
    const permission = cfg.permission as PermissionConfig;
    expect(permission).toBeDefined();
    return {
      editRules: permission.edit as Record<string, PermissionAction>,
      readRules: permission.read as Record<string, PermissionAction>,
      permission,
    };
  }

  it('denies edits on Input/ and Input/*', () => {
    const { editRules } = getRules();
    expect(editRules[`${WS_PATH}${sep}Input`]).toBe('deny');
    expect(editRules[`${WS_PATH}${sep}Input${sep}*`]).toBe('deny');
  });

  it('allows edits on Output/ and Output/*', () => {
    const { editRules } = getRules();
    expect(editRules[`${WS_PATH}${sep}Output`]).toBe('allow');
    expect(editRules[`${WS_PATH}${sep}Output${sep}*`]).toBe('allow');
  });

  it('denies edits on Misc/ and Misc/* (read-only static assets)', () => {
    const { editRules } = getRules();
    expect(editRules[`${WS_PATH}${sep}Misc`]).toBe('deny');
    expect(editRules[`${WS_PATH}${sep}Misc${sep}*`]).toBe('deny');
  });

  it('prompts (ask) before edits on Artefacts/ and Artefacts/* (curated deliverables)', () => {
    const { editRules } = getRules();
    expect(editRules[`${WS_PATH}${sep}Artefacts`]).toBe('ask');
    expect(editRules[`${WS_PATH}${sep}Artefacts${sep}*`]).toBe('ask');
  });

  it('allows edits at the workspace root (general rule, overridden by specific folder rules)', () => {
    const { editRules } = getRules();
    expect(editRules[WS_PATH]).toBe('allow');
  });

  it('allows reads on the workspace root (covers all four convention folders)', () => {
    const { readRules } = getRules();
    expect(readRules[WS_PATH]).toBe('allow');
  });

  it('includes external_directory allow for the workspace path', () => {
    const { permission } = getRules();
    const extDir = permission.external_directory as Record<string, PermissionAction>;
    expect(extDir[WS_PATH]).toBe('allow');
  });
});
