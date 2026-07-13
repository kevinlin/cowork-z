import { BookOpen, Brain, Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, Search, Terminal, Wrench } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { TaskMessage } from '@/shared';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import loadingSymbol from '/assets/loading-symbol.svg';

const COPIED_STATE_DURATION_MS = 1000;

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'patch', 'multiedit']);

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
  skill: { label: 'Using skill', icon: BookOpen },
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
    case 'skill':
      return typeof input.name === 'string' ? (input.name as string) : '';
    default: {
      const firstKey = Object.keys(input)[0];
      if (firstKey && typeof input[firstKey] === 'string') {
        return (input[firstKey] as string).slice(0, 80);
      }
      return '';
    }
  }
}

function getFilePath(toolName: string | undefined, toolInput: unknown): string | null {
  if (!(toolName && FILE_TOOLS.has(toolName))) return null;
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.file_path === 'string') return input.file_path;
  return null;
}

interface ToolCallCardProps {
  message: TaskMessage;
  isLastMessage?: boolean;
  isRunning?: boolean;
}

export const ToolCallCard = memo(function ToolCallCard({ message, isLastMessage = false, isRunning = false }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toolName = message.toolName || message.content?.match(/Using tool: (\w+)/)?.[1] || '';
  const toolInfo = TOOL_PROGRESS_MAP[toolName];
  const ToolIcon = toolInfo?.icon || Wrench;
  const label = toolInfo?.label || toolName || 'Processing';
  const summary = getToolInputSummary(toolName, message.toolInput);
  const isActive = isLastMessage && isRunning;
  const hasExpandableContent = message.toolInput !== undefined || message.toolOutput !== undefined;
  const filePath = getFilePath(toolName, message.toolInput);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const parts: string[] = [];
      if (message.toolInput !== undefined) {
        parts.push(typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput, null, 2));
      }
      if (message.toolOutput) {
        parts.push(message.toolOutput);
      }
      try {
        await navigator.clipboard.writeText(parts.join('\n\n'));
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), COPIED_STATE_DURATION_MS);
      } catch {
        // clipboard write failed
      }
    },
    [message.toolInput, message.toolOutput]
  );

  const handleOpenFile = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (filePath) {
        useFilePreviewStore.getState().openPreviewByPath(filePath);
      }
    },
    [filePath]
  );

  const handleToggle = useCallback(() => {
    if (hasExpandableContent) setIsExpanded((prev) => !prev);
  }, [hasExpandableContent]);

  return (
    <div
      className={cn('group/tool w-full min-w-0 rounded-md transition-colors', isExpanded ? 'bg-muted/60' : 'bg-muted/30 hover:bg-muted/50')}
    >
      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-sm">
        <button
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-left', hasExpandableContent ? 'cursor-pointer' : 'cursor-default')}
          disabled={!hasExpandableContent}
          onClick={handleToggle}
          type="button"
        >
          {hasExpandableContent ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}

          <ToolIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

          <span className="shrink-0 font-medium text-muted-foreground text-xs">{label}</span>

          {summary && <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">{summary}</span>}
        </button>

        <span className="flex shrink-0 items-center gap-0.5">
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tool:opacity-100">
            {filePath && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Open in file viewer"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={handleOpenFile}
                    type="button"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Open in file viewer</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={copied ? 'Copied' : 'Copy'}
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
                    copied && 'text-success'
                  )}
                  onClick={handleCopy}
                  type="button"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{copied ? 'Copied' : 'Copy'}</TooltipContent>
            </Tooltip>
          </span>
          <span className="ml-0.5">
            {isActive ? <SpinningIcon className="h-3 w-3" /> : <Check className="h-3 w-3 text-muted-foreground/40" />}
          </span>
        </span>
      </div>

      {isExpanded && (
        <div className="min-w-0 overflow-hidden px-2.5 py-1.5 text-xs">
          {message.toolInput !== undefined && (
            <div className="mb-1.5">
              <p className="mb-0.5 font-medium text-[11px] text-muted-foreground">Input</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/80 p-2 font-mono text-[11px] text-foreground leading-relaxed">
                {typeof message.toolInput === 'string' ? message.toolInput : JSON.stringify(message.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {message.toolOutput && (
            <div>
              <p className="mb-0.5 font-medium text-[11px] text-muted-foreground">Output</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/80 p-2 font-mono text-[11px] text-foreground leading-relaxed">
                {message.toolOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
