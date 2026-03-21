import { describe, expect, it } from 'vitest';
import { groupToolsByServer } from '../useMcpRuntime';

describe('groupToolsByServer', () => {
  it('groups tools by server name prefix', () => {
    const toolIds = ['mcp_filesystem_readFile', 'mcp_filesystem_writeFile', 'mcp_github_createPR'];
    const serverNames = ['filesystem', 'github'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({
      filesystem: ['readFile', 'writeFile'],
      github: ['createPR'],
    });
  });

  it('ignores non-MCP tool IDs', () => {
    const toolIds = ['builtin_bash', 'mcp_fs_read', 'core_edit'];
    const serverNames = ['fs'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ fs: ['read'] });
  });

  it('handles server names with underscores', () => {
    const toolIds = ['mcp_my_server_doThing', 'mcp_my_server_doOther'];
    const serverNames = ['my_server'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ my_server: ['doThing', 'doOther'] });
  });

  it('matches longest server name first (disambiguation)', () => {
    const toolIds = ['mcp_my_server_extra_action'];
    const serverNames = ['my', 'my_server', 'my_server_extra'];
    const result = groupToolsByServer(toolIds, serverNames);

    // Should match 'my_server_extra' since it's the longest matching prefix
    expect(result).toEqual({ my_server_extra: ['action'] });
  });

  it('falls back to first-underscore split for unknown servers', () => {
    const toolIds = ['mcp_unknown_tool'];
    const serverNames = ['filesystem']; // 'unknown' not in list
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ unknown: ['tool'] });
  });

  it('returns empty object for empty inputs', () => {
    expect(groupToolsByServer([], [])).toEqual({});
    expect(groupToolsByServer([], ['server'])).toEqual({});
  });

  it('returns empty object when no MCP tools', () => {
    const toolIds = ['builtin_bash', 'core_edit'];
    const serverNames = ['server'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({});
  });
});
