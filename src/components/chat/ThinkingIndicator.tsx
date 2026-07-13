import { AnimatePresence, motion } from 'framer-motion';
import { springs } from '@/lib/animations';
import { cn } from '@/lib/utils';
import type { StartupStageInfo } from '@/stores/taskStore';
import loadingSymbol from '/assets/loading-symbol.svg';
import { TOOL_PROGRESS_MAP } from './ToolCallCard';

const SpinningIcon = ({ className }: { className?: string }) => (
  <img alt="" className={cn('animate-spin-ccw', className)} src={loadingSymbol} />
);

interface ThinkingIndicatorProps {
  isVisible: boolean;
  currentTool: string | null;
  currentToolInput: unknown;
  startupStage: StartupStageInfo | null;
  startupStageTaskId: string | null;
  taskId: string | undefined;
  elapsedTime: number;
}

export function ThinkingIndicator({
  isVisible,
  currentTool,
  currentToolInput,
  startupStage,
  startupStageTaskId,
  taskId,
  elapsedTime,
}: ThinkingIndicatorProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-1 py-2 text-muted-foreground"
          data-testid="execution-thinking-indicator"
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          transition={springs.gentle}
        >
          <div className="flex items-center gap-2">
            <SpinningIcon className="h-4 w-4" />
            <span className="text-sm">
              {currentTool
                ? (currentToolInput as { description?: string })?.description || TOOL_PROGRESS_MAP[currentTool]?.label || currentTool
                : startupStageTaskId === taskId && startupStage
                  ? startupStage.message
                  : 'Thinking...'}
            </span>
            {currentTool && !(currentToolInput as { description?: string })?.description && (
              <span className="text-muted-foreground text-xs">({currentTool})</span>
            )}
            {!currentTool && startupStageTaskId === taskId && startupStage && (
              <span className="text-muted-foreground text-xs">({elapsedTime}s)</span>
            )}
          </div>
          {!currentTool && startupStageTaskId === taskId && startupStage?.isFirstTask && startupStage.stage === 'browser' && (
            <span className="ml-6 text-muted-foreground text-xs">First task takes a bit longer...</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
