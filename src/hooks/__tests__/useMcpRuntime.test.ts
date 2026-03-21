import { describe, expect, it } from 'vitest';
import { groupToolsByServer } from '../useMcpRuntime';

describe('groupToolsByServer', () => {
  it('groups tools by server name prefix', () => {
    const toolIds = ['filesystem_readFile', 'filesystem_writeFile', 'github_createPR'];
    const serverNames = ['filesystem', 'github'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({
      filesystem: ['readFile', 'writeFile'],
      github: ['createPR'],
    });
  });

  it('skips built-in tools that do not match any server name', () => {
    const toolIds = ['bash', 'read', 'write', 'context7_query_docs'];
    const serverNames = ['context7'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ context7: ['query_docs'] });
  });

  it('handles server names with underscores', () => {
    const toolIds = ['my_server_doThing', 'my_server_doOther'];
    const serverNames = ['my_server'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ my_server: ['doThing', 'doOther'] });
  });

  it('matches longest server name first (disambiguation)', () => {
    const toolIds = ['my_server_extra_action'];
    const serverNames = ['my', 'my_server', 'my_server_extra'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({ my_server_extra: ['action'] });
  });

  it('skips tools that match no known server name', () => {
    const toolIds = ['unknown_tool'];
    const serverNames = ['filesystem'];
    const result = groupToolsByServer(toolIds, serverNames);

    // 'unknown' is not a known server, so it's treated as a built-in tool
    expect(result).toEqual({});
  });

  it('returns empty object for empty inputs', () => {
    expect(groupToolsByServer([], [])).toEqual({});
    expect(groupToolsByServer([], ['server'])).toEqual({});
  });

  it('skips all tools when none match server names', () => {
    const toolIds = ['bash', 'read', 'edit', 'write'];
    const serverNames = ['context7'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({});
  });

  it('handles real-world MCP tool names', () => {
    const toolIds = [
      'context7_resolve_library_id',
      'context7_query_docs',
      'playwright_browser_click',
      'playwright_browser_navigate',
      'bash',
      'read',
      'edit',
    ];
    const serverNames = ['context7', 'playwright'];
    const result = groupToolsByServer(toolIds, serverNames);

    expect(result).toEqual({
      context7: ['resolve_library_id', 'query_docs'],
      playwright: ['browser_click', 'browser_navigate'],
    });
  });
});
