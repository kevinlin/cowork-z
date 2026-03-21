import { useState } from 'react';
import type { McpServerConfig, McpServerRuntime, McpServerStatus } from '@/shared';

interface McpServerCardProps {
  name: string;
  config: McpServerConfig;
  runtime: McpServerRuntime;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (name: string) => void;
  onRemove: (name: string) => void;
}

const STATUS_CONFIG: Record<McpServerStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-green-500', label: 'Connected' },
  disabled: { dot: 'bg-muted-foreground/50', label: 'Disabled' },
  failed: { dot: 'bg-destructive', label: 'Failed' },
  needs_auth: { dot: 'bg-amber-500', label: 'Needs Auth' },
  needs_client_registration: { dot: 'bg-amber-500', label: 'Needs Registration' },
  initializing: { dot: 'bg-blue-500 animate-pulse', label: 'Initializing' },
  unknown: { dot: 'bg-muted-foreground/30', label: '' },
};

function getSubtitle(config: McpServerConfig): string {
  if (config.type === 'local' && config.command) {
    return config.command.join(' ');
  }
  if (config.type === 'remote' && config.url) {
    return config.url;
  }
  return '';
}

export function McpServerCard({ name, config, runtime, onToggle, onEdit, onRemove }: McpServerCardProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const enabled = config.enabled !== false;
  const statusInfo = STATUS_CONFIG[runtime.status] ?? STATUS_CONFIG.unknown;
  const subtitle = getSubtitle(config);
  const hasTools = runtime.tools.length > 0;

  return (
    <div className="rounded-lg border border-border bg-background p-4 transition-colors hover:border-border/80">
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="mt-1.5 flex-shrink-0">
          <div className={`h-2.5 w-2.5 rounded-full ${statusInfo.dot}`} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">{config.type}</span>
            {statusInfo.label && runtime.status !== 'unknown' && <span className="text-muted-foreground text-xs">{statusInfo.label}</span>}
          </div>

          {subtitle && <p className="mt-0.5 truncate font-mono text-muted-foreground text-xs">{subtitle}</p>}

          {runtime.status === 'failed' && runtime.error && <p className="mt-1 text-destructive text-xs">{runtime.error}</p>}

          {/* Tools list */}
          {hasTools && (
            <div className="mt-2">
              <button
                className="text-muted-foreground text-xs transition-colors hover:text-foreground"
                onClick={() => setToolsExpanded(!toolsExpanded)}
                type="button"
              >
                {toolsExpanded ? 'Hide' : 'Show'} {runtime.tools.length} tool{runtime.tools.length === 1 ? '' : 's'}
              </button>
              {toolsExpanded && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {runtime.tools.map((tool) => (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs" key={tool}>
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => onEdit(name)}
            title="Edit server"
            type="button"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(name)}
            title="Remove server"
            type="button"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          {/* Enable/disable toggle */}
          <button
            className={`relative ml-1 inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
              enabled ? 'bg-primary' : 'bg-muted'
            }`}
            onClick={() => onToggle(name, !enabled)}
            type="button"
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
