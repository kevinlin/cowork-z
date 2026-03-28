import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ChevronDown, Loader2, Play, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearPendingDragPath, getPendingDragPath } from '@/components/sidebar/FileTreePanel';
import { Button } from '@/components/ui/button';
import { formatPathForChat, insertAtCursor } from '@/lib/file-utils';
import { cn } from '@/lib/utils';
import { selectIsRunning, useArenaStore } from '@/stores/arenaStore';
import { ArenaModelPickerDialog } from './ArenaModelPickerDialog';

interface ArenaInputBarProps {
  isNewArena: boolean;
  canFollowUp: boolean;
}

export const ArenaInputBar = ({ isNewArena, canFollowUp }: ArenaInputBarProps) => {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickerColumnIndex, setPickerColumnIndex] = useState<0 | 1 | 2 | null>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const { columns, setColumnModel, startArena, sendFollowUp, abortAll, arenaId } = useArenaStore();
  const isRunning = useArenaStore(selectIsRunning);

  const insertTextAtCursor = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart ?? textarea.value.length;
    const { newText, newCursorPosition } = insertAtCursor(textarea.value, text, cursorPos);
    textarea.value = newText;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    setTimeout(() => {
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }, []);

  // Listen for "Add to Chat" events from the file preview panel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      insertTextAtCursor(detail.text);
    };
    window.addEventListener('add-to-chat', handler);
    return () => window.removeEventListener('add-to-chat', handler);
  }, [insertTextAtCursor]);

  // Tauri native drag-and-drop listener (OS drops + intra-app file tree drags)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;

        if (event.payload.type === 'over' || event.payload.type === 'enter') {
          setIsDraggingOver(true);
        } else if (event.payload.type === 'drop') {
          setIsDraggingOver(false);

          const paths: string[] = event.payload.paths;

          const pendingPath = getPendingDragPath();
          if (paths.length === 0 && pendingPath) {
            clearPendingDragPath();
            const formatted = formatPathForChat(pendingPath);
            if (formatted) insertTextAtCursor(formatted);
            return;
          }

          if (paths.length === 0) return;

          const formattedPaths = paths.map((p) => formatPathForChat(p)).filter((p): p is string => p !== null);
          if (formattedPaths.length === 0) return;
          insertTextAtCursor(formattedPaths.join(' '));
        } else {
          setIsDraggingOver(false);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [insertTextAtCursor]);

  // Auto-resize textarea
  const handleTextareaInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  const handleStart = async () => {
    const prompt = textareaRef.current?.value.trim();
    if (!prompt) return;

    try {
      const newArenaId = await startArena(prompt);
      if (textareaRef.current) {
        textareaRef.current.value = '';
        handleTextareaInput();
      }
      if (isNewArena) {
        navigate(`/arena/${newArenaId}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to start arena:', err);
    }
  };

  const handleFollowUp = async () => {
    const message = textareaRef.current?.value.trim();
    if (!message) return;

    try {
      await sendFollowUp(message);
      if (textareaRef.current) {
        textareaRef.current.value = '';
        handleTextareaInput();
      }
    } catch (err) {
      console.error('Failed to send follow-up:', err);
    }
  };

  const handleStop = async () => {
    try {
      await abortAll();
    } catch (err) {
      console.error('Failed to abort arena:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isRunning) return;
      if (!arenaId || isNewArena) {
        handleStart();
      } else if (canFollowUp) {
        handleFollowUp();
      }
    }
  };

  const handleModelSelected = (modelId: string, displayName: string) => {
    if (pickerColumnIndex !== null) {
      setColumnModel(pickerColumnIndex, modelId, displayName);
    }
  };

  const hasSelectedModels = columns.some((col) => col.modelId);
  const showModelPickers = isNewArena || !arenaId;

  return (
    <div className="flex-shrink-0 border-border border-b bg-card/50 px-4 py-3">
      {/* Model pickers row — shown before arena starts */}
      {showModelPickers && (
        <div className="mb-3 flex items-center gap-2">
          {([0, 1, 2] as const).map((index) => {
            const col = columns[index];
            return (
              <button
                className={cn(
                  'flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  col.modelId
                    ? 'border-primary/30 bg-primary/5 text-foreground'
                    : 'border-input bg-background text-muted-foreground hover:border-ring hover:text-foreground'
                )}
                key={index}
                onClick={() => setPickerColumnIndex(index)}
                type="button"
              >
                <span className="truncate">{col.modelDisplayName || `Column ${index + 1} — select model`}</span>
                <ChevronDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
              </button>
            );
          })}
        </div>
      )}

      {/* Model picker dialog */}
      {pickerColumnIndex !== null && (
        <ArenaModelPickerDialog
          columnIndex={pickerColumnIndex}
          onModelSelected={handleModelSelected}
          onOpenChange={(open) => {
            if (!open) setPickerColumnIndex(null);
          }}
          open
        />
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'max-h-[120px] min-h-[38px]',
            isDraggingOver && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
          )}
          disabled={isRunning}
          onInput={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning ? 'Waiting for responses...' : canFollowUp ? 'Send a follow-up message...' : 'Describe the task for all agents...'
          }
          ref={textareaRef}
          rows={1}
        />

        {isRunning ? (
          <Button className="shrink-0" onClick={handleStop} size="sm" variant="destructive">
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Stop All
          </Button>
        ) : !arenaId || isNewArena ? (
          <Button className="shrink-0" disabled={!hasSelectedModels} onClick={handleStart} size="sm">
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Start Arena
          </Button>
        ) : canFollowUp ? (
          <Button className="shrink-0" onClick={handleFollowUp} size="sm">
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send
          </Button>
        ) : (
          <Button className="shrink-0" disabled size="sm">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Running
          </Button>
        )}
      </div>
    </div>
  );
};
