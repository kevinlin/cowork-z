import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-emerald-500',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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
  const userCollapsedRef = useRef(false);
  const enabled = config.enabled !== false;
  const statusInfo = STATUS_CONFIG[runtime.status] ?? STATUS_CONFIG.unknown;
  const subtitle = getSubtitle(config);
  const hasTools = runtime.tools.length > 0;

  // Auto-expand when status transitions to connected with tools,
  // but respect user's manual collapse
  useEffect(() => {
    if (runtime.status === 'connected' && runtime.tools.length > 0 && !userCollapsedRef.current) {
      setToolsExpanded(true);
    }
  }, [runtime.status, runtime.tools.length]);

  const handleToggleTools = () => {
    const next = !toolsExpanded;
    setToolsExpanded(next);
    // Track manual collapse so auto-expand doesn't override
    userCollapsedRef.current = !next;
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4 transition-colors hover:border-border/80">
      <div className="flex items-start gap-3">
        {/* Letter avatar */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md font-medium text-sm text-white ${getAvatarColor(name)}`}
        >
          {name[0].toUpperCase()}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">{config.type}</span>
            {statusInfo.label && <span className="text-muted-foreground text-xs">{statusInfo.label}</span>}
          </div>

          {/* Subtitle with inline status dot */}
          {subtitle && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <div className={`h-2 w-2 flex-shrink-0 rounded-full ${statusInfo.dot}`} />
              <p className="truncate font-mono text-muted-foreground text-xs">{subtitle}</p>
            </div>
          )}

          {runtime.status === 'failed' && runtime.error && <p className="mt-1 text-destructive text-xs">{runtime.error}</p>}

          {runtime.status === 'unknown' && !hasTools && (
            <p className="mt-1 text-muted-foreground/60 text-xs">Start a task to see server status and tools</p>
          )}

          {/* Tools list — auto-expanded for connected servers */}
          {hasTools && (
            <div className="mt-2">
              {toolsExpanded && (
                <div className="flex flex-wrap gap-1">
                  {runtime.tools.map((tool) => (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs" key={tool}>
                      {tool}
                    </span>
                  ))}
                </div>
              )}
              <button
                className="mt-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
                onClick={handleToggleTools}
                type="button"
              >
                {toolsExpanded ? 'Show less' : `Show ${runtime.tools.length} tool${runtime.tools.length === 1 ? '' : 's'}`}
              </button>
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
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemove(name)}
            title="Remove server"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
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
