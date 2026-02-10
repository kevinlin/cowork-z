'use client';

import { getCurrentWebview } from '@tauri-apps/api/webview';
import { CornerDownLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPathForChat, insertAtCursor } from '@/lib/file-utils';
import { cn } from '@/lib/utils';
import { analytics } from '../../lib/analytics';
import { getTauriAPI } from '../../lib/tauri-api-interface';

interface TaskInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  large?: boolean;
  autoFocus?: boolean;
}

export default function TaskInputBar({
  value,
  onChange,
  onSubmit,
  placeholder = 'Assign a task or ask anything',
  isLoading = false,
  disabled = false,
  large = false,
  autoFocus = false,
}: TaskInputBarProps) {
  const isDisabled = disabled || isLoading;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const api = getTauriAPI();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Refs to access latest values inside the Tauri event callback
  const valueRef = useRef(value);
  valueRef.current = value;
  const cursorPositionRef = useRef(cursorPosition);
  cursorPositionRef.current = cursorPosition;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  // ── Tauri native drag-and-drop listener ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;

        if (event.payload.type === 'over') {
          setIsDraggingOver(true);
        } else if (event.payload.type === 'drop') {
          setIsDraggingOver(false);

          const paths: string[] = event.payload.paths;
          if (paths.length === 0) return;

          const formattedPaths = paths
            .map((p) => formatPathForChat(p))
            .filter((p): p is string => p !== null);

          if (formattedPaths.length === 0) return;

          const insertText = formattedPaths.join(' ');
          const { newText, newCursorPosition } = insertAtCursor(
            valueRef.current,
            insertText,
            cursorPositionRef.current
          );

          onChangeRef.current(newText);

          // Restore cursor position after React renders the new value
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
              textareaRef.current.focus();
            }
          }, 0);
        } else {
          // cancelled
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
  }, []);

  // ── Text input handlers ──────────────────────────────────────────
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCursorPosition(e.target.selectionStart ?? 0);
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleSelectionChange = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement> | React.KeyboardEvent<HTMLTextAreaElement>) => {
      setCursorPosition(e.currentTarget.selectionStart ?? 0);
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ignore Enter during IME composition (Chinese/Japanese input)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 shadow-sm transition-all duration-200 ease-accomplish focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        isDraggingOver && 'ring-2 ring-ring ring-offset-2 ring-offset-background'
      )}
    >
      {/* Text input */}
      <textarea
        className={`max-h-[200px] flex-1 resize-none bg-transparent text-foreground placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${large ? 'text-[20px]' : 'text-sm'}`}
        data-testid="task-input-textarea"
        disabled={isDisabled}
        onChange={handleTextareaChange}
        onClick={handleSelectionChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleSelectionChange}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />

      {/* Submit button */}
      <button
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all duration-200 ease-accomplish hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="task-input-submit"
        disabled={!value.trim() || isDisabled}
        onClick={() => {
          analytics.trackSubmitTask();
          api.logEvent({
            level: 'info',
            message: 'Task input submit clicked',
            context: { prompt: value },
          });
          onSubmit();
        }}
        title="Submit"
        type="button"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
      </button>
    </div>
  );
}
