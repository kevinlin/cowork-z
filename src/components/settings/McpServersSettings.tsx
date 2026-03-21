import { useCallback, useEffect, useState } from 'react';
import { useMcpRuntime } from '@/hooks/useMcpRuntime';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { McpServerConfig, McpServersConfig } from '@/shared';
import { McpAddServerDialog } from './McpAddServerDialog';
import { McpJsonFallback } from './McpJsonFallback';
import { McpServerCard } from './McpServerCard';

interface McpServersSettingsProps {
  onLoad?: () => void;
}

export function McpServersSettings({ onLoad }: McpServersSettingsProps) {
  const [config, setConfig] = useState<McpServersConfig>({});
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ name: string; config: McpServerConfig } | null>(null);
  const [configChanged, setConfigChanged] = useState(false);
  const api = getTauriAPI();

  const serverNames = Object.keys(config);
  const { serverRuntimes, loading, refresh } = useMcpRuntime(serverNames);
  const hasServers = serverNames.length > 0;

  // Load persisted config on mount
  useEffect(() => {
    api.getMcpServersConfig().then((cfg) => {
      if (cfg && Object.keys(cfg).length > 0) {
        setConfig(cfg);
      }
      onLoad?.();
    });
    // Fetch runtime status if sidecar is running
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist config to backend
  const handleConfigChange = useCallback(
    async (newConfig: McpServersConfig) => {
      setConfig(newConfig);
      setConfigChanged(true);
      const configOrNull = Object.keys(newConfig).length > 0 ? newConfig : null;
      await api.setMcpServersConfig(configOrNull);
      // Refresh status after a short delay to let the sidecar process the change
      setTimeout(refresh, 1000);
    },
    [api, refresh]
  );

  // Per-server toggle
  const handleToggle = useCallback(
    (name: string, enabled: boolean) => {
      const updated = { ...config, [name]: { ...config[name], enabled } };
      handleConfigChange(updated);
    },
    [config, handleConfigChange]
  );

  // Remove server
  const handleRemove = useCallback(
    (name: string) => {
      const { [name]: _, ...rest } = config;
      handleConfigChange(rest);
    },
    [config, handleConfigChange]
  );

  // Edit server
  const handleEdit = useCallback(
    (name: string) => {
      setEditTarget({ name, config: config[name] });
      setDialogOpen(true);
    },
    [config]
  );

  // Add or update server from dialog
  const handleDialogSave = useCallback(
    (name: string, serverConfig: McpServerConfig) => {
      // If editing and the name changed, remove old entry
      if (editTarget && editTarget.name !== name) {
        const { [editTarget.name]: _, ...rest } = config;
        handleConfigChange({ ...rest, [name]: serverConfig });
      } else {
        handleConfigChange({ ...config, [name]: serverConfig });
      }
      setEditTarget(null);
    },
    [config, editTarget, handleConfigChange]
  );

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
    setEditTarget(null);
  }, []);

  // JSON fallback change handler
  const handleJsonChange = useCallback(
    (newConfig: McpServersConfig) => {
      handleConfigChange(newConfig);
    },
    [handleConfigChange]
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium text-foreground">MCP Servers</div>
          <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
            Configure{' '}
            <a
              className="text-primary hover:underline"
              href="https://opencode.ai/docs/mcp-servers/"
              rel="noopener noreferrer"
              target="_blank"
            >
              MCP servers
            </a>{' '}
            to extend the agent with additional tools.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground text-xs transition-colors hover:bg-primary/90"
          data-testid="settings-mcp-add"
          onClick={() => {
            setEditTarget(null);
            setDialogOpen(true);
          }}
          type="button"
        >
          Add Server
        </button>

        {hasServers && (
          <>
            <button
              className="rounded-md bg-muted px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
              disabled={loading}
              onClick={refresh}
              title="Refresh status"
              type="button"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <div className="ml-auto flex gap-1">
              <button
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'cards' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setViewMode('cards')}
                type="button"
              >
                Cards
              </button>
              <button
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'json' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setViewMode('json')}
                type="button"
              >
                JSON
              </button>
            </div>
          </>
        )}
      </div>

      {/* Change notification */}
      {configChanged && hasServers && (
        <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
          MCP config saved. Changes take effect on your next task.
        </div>
      )}

      {/* Content */}
      {hasServers && (
        <div className="mt-3">
          {viewMode === 'cards' ? (
            <div className="space-y-2">
              {serverNames.map((name) => (
                <McpServerCard
                  config={config[name]}
                  key={name}
                  name={name}
                  onEdit={handleEdit}
                  onRemove={handleRemove}
                  onToggle={handleToggle}
                  runtime={serverRuntimes[name] ?? { status: 'unknown', tools: [] }}
                />
              ))}
            </div>
          ) : (
            <McpJsonFallback config={config} onChange={handleJsonChange} />
          )}
        </div>
      )}

      {/* Empty state */}
      {!hasServers && (
        <div className="mt-3 rounded-md border border-border border-dashed p-6 text-center text-muted-foreground text-sm">
          No MCP servers configured. Click "Add Server" to get started.
        </div>
      )}

      {/* Add/Edit Dialog */}
      <McpAddServerDialog
        editConfig={editTarget?.config}
        editName={editTarget?.name}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
        open={dialogOpen}
      />
    </div>
  );
}
