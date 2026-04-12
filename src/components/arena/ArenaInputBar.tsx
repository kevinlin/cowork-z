import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ChevronDown, Loader2, Play, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearPendingDragPath, getPendingDragPath } from '@/components/sidebar/FileTreePanel';
import { Button } from '@/components/ui/button';
import { SkillAutocompletePopover } from '@/components/ui/skill-autocomplete-popover';
import { SkillPill } from '@/components/ui/skill-pill';
import { useSkillAutocomplete } from '@/hooks/useSkillAutocomplete';
import { formatPathForChat, insertAtCursor } from '@/lib/file-utils';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { cn } from '@/lib/utils';
import { selectIsRunning, useArenaStore } from '@/stores/arenaStore';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
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
  const [inputValue, setInputValue] = useState('');

  const { columns, setColumnModel, startArena, sendFollowUp, abortAll, arenaId } = useArenaStore();
  const isRunning = useArenaStore(selectIsRunning);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const api = getTauriAPI();

  const skillAutocomplete = useSkillAutocomplete({
    text: inputValue,
    onTextChange: setInputValue,
    disabled: isRunning,
  });

  const handleSkillPillClick = useCallback(async () => {
    if (!skillAutocomplete.selectedSkill) return;
    try {
      const path = await api.getSkillFilePath(skillAutocomplete.selectedSkill.id, activeWorkspace?.folderPath);
      useFilePreviewStore.getState().openPreviewByPath(path);
    } catch (e) {
      console.error('Failed to open skill preview:', e);
    }
  }, [skillAutocomplete.selectedSkill, activeWorkspace?.folderPath, api]);

  // Ref for drag-drop access to latest value
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  const doInsertText = useCallback((text: string) => {
    const textarea = textareaRef.current;
    const cursorPos = textarea ? (textarea.selectionStart ?? inputValueRef.current.length) : inputValueRef.current.length;
    const { newText, newCursorPosition } = insertAtCursor(inputValueRef.current, text, cursorPos);
    setInputValue(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
        textareaRef.current.focus();
      }
    }, 0);
  }, []);

  // Listen for "Add to Chat" events from the file preview panel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      doInsertText(detail.text);
    };
    window.addEventListener('add-to-chat', handler);
    return () => window.removeEventListener('add-to-chat', handler);
  }, [doInsertText]);

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
            if (formatted) doInsertText(formatted);
            return;
          }

          if (paths.length === 0) return;

          const formattedPaths = paths.map((p) => formatPathForChat(p)).filter((p): p is string => p !== null);
          if (formattedPaths.length === 0) return;
          doInsertText(formattedPaths.join(' '));
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
  }, [doInsertText]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleStart = async () => {
    const raw = inputValue.trim();
    if (!raw) return;

    const composed = skillAutocomplete.composePrompt();
    try {
      const newArenaId = await startArena(composed);
      setInputValue('');
      skillAutocomplete.clearSkill();
      if (isNewArena) {
        navigate(`/arena/${newArenaId}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to start arena:', err);
    }
  };

  const handleFollowUp = async () => {
    const raw = inputValue.trim();
    if (!raw) return;

    const composed = skillAutocomplete.composePrompt();
    try {
      await sendFollowUp(composed);
      setInputValue('');
      skillAutocomplete.clearSkill();
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
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    skillAutocomplete.handleKeyDown(e);
    if (e.defaultPrevented) return;
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
      <div className="relative flex flex-col gap-1.5">
        <SkillAutocompletePopover
          highlightedIndex={skillAutocomplete.highlightedIndex}
          isOpen={skillAutocomplete.isPopoverOpen}
          onHighlightChange={skillAutocomplete.setHighlightedIndex}
          onSelect={skillAutocomplete.selectSkill}
          position="below"
          skills={skillAutocomplete.filteredSkills}
        />

        {skillAutocomplete.selectedSkill && (
          <div className="flex items-center">
            <SkillPill onClick={handleSkillPillClick} onRemove={skillAutocomplete.clearSkill} skill={skillAutocomplete.selectedSkill} />
          </div>
        )}

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
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRunning ? 'Waiting for responses...' : canFollowUp ? 'Send a follow-up message...' : 'Describe the task for all agents...'
            }
            ref={textareaRef}
            rows={1}
            value={inputValue}
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
    </div>
  );
};
