import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { springs } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { isWaitingForUser } from '@/lib/waiting-detection';
import type { PartialMessage, TaskMessage } from '@/shared';
import { type StartupStageInfo, useTaskStore } from '@/stores/taskStore';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';

/** Debounce utility */
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
}

type RenderableMessage = TaskMessage | PartialMessage;

interface MessageListProps {
  messages: TaskMessage[];
  isTaskRunning: boolean;
  isLoading: boolean;
  taskStatus: string | undefined;
  sessionId: string | undefined;
  hasPermissionRequest: boolean;
  currentTool: string | null;
  currentToolInput: unknown;
  startupStage: StartupStageInfo | null;
  startupStageTaskId: string | null;
  taskId: string | undefined;
  elapsedTime: number;
  isAtBottom: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onContinue: () => void;
}

export function MessageList({
  messages,
  isTaskRunning,
  isLoading,
  taskStatus,
  sessionId,
  hasPermissionRequest,
  currentTool,
  currentToolInput,
  startupStage,
  startupStageTaskId,
  taskId,
  elapsedTime,
  isAtBottom,
  scrollContainerRef,
  onScroll,
  onContinue,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribed here rather than received as a prop so streaming deltas only
  // re-render the message list, not the whole Execution page
  // (2026-06-12 review #12).
  const partialMessages = useTaskStore((state) => state.partialMessages);

  const scrollToBottom = useMemo(
    () =>
      debounce(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100),
    []
  );

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const messagesToRender = useMemo((): RenderableMessage[] => {
    const completed = messages || [];
    const partials = Array.from(partialMessages.values());
    const partialIds = new Set(partials.map((p) => p.id));
    const filteredCompleted = completed.filter((m) => !partialIds.has(m.id));
    const combined = [...filteredCompleted, ...partials];
    return combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, partialMessages]);

  // Hoisted out of the per-row map: filter once and locate the last
  // assistant message once per render instead of O(n) per row
  // (2026-06-12 review #35).
  const { filteredMessages, lastAssistantIndex } = useMemo(() => {
    const filtered = messagesToRender.filter(
      (m) => !(m.type === 'tool' && 'toolName' in m && (m as TaskMessage).toolName?.toLowerCase() === 'bash')
    );
    let lastIdx = -1;
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i].type === 'assistant') {
        lastIdx = i;
        break;
      }
    }
    return { filteredMessages: filtered, lastAssistantIndex: lastIdx };
  }, [messagesToRender]);

  // Follow the conversation while streaming, but only when the user is
  // already at the bottom.
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, partialMessages.size, isAtBottom]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6" data-testid="messages-scroll-container" onScroll={onScroll} ref={scrollContainerRef}>
      <div className="mx-auto max-w-4xl">
        {filteredMessages.map((message, index) => {
          const isLastMessage = index === filteredMessages.length - 1;
          const isPartial = 'isStreaming' in message && message.isStreaming;
          const isLastAssistantMessage = message.type === 'assistant' && isLastMessage;

          const isLastAssistantForContinue = index === lastAssistantIndex;

          const messageContent = isPartial ? (message as PartialMessage).textSoFar : (message as TaskMessage).content;

          const showContinue =
            isLastAssistantForContinue &&
            !!sessionId &&
            !isPartial &&
            (taskStatus === 'interrupted' || (taskStatus === 'completed' && isWaitingForUser(messageContent)));

          const shouldStream = isLastAssistantMessage && isTaskRunning && !isPartial;

          // Use tighter spacing (4px) between consecutive tool messages, normal (16px) otherwise
          const isTool = message.type === 'tool';
          const prevIsTool = index > 0 && filteredMessages[index - 1].type === 'tool';
          const gapClass = index === 0 ? '' : isTool && prevIsTool ? 'mt-1' : '';

          return (
            <div className={cn(gapClass)} key={message.id}>
              <MessageBubble
                continueLabel={taskStatus === 'interrupted' ? 'Continue' : 'Done, Continue'}
                isLastMessage={isLastMessage}
                isLoading={isLoading}
                isRealStreaming={isPartial}
                isRunning={isTaskRunning}
                message={
                  isPartial
                    ? {
                        ...message,
                        content: messageContent,
                        type: 'assistant' as const,
                      }
                    : (message as TaskMessage)
                }
                onContinue={onContinue}
                shouldStream={shouldStream}
                showContinueButton={showContinue}
              />
            </div>
          );
        })}

        <ThinkingIndicator
          currentTool={currentTool}
          currentToolInput={currentToolInput}
          elapsedTime={elapsedTime}
          isVisible={isTaskRunning && !hasPermissionRequest}
          startupStage={startupStage}
          startupStageTaskId={startupStageTaskId}
          taskId={taskId}
        />

        <div data-messages-end ref={messagesEndRef} />

        <AnimatePresence>
          {!isAtBottom && (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              className="pointer-events-none sticky bottom-4 flex justify-center"
              exit={{ opacity: 0, scale: 0.8 }}
              initial={{ opacity: 0, scale: 0.8 }}
              transition={springs.gentle}
            >
              <button
                aria-label="Scroll to bottom"
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted shadow-md transition-colors hover:bg-muted/80"
                data-testid="scroll-to-bottom-button"
                onClick={handleScrollToBottom}
              >
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
