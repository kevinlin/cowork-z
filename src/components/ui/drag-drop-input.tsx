import { getCurrentWebview } from '@tauri-apps/api/webview';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { formatPathForChat, insertAtCursor } from '@/lib/file-utils';
import { cn } from '@/lib/utils';
import { Input } from './input';

interface DragDropInputProps extends React.ComponentProps<typeof Input> {
  /** Called when files are dropped, receives the updated value and new cursor position */
  onFilesDropped?: (newValue: string, cursorPosition: number) => void;
}

export const DragDropInput = forwardRef<HTMLInputElement, DragDropInputProps>(
  ({ className, onFilesDropped, value, onChange, ...props }, ref) => {
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);

    // Refs to access latest values inside the Tauri event callback
    const valueRef = useRef(value);
    valueRef.current = value;
    const cursorPositionRef = useRef(cursorPosition);
    cursorPositionRef.current = cursorPosition;
    const onFilesDroppedRef = useRef(onFilesDropped);
    onFilesDroppedRef.current = onFilesDropped;

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
            const currentText = (valueRef.current as string) ?? '';
            const { newText, newCursorPosition } = insertAtCursor(
              currentText,
              insertText,
              cursorPositionRef.current
            );

            onFilesDroppedRef.current?.(newText, newCursorPosition);
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

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setCursorPosition(e.target.selectionStart ?? 0);
        onChange?.(e);
      },
      [onChange]
    );

    const handleSelectionChange = useCallback(
      (e: React.MouseEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
        const target = e.currentTarget;
        setCursorPosition(target.selectionStart ?? 0);
      },
      []
    );

    return (
      <Input
        className={cn(className, isDraggingOver && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
        onChange={handleChange}
        onClick={handleSelectionChange}
        onKeyUp={handleSelectionChange}
        ref={ref}
        value={value}
        {...props}
      />
    );
  }
);

DragDropInput.displayName = 'DragDropInput';
