import { CornerDownLeft, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DragDropTextarea } from '@/components/ui/drag-drop-input';
import { Input } from '@/components/ui/input';
import { SkillAutocompletePopover } from '@/components/ui/skill-autocomplete-popover';
import { SkillPill } from '@/components/ui/skill-pill';
import { useSkillAutocomplete } from '@/hooks/useSkillAutocomplete';
import { insertAtCursor } from '@/lib/file-utils';
import type { SkillMeta } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

interface ChatInputProps {
  isRunning: boolean;
  canFollowUp: boolean;
  isComplete: boolean;
  isLoading: boolean;
  hasPermissionRequest: boolean;
  taskStatus: string | undefined;
  hasSession: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
}

export function ChatInput({
  isRunning,
  canFollowUp,
  isComplete,
  isLoading,
  hasPermissionRequest,
  taskStatus,
  hasSession,
  onSend,
  onStop,
}: ChatInputProps) {
  const navigate = useNavigate();
  const [followUp, setFollowUp] = useState('');
  const followUpInputRef = useRef<HTMLTextAreaElement>(null);
  const cursorPositionRef = useRef(0);
  const followUpRef = useRef(followUp);
  followUpRef.current = followUp;
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  const handleSkillPillClick = useCallback(
    async (skill: SkillMeta) => {
      try {
        const api = getTauriAPI();
        const path = await api.getSkillFilePath(skill.id, activeWorkspace?.folderPath);
        useFilePreviewStore.getState().openPreviewByPath(path);
      } catch (e) {
        console.error('Failed to open skill preview:', e);
      }
    },
    [activeWorkspace?.folderPath]
  );

  const skillAutocomplete = useSkillAutocomplete({
    text: followUp,
    onTextChange: setFollowUp,
    disabled: !canFollowUp,
  });

  // Listen for "Add to Chat" events from the file preview panel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) return;
      const { newText, newCursorPosition } = insertAtCursor(followUpRef.current, detail.text, cursorPositionRef.current);
      setFollowUp(newText);
      setTimeout(() => {
        if (followUpInputRef.current) {
          followUpInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
          followUpInputRef.current.focus();
        }
      }, 0);
    };
    window.addEventListener('add-to-chat', handler);
    return () => window.removeEventListener('add-to-chat', handler);
  }, []);

  const handleFollowUp = () => {
    if (!followUp.trim()) return;
    const composed = skillAutocomplete.composePrompt();
    onSend(composed);
    setFollowUp('');
    skillAutocomplete.clearSkill();
  };

  // Running state input with Stop button
  if (isRunning && !hasPermissionRequest) {
    return (
      <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4">
        <div className="mx-auto flex max-w-4xl gap-3">
          <Input className="flex-1 opacity-50" disabled placeholder="Agent is working..." />
          <Button
            className="shrink-0 hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid="execution-stop-button"
            onClick={onStop}
            size="icon"
            title="Stop agent (Ctrl+C)"
            variant="outline"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </div>
      </div>
    );
  }

  // Follow-up input
  if (canFollowUp) {
    return (
      <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="relative flex flex-col gap-1.5">
            <SkillAutocompletePopover
              highlightedIndex={skillAutocomplete.highlightedIndex}
              isOpen={skillAutocomplete.isPopoverOpen}
              onHighlightChange={skillAutocomplete.setHighlightedIndex}
              onSelect={skillAutocomplete.selectSkill}
              skills={skillAutocomplete.filteredSkills}
            />

            {skillAutocomplete.selectedSkill && (
              <div className="flex items-center">
                <SkillPill
                  onClick={() => handleSkillPillClick(skillAutocomplete.selectedSkill!)}
                  onRemove={skillAutocomplete.clearSkill}
                  skill={skillAutocomplete.selectedSkill}
                />
              </div>
            )}

            <div className="flex gap-3">
              <DragDropTextarea
                className="flex-1"
                data-testid="execution-follow-up-input"
                disabled={isLoading}
                onChange={(e) => {
                  cursorPositionRef.current = e.target.selectionStart ?? 0;
                  setFollowUp(e.target.value);
                }}
                onClick={(e) => {
                  cursorPositionRef.current = e.currentTarget.selectionStart ?? 0;
                }}
                onFilesDropped={(newValue, newCursorPosition) => {
                  setFollowUp(newValue);
                  cursorPositionRef.current = newCursorPosition;
                  setTimeout(() => {
                    if (followUpInputRef.current) {
                      followUpInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                      followUpInputRef.current.focus();
                    }
                  }, 0);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  skillAutocomplete.handleKeyDown(e);
                  if (e.defaultPrevented) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowUp();
                  }
                }}
                onKeyUp={(e) => {
                  cursorPositionRef.current = e.currentTarget.selectionStart ?? 0;
                }}
                placeholder={
                  taskStatus === 'interrupted'
                    ? hasSession
                      ? 'Give new instructions...'
                      : 'Send a new instruction to retry...'
                    : taskStatus === 'completed'
                      ? 'Give new instructions...'
                      : 'Ask for something...'
                }
                ref={followUpInputRef}
                rows={1}
                value={followUp}
              />
              <Button disabled={!followUp.trim() || isLoading} onClick={handleFollowUp} variant="outline">
                <CornerDownLeft className="mr-1.5 h-4 w-4" />
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Completed/Failed state (no session to continue)
  if (isComplete && !canFollowUp) {
    return (
      <div className="flex-shrink-0 border-border border-t bg-card/50 px-6 py-4 text-center">
        <p className="mb-3 text-muted-foreground text-sm">Task {taskStatus === 'interrupted' ? 'stopped' : taskStatus}</p>
        <Button onClick={() => navigate('/')}>Start New Task</Button>
      </div>
    );
  }

  return null;
}
