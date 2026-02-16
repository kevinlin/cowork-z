import { motion } from 'framer-motion';
import { Check, Copy, Play, Terminal } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createMarkdownComponents } from '@/components/markdown/EnhancedLink';
import { MediaGallery } from '@/components/media/MediaGallery';
import { Button } from '@/components/ui/button';
import { StreamingText } from '@/components/ui/streaming-text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { springs } from '@/lib/animations';
import { enrichContentWithLinks, extractMediaPaths } from '@/lib/content-enrichment';
import { extractUserFacingContent } from '@/lib/message-utils';
import { cn } from '@/lib/utils';
import type { TaskMessage } from '@/shared';
import { ToolCallCard } from './ToolCallCard';

const COPIED_STATE_DURATION_MS = 1000;

export interface MessageBubbleProps {
  message: TaskMessage;
  shouldStream?: boolean;
  isLastMessage?: boolean;
  isRunning?: boolean;
  showContinueButton?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  isLoading?: boolean;
  /** If true, text is being streamed in real-time (no animation needed) */
  isRealStreaming?: boolean;
}

export const MessageBubble = memo(
  function MessageBubble({
    message,
    shouldStream = false,
    isLastMessage = false,
    isRunning = false,
    showContinueButton = false,
    continueLabel,
    onContinue,
    isLoading = false,
    isRealStreaming = false,
  }: MessageBubbleProps) {
    const [streamComplete, setStreamComplete] = useState(!shouldStream);
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isUser = message.type === 'user';
    const isTool = message.type === 'tool';
    const isSystem = message.type === 'system';
    const isAssistant = message.type === 'assistant';

    const displayContent = useMemo(() => {
      if (isAssistant) {
        return extractUserFacingContent(message.content);
      }
      return message.content;
    }, [isAssistant, message.content]);

    const markdownComponents = useMemo(() => createMarkdownComponents(), []);

    const enrichedContent = useMemo(() => {
      return enrichContentWithLinks(displayContent);
    }, [displayContent]);

    const mediaPaths = useMemo(() => {
      return extractMediaPaths(displayContent);
    }, [displayContent]);

    useEffect(() => {
      if (!shouldStream) {
        setStreamComplete(true);
      }
    }, [shouldStream]);

    useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }, []);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(displayContent);
        setCopied(true);

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, COPIED_STATE_DURATION_MS);
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
      }
    }, [displayContent]);

    const showCopyButton = !(isTool || (isAssistant && showContinueButton));

    const proseClasses = cn(
      'prose prose-sm max-w-none text-sm',
      'prose-headings:text-foreground',
      'prose-p:my-2 prose-p:text-foreground',
      'prose-strong:font-semibold prose-strong:text-foreground',
      'prose-em:text-foreground',
      'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-foreground prose-code:text-xs',
      'prose-pre:rounded-lg prose-pre:bg-muted prose-pre:p-3 prose-pre:text-foreground',
      'prose-ol:text-foreground prose-ul:text-foreground',
      'prose-li:my-1 prose-li:text-foreground',
      'prose-a:text-primary prose-a:underline',
      'prose-blockquote:border-border prose-blockquote:border-l-4 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground',
      'prose-hr:border-border',
      'prose-table:my-4 prose-table:w-full prose-table:border-collapse',
      'prose-thead:border-border prose-thead:border-b',
      'prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground',
      'prose-td:border-border prose-td:border-t prose-td:px-3 prose-td:py-2 prose-td:text-foreground',
      'prose-tr:border-border prose-tr:border-b',
      'break-words'
    );

    // Tool messages render as a ToolCallCard
    if (isTool) {
      return (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="group flex min-w-0 w-full flex-col items-start"
          initial={{ opacity: 0, y: 8 }}
          transition={springs.gentle}
        >
          <ToolCallCard isLastMessage={isLastMessage} isRunning={isRunning} message={message} />
        </motion.div>
      );
    }

    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={cn('group flex flex-col', isUser ? 'items-end' : 'items-start')}
        initial={{ opacity: 0, y: 8 }}
        transition={springs.gentle}
      >
        <div
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3 transition-all duration-150',
            isUser ? 'bg-primary text-primary-foreground' : isSystem ? 'border border-border bg-muted/50' : 'border border-border bg-card'
          )}
        >
          {isSystem && (
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
              <Terminal className="h-3.5 w-3.5" />
              System
            </div>
          )}
          {isUser ? (
            <p className={cn('whitespace-pre-wrap break-words text-sm', 'text-primary-foreground')}>{displayContent}</p>
          ) : isAssistant && isRealStreaming ? (
            <StreamingText isComplete={false} isRealStreaming={true} speed={120} text={enrichedContent}>
              {(displayedText) => (
                <div className={proseClasses}>
                  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {displayedText}
                  </ReactMarkdown>
                </div>
              )}
            </StreamingText>
          ) : isAssistant && shouldStream && !streamComplete ? (
            <StreamingText isComplete={streamComplete} onComplete={() => setStreamComplete(true)} speed={120} text={enrichedContent}>
              {(streamedText) => (
                <div className={proseClasses}>
                  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {streamedText}
                  </ReactMarkdown>
                </div>
              )}
            </StreamingText>
          ) : (
            <div className={proseClasses}>
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {enrichedContent}
              </ReactMarkdown>
            </div>
          )}
          {isAssistant && mediaPaths.length > 0 && <MediaGallery filePaths={mediaPaths} />}
          <p className={cn('mt-1.5 text-xs', isUser ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
          {isAssistant && showContinueButton && onContinue && (
            <Button className="mt-3 gap-1.5" disabled={isLoading} onClick={onContinue} size="sm">
              <Play className="h-3 w-3" />
              {continueLabel || 'Continue'}
            </Button>
          )}
        </div>

        {showCopyButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={'Copy to clipboard'}
                className={cn(
                  'relative opacity-0 transition-all duration-200 group-hover:opacity-100',
                  'rounded p-1 hover:bg-accent',
                  'mt-1 shrink-0',
                  isAssistant ? 'self-start' : 'self-end',
                  !copied && 'text-muted-foreground hover:text-foreground',
                  copied && '!bg-green-500/10 !text-green-600 !hover:bg-green-500/20'
                )}
                data-testid="message-copy-button"
                onClick={handleCopy}
                size="icon-sm"
                variant="ghost"
              >
                <Check className={cn('absolute h-4 w-4', !copied && 'hidden')} />
                <Copy className={cn('absolute h-4 w-4', copied && 'hidden')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span>Copy to clipboard</span>
            </TooltipContent>
          </Tooltip>
        )}
      </motion.div>
    );
  },
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.shouldStream === next.shouldStream &&
    prev.isLastMessage === next.isLastMessage &&
    prev.isRunning === next.isRunning &&
    prev.showContinueButton === next.showContinueButton &&
    prev.isLoading === next.isLoading &&
    prev.isRealStreaming === next.isRealStreaming
);
