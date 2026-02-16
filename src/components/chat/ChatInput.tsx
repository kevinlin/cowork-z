import { CornerDownLeft, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DragDropTextarea } from '@/components/ui/drag-drop-input';
import { Input } from '@/components/ui/input';

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

  const handleFollowUp = () => {
    if (!followUp.trim()) return;
    onSend(followUp);
    setFollowUp('');
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
          <div className="flex gap-3">
            <DragDropTextarea
              className="flex-1"
              data-testid="execution-follow-up-input"
              disabled={isLoading}
              onChange={(e) => setFollowUp(e.target.value)}
              onFilesDropped={(newValue, newCursorPosition) => {
                setFollowUp(newValue);
                setTimeout(() => {
                  if (followUpInputRef.current) {
                    followUpInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                    followUpInputRef.current.focus();
                  }
                }, 0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleFollowUp();
                }
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
