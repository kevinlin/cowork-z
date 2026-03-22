import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { cn } from '@/lib/utils';
import type { TaskMessage } from '@/shared';
import { useArenaStore } from '@/stores/arenaStore';

const EMPTY_MESSAGES: TaskMessage[] = [];

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

export const ArenaColumn = ({ index }: ArenaColumnProps) => {
  const column = useArenaStore((s) => s.columns[index]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const messages = column.task?.messages ?? EMPTY_MESSAGES;
  const partials = Array.from(column.partialMessages.values());

  const filteredMessages = useMemo(() => messages.filter((m) => !(m.type === 'tool' && m.toolName?.toLowerCase() === 'bash')), [messages]);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const threshold = 80;
    isAtBottomRef.current = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
  };

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages.length, partials.length]);

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

  const isColumnRunning = column.status === 'running' || column.status === 'starting';

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-border border-b bg-card/30 px-3 py-2">
        <span className="truncate font-medium text-foreground text-sm">
          {column.modelDisplayName || column.modelId?.split('/').pop() || `Column ${index + 1}`}
        </span>
        <StatusBadge status={column.status} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" onScroll={handleScroll} ref={scrollRef}>
        {filteredMessages.length === 0 && partials.length === 0 && column.status !== 'idle' && (
          <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
            {isColumnRunning ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for response...
              </span>
            ) : (
              'No messages yet'
            )}
          </div>
        )}

        <div>
          {filteredMessages.map((msg, i) => {
            const isTool = msg.type === 'tool';
            const prevIsTool = i > 0 && filteredMessages[i - 1].type === 'tool';
            const gapClass = i === 0 ? '' : isTool && prevIsTool ? 'mt-1' : 'mt-4';

            return (
              <div className={cn(gapClass)} key={msg.id}>
                <MessageBubble
                  isLastMessage={i === filteredMessages.length - 1 && partials.length === 0}
                  isRunning={isColumnRunning}
                  message={msg}
                />
              </div>
            );
          })}

          {partials.map((partial) => {
            const syntheticMessage: TaskMessage = {
              id: partial.id,
              type: 'assistant',
              content: partial.textSoFar,
              timestamp: partial.timestamp,
            };
            return <MessageBubble isRealStreaming={partial.isStreaming} key={partial.id} message={syntheticMessage} />;
          })}

          {column.error && <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">{column.error}</div>}
        </div>
      </div>
    </div>
  );
};
