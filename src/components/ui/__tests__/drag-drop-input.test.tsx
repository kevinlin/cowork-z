import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the onDragDropEvent callback so tests can simulate Tauri drag events
let dragDropCallback: ((event: { payload: { type: string; paths?: string[] } }) => void) | null = null;

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (event: { payload: { type: string; paths?: string[] } }) => void) => {
      dragDropCallback = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

import { DragDropTextarea } from '../drag-drop-input';

beforeEach(() => {
  dragDropCallback = null;
});

describe('DragDropTextarea', () => {
  it('should render as a textarea with all props passed through', () => {
    render(<DragDropTextarea data-testid="dnd-textarea" placeholder="Drop files here" value="" />);
    const textarea = screen.getByTestId('dnd-textarea');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('placeholder', 'Drop files here');
  });

  it('should show ring styling during Tauri drag-over and remove on cancel', async () => {
    render(<DragDropTextarea data-testid="dnd-textarea" value="" />);
    const textarea = screen.getByTestId('dnd-textarea');

    // Wait for useEffect to register the callback
    await act(async () => {});

    // Simulate Tauri drag-over event
    act(() => {
      dragDropCallback?.({ payload: { type: 'over' } });
    });
    expect(textarea.className).toContain('ring-2');

    // Simulate Tauri drag-cancel event
    act(() => {
      dragDropCallback?.({ payload: { type: 'cancel' } });
    });
    expect(textarea.className).not.toContain('ring-2');
  });

  it('should call onFilesDropped with formatted path on single file drop', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="" />);

    await act(async () => {});

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: ['/Users/test/file.txt'] } });
    });

    // "@/Users/test/file.txt" is 21 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@/Users/test/file.txt', 21);
  });

  it('should handle multiple files with space-separated paths', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="" />);

    await act(async () => {});

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: ['/Users/test/a.txt', '/Users/test/b.txt'] } });
    });

    // "@/Users/test/a.txt @/Users/test/b.txt" is 37 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@/Users/test/a.txt @/Users/test/b.txt', 37);
  });

  it('should quote paths with spaces', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="" />);

    await act(async () => {});

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: ['/Users/test/my file.txt'] } });
    });

    // '@"/Users/test/my file.txt"' is 26 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@"/Users/test/my file.txt"', 26);
  });

  it('should filter out unsafe paths and not call callback', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="" />);

    await act(async () => {});

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: ['/Users/../etc/passwd'] } });
    });

    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it('should handle empty drop (no files)', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="" />);

    await act(async () => {});

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: [] } });
    });

    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it('should insert at cursor position with existing text', async () => {
    const onFilesDropped = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onFilesDropped={onFilesDropped} value="Hello world" />);
    const textarea = screen.getByTestId('dnd-textarea') as HTMLTextAreaElement;

    await act(async () => {});

    // Position cursor at index 5 by clicking then updating selection
    textarea.setSelectionRange(5, 5);
    fireEvent.click(textarea);

    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: ['/Users/test/file.txt'] } });
    });

    // "@/Users/test/file.txt" inserted at position 5
    expect(onFilesDropped).toHaveBeenCalledWith('Hello@/Users/test/file.txt world', 26);
  });

  it('should forward onChange to parent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onChange={onChange} value="" />);
    const textarea = screen.getByTestId('dnd-textarea');

    await user.type(textarea, 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('should remove ring styling after drop', async () => {
    render(<DragDropTextarea data-testid="dnd-textarea" value="" />);
    const textarea = screen.getByTestId('dnd-textarea');

    await act(async () => {});

    // Drag over first
    act(() => {
      dragDropCallback?.({ payload: { type: 'over' } });
    });
    expect(textarea.className).toContain('ring-2');

    // Then drop (removes ring styling)
    act(() => {
      dragDropCallback?.({ payload: { type: 'drop', paths: [] } });
    });
    expect(textarea.className).not.toContain('ring-2');
  });

  it('should support multi-line input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DragDropTextarea data-testid="dnd-textarea" onChange={onChange} value="" />);
    const textarea = screen.getByTestId('dnd-textarea') as HTMLTextAreaElement;

    // Verify it renders as a textarea element (supports multi-line)
    expect(textarea.tagName).toBe('TEXTAREA');

    // Type multi-line content
    await user.type(textarea, 'Line 1{enter}Line 2');
    expect(onChange).toHaveBeenCalled();
  });
});
