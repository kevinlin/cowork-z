import { useCallback, useRef, useState } from 'react';
import type { McpServerConfig } from '@/shared';

interface McpAddServerDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, config: McpServerConfig) => void;
  /** If set, pre-populate the form for editing */
  editName?: string;
  editConfig?: McpServerConfig;
}

export function McpAddServerDialog({ open, onClose, onSave, editName, editConfig }: McpAddServerDialogProps) {
  const isEdit = Boolean(editName);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [name, setName] = useState(editName ?? '');
  const [type, setType] = useState<'local' | 'remote'>(editConfig?.type ?? 'local');
  const [command, setCommand] = useState(editConfig?.command?.join(' ') ?? '');
  const [url, setUrl] = useState(editConfig?.url ?? '');
  const [error, setError] = useState<string | null>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = useCallback(() => {
    setError(null);

    if (mode === 'json') {
      const text = jsonRef.current?.value ?? '';
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setError('JSON must be an object with server name as key');
          return;
        }
        const entries = Object.entries(parsed);
        if (entries.length !== 1) {
          setError('JSON must contain exactly one server');
          return;
        }
        const [serverName, serverConfig] = entries[0] as [string, McpServerConfig];
        onSave(serverName, serverConfig);
        onClose();
      } catch {
        setError('Invalid JSON');
      }
      return;
    }

    // Form mode validation
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Server name is required');
      return;
    }

    if (type === 'local') {
      const parts = command.trim().split(/\s+/);
      if (parts.length === 0 || !parts[0]) {
        setError('Command is required for local servers');
        return;
      }
      onSave(trimmedName, { type: 'local', command: parts, enabled: true });
    } else {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError('URL is required for remote servers');
        return;
      }
      onSave(trimmedName, { type: 'remote', url: trimmedUrl, enabled: true });
    }

    onClose();
  }, [mode, name, type, command, url, onSave, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div aria-modal="true" className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl" role="dialog">
        <h3 className="mb-4 font-semibold text-base text-foreground">{isEdit ? 'Edit MCP Server' : 'Add MCP Server'}</h3>

        {/* Mode toggle */}
        <div className="mb-4 flex gap-2">
          <button
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              mode === 'form' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setMode('form')}
            type="button"
          >
            Form
          </button>
          <button
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              mode === 'json' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setMode('json')}
            type="button"
          >
            JSON
          </button>
        </div>

        {mode === 'form' ? (
          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">Server Name</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={isEdit}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-mcp-server"
                value={name}
              />
            </div>

            {/* Type */}
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">Type</label>
              <div className="flex gap-2">
                <button
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    type === 'local' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setType('local')}
                  type="button"
                >
                  Local
                </button>
                <button
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    type === 'remote' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                  onClick={() => setType('remote')}
                  type="button"
                >
                  Remote
                </button>
              </div>
            </div>

            {/* Command or URL */}
            {type === 'local' ? (
              <div>
                <label className="mb-1 block text-muted-foreground text-xs">Command</label>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
                  value={command}
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-muted-foreground text-xs">URL</label>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp-server.example.com"
                  value={url}
                />
              </div>
            )}
          </div>
        ) : (
          <div>
            <textarea
              className="w-full rounded-md border border-border bg-background p-3 font-mono text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              defaultValue={
                editName && editConfig
                  ? JSON.stringify({ [editName]: editConfig }, null, 2)
                  : `{\n  "server-name": {\n    "type": "local",\n    "command": ["npx", "-y", "package-name"]\n  }\n}`
              }
              ref={jsonRef}
              rows={8}
              spellCheck={false}
            />
          </div>
        )}

        {error && <p className="mt-2 text-destructive text-xs">{error}</p>}

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md bg-muted px-4 py-1.5 text-foreground text-sm transition-colors hover:bg-muted/80"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-primary px-4 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            onClick={handleSave}
            type="button"
          >
            {isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
