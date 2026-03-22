import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { PartialMessage, TaskMessage } from '@/shared';
import { useArenaStore } from '@/stores/arenaStore';

interface ArenaColumnProps {
  index: 0 | 1 | 2;
}

const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'running':
    case 'starting':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span className="text-primary">{status === 'starting' ? 'Starting' : 'Running'}</span>
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-green-600 text-xs">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    case 'cancelled':
    case 'interrupted':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">Stopped</span>
      );
    default:
      return null;
  }
};

const MessageItem = ({ message }: { message: TaskMessage }) => {
  const isUser = message.type === 'user';
  const isTool = message.type === 'tool';

  return (
    <div className={cn('px-3 py-2 text-sm', isUser && 'bg-muted/50', isTool && 'border-primary/30 border-l-2 bg-primary/5')}>
      <div className="mb-1 font-medium text-muted-foreground text-xs">
        {isUser ? 'You' : isTool ? (message.toolName ?? 'Tool') : 'Assistant'}
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground">{message.content}</div>
    </div>
  );
};

const PartialMessageItem = ({ partial }: { partial: PartialMessage }) => {
  return (
    <div className="px-3 py-2 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
        Assistant
        {partial.isStreaming && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground">
        {partial.textSoFar}
        {partial.isStreaming && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />}
      </div>
    </div>
  );
};

export const ArenaColumn = ({ index }: ArenaColumnProps) => {
  const column = useArenaStore((s) => s.columns[index]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const messages = column.task?.messages ?? [];
  const partials = Array.from(column.partialMessages.values());

  // Track scroll position
  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const threshold = 80;
    isAtBottomRef.current = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
  };

  // Auto-scroll to bottom when new messages arrive (if already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, partials.length]);

  // Idle state — no model selected
  if (column.status === 'idle' && !column.modelId) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-border border-b bg-card/30 px-3 py-2">
          <span className="text-muted-foreground text-sm">Column {index + 1}</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-muted-foreground text-sm">Select a model above to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between border-border border-b bg-card/30 px-3 py-2">
        <span className="truncate font-medium text-foreground text-sm">
          {column.modelDisplayName || column.modelId?.split('/').pop() || `Column ${index + 1}`}
        </span>
        <StatusBadge status={column.status} />
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto" onScroll={handleScroll} ref={scrollRef}>
        {messages.length === 0 && partials.length === 0 && column.status !== 'idle' && (
          <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
            {column.status === 'starting' || column.status === 'running' ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for response...
              </span>
            ) : (
              'No messages yet'
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

        {partials.map((partial) => (
          <PartialMessageItem key={partial.id} partial={partial} />
        ))}

        {/* Error display */}
        {column.error && <div className="mx-3 my-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">{column.error}</div>}
      </div>
    </div>
  );
};
