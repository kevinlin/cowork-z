import { Brain, Check, ChevronDown, ChevronRight, FileText, Search, Terminal, Wrench } from 'lucide-react';
import { memo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { TaskMessage } from '@/shared';
import loadingSymbol from '/assets/loading-symbol.svg';

const SpinningIcon = ({ className }: { className?: string }) => (
  <img alt="" className={cn('animate-spin-ccw', className)} src={loadingSymbol} />
);

/** Tool name to human-readable label and icon */
export const TOOL_PROGRESS_MAP: Record<string, { label: string; icon: typeof FileText }> = {
  Read: { label: 'Reading files', icon: FileText },
  Glob: { label: 'Finding files', icon: Search },
  Grep: { label: 'Searching code', icon: Search },
  Bash: { label: 'Running command', icon: Terminal },
  Write: { label: 'Writing file', icon: FileText },
  Edit: { label: 'Editing file', icon: FileText },
  Task: { label: 'Running agent', icon: Brain },
  WebFetch: { label: 'Fetching web page', icon: Search },
  WebSearch: { label: 'Searching web', icon: Search },
  dev_browser_execute: { label: 'Executing browser action', icon: Terminal },
};

/** Extract a short one-line summary of tool input for the collapsed view */
function getToolInputSummary(toolName: string | undefined, toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const input = toolInput as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'patch':
    case 'multiedit':
      return typeof input.path === 'string' ? input.path : typeof input.file_path === 'string' ? (input.file_path as string) : '';
    case 'Bash':
      return typeof input.command === 'string' ? (input.command as string).slice(0, 80) : '';
    case 'Grep':
      return typeof input.pattern === 'string' ? (input.pattern as string) : '';
    case 'Glob':
      return typeof input.glob_pattern === 'string'
        ? (input.glob_pattern as string)
        : typeof input.pattern === 'string'
          ? (input.pattern as string)
          : '';
    case 'WebFetch':
      return typeof input.url === 'string' ? (input.url as string) : '';
    case 'WebSearch':
      return typeof input.search_term === 'string'
        ? (input.search_term as string)
        : typeof input.query === 'string'
          ? (input.query as string)
          : '';
    case 'Task':
      return typeof input.description === 'string' ? (input.description as string) : '';
    default: {
      const firstKey = Object.keys(input)[0];
      if (firstKey && typeof input[firstKey] === 'string') {
        return (input[firstKey] as string).slice(0, 80);
      }
      return '';
    }
  }
}

interface ToolCallCardProps {
  message: TaskMessage;
  isLastMessage?: boolean;
  isRunning?: boolean;
}

export const ToolCallCard = memo(function ToolCallCard({ message, isLastMessage = false, isRunning = false }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = message.toolName || message.content?.match(/Using tool: (\w+)/)?.[1] || '';
  const toolInfo = TOOL_PROGRESS_MAP[toolName];
  const ToolIcon = toolInfo?.icon || Wrench;
  const label = toolInfo?.label || toolName || 'Processing';
  const summary = getToolInputSummary(toolName, message.toolInput);
  const isActive = isLastMessage && isRunning;
  const hasExpandableContent = message.toolInput !== undefined || message.toolOutput !== undefined;

  return (
    <div className={cn('min-w-0 w-full rounded-lg border border-border bg-muted/50 transition-colors', isExpanded && 'bg-muted/80')}>
      <button
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
          hasExpandableContent && 'cursor-pointer hover:bg-muted/70'
        )}
        disabled={!hasExpandableContent}
        onClick={() => hasExpandableContent && setIsExpanded(!isExpanded)}
        type="button"
      >
        {hasExpandableContent ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5" />
        )}

        <ToolIcon className="h-4 w-4 shrink-0 text-muted-foreground" />

        <span className="font-medium text-muted-foreground">{label}</span>

        {summary && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/70 text-xs">{summary}</span>}

        <span className="ml-auto shrink-0">
          {isActive ? <SpinningIcon className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-muted-foreground/50" />}
        </span>
      </button>

      {isExpanded && (
        <div className="border-border border-t px-3 py-2 text-xs">
          {message.toolInput !== undefined && (
            <div className="mb-2">
              <p className="mb-1 font-medium text-muted-foreground">Input</p>
              <pre className="max-h-48 overflow-auto rounded bg-background p-2 font-mono text-foreground">
                {typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {message.toolOutput && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Output</p>
              <pre className="max-h-48 overflow-auto rounded bg-background p-2 font-mono text-foreground">{message.toolOutput}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
