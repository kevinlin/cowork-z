import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { McpServerRuntime, McpServerStatus } from '@/shared';

/**
 * Group flat tool IDs by MCP server name.
 *
 * OpenCode registers MCP tools with the server name as prefix:
 * e.g. server "context7" → tools "context7_resolve_library_id", "context7_query_docs".
 * We match against known server names (longest-first) to handle names with underscores.
 * Built-in tools (bash, read, etc.) don't match any server name and are skipped.
 */
export function groupToolsByServer(toolIds: string[], serverNames: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  // Sort server names longest-first so that more specific names match before shorter ones
  const sorted = [...serverNames].sort((a, b) => b.length - a.length);

  for (const toolId of toolIds) {
    for (const name of sorted) {
      if (toolId.startsWith(`${name}_`)) {
        const toolName = toolId.slice(name.length + 1);
        if (!result[name]) result[name] = [];
        result[name].push(toolName);
        break;
      }
    }
    // Tools that don't match any server name are built-in — skip them
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [api]);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getMcpStatus();
    api.getMcpTools();
    // Clear any pending timeout before setting a new one
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Timeout: if no event arrives in 5s (e.g. sidecar not running), clear loading
    timeoutRef.current = setTimeout(() => setLoading(false), 5000);
  }, [api]);

  // Memoize tool grouping to avoid re-sorting on every render
  const toolsByServer = useMemo(() => groupToolsByServer(allToolIds, serverNames), [allToolIds, serverNames]);

  // Build merged runtime records
  const serverRuntimes = useMemo(() => {
    const runtimes: Record<string, McpServerRuntime> = {};
    for (const name of serverNames) {
      const statusInfo = serverStatuses[name];
      runtimes[name] = {
        status: (statusInfo?.status as McpServerStatus) ?? 'unknown',
        error: statusInfo?.error,
        tools: toolsByServer[name] ?? [],
      };
    }
    return runtimes;
  }, [serverNames, serverStatuses, toolsByServer]);

  return { serverRuntimes, loading, refresh };
}
