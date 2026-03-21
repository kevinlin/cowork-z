import { useCallback, useEffect, useRef, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { McpServerRuntime, McpServerStatus } from '@/shared';

/**
 * Group flat tool IDs by MCP server name.
 *
 * OpenCode tool IDs follow the convention `mcp_{serverName}_{toolName}`.
 * We use the known server names as anchors to correctly split the prefix
 * (handles server names that contain underscores).
 */
export function groupToolsByServer(toolIds: string[], serverNames: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  // Sort server names longest-first so that more specific names match before shorter ones
  const sorted = [...serverNames].sort((a, b) => b.length - a.length);

  for (const toolId of toolIds) {
    if (!toolId.startsWith('mcp_')) continue;

    const rest = toolId.slice(4); // strip "mcp_"
    let matched = false;

    for (const name of sorted) {
      if (rest.startsWith(`${name}_`)) {
        const toolName = rest.slice(name.length + 1);
        if (!result[name]) result[name] = [];
        result[name].push(toolName);
        matched = true;
        break;
      }
    }

    // Fallback: if no server name matched, try splitting on first underscore
    if (!matched) {
      const idx = rest.indexOf('_');
      if (idx > 0) {
        const serverName = rest.slice(0, idx);
        const toolName = rest.slice(idx + 1);
        if (!result[serverName]) result[serverName] = [];
        result[serverName].push(toolName);
      }
    }
  }

  return result;
}

export interface UseMcpRuntimeResult {
  /** Runtime status per server name */
  serverRuntimes: Record<string, McpServerRuntime>;
  /** Whether a refresh is in progress */
  loading: boolean;
  /** Manually refresh status and tools */
  refresh: () => void;
}

/**
 * Hook that manages MCP server runtime status and tool discovery.
 *
 * Subscribes to Tauri events for real-time MCP status/tool updates.
 * Call `refresh()` to poll the OpenCode server for current state.
 */
export function useMcpRuntime(serverNames: string[]): UseMcpRuntimeResult {
  const [serverStatuses, setServerStatuses] = useState<Record<string, { status: string; error?: string }>>({});
  const [allToolIds, setAllToolIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const serverNamesRef = useRef(serverNames);
  serverNamesRef.current = serverNames;

  const api = getTauriAPI();

  // Subscribe to events
  useEffect(() => {
    const unlistenStatus = api.onMcpStatus((data) => {
      setServerStatuses(data.servers);
      setLoading(false);
    });

    const unlistenTools = api.onMcpTools((data) => {
      setAllToolIds(data.toolIds);
    });

    const unlistenChanged = api.onMcpToolsChanged(() => {
      // Re-fetch when tools change
      api.getMcpStatus();
      api.getMcpTools();
    });

    return () => {
      unlistenStatus();
      unlistenTools();
      unlistenChanged();
    };
  }, [api]);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getMcpStatus();
    api.getMcpTools();
  }, [api]);

  // Build merged runtime records
  const toolsByServer = groupToolsByServer(allToolIds, serverNamesRef.current);
  const serverRuntimes: Record<string, McpServerRuntime> = {};

  for (const name of serverNamesRef.current) {
    const statusInfo = serverStatuses[name];
    serverRuntimes[name] = {
      status: (statusInfo?.status as McpServerStatus) ?? 'unknown',
      error: statusInfo?.error,
      tools: toolsByServer[name] ?? [],
    };
  }

  return { serverRuntimes, loading, refresh };
}
