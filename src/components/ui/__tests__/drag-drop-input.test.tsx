import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DragDropInput } from '../drag-drop-input';

// Helper to create a File with the non-standard `path` property (Tauri/Electron)
function createFileWithPath(filePath: string): File {
  const file = new File([''], filePath.split('/').pop() || 'file', { type: 'application/octet-stream' });
  Object.defineProperty(file, 'path', { value: filePath, writable: false });
  return file;
}

// Helper to create a DataTransfer-like object
function createDataTransfer(filePaths: string[]) {
  const files = filePaths.map(createFileWithPath);
  return {
    files,
    items: files.map((f) => ({ kind: 'file' as const, getAsFile: () => f })),
    types: ['Files'],
  };
}

describe('DragDropInput', () => {
  it('should render with all props passed through to Input', () => {
    render(<DragDropInput data-testid="dnd-input" placeholder="Drop files here" value="" />);
    const input = screen.getByTestId('dnd-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Drop files here');
  });

  it('should show ring styling during drag-over and remove on drag-leave', () => {
    render(<DragDropInput data-testid="dnd-input" value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.dragOver(input);
    expect(input.className).toContain('ring-2');

    fireEvent.dragLeave(input);
    expect(input.className).not.toContain('ring-2');
  });

  it('should call onFilesDropped with formatted path on single file drop', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.drop(input, { dataTransfer: createDataTransfer(['/Users/test/file.txt']) });

    // "@/Users/test/file.txt" is 21 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@/Users/test/file.txt', 21);
  });

  it('should handle multiple files with space-separated paths', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.drop(input, { dataTransfer: createDataTransfer(['/Users/test/a.txt', '/Users/test/b.txt']) });

    // "@/Users/test/a.txt @/Users/test/b.txt" is 37 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@/Users/test/a.txt @/Users/test/b.txt', 37);
  });

  it('should quote paths with spaces', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.drop(input, { dataTransfer: createDataTransfer(['/Users/test/my file.txt']) });

    // '@"/Users/test/my file.txt"' is 26 chars
    expect(onFilesDropped).toHaveBeenCalledWith('@"/Users/test/my file.txt"', 26);
  });

  it('should filter out unsafe paths and not call callback', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.drop(input, { dataTransfer: createDataTransfer(['/Users/../etc/passwd']) });

    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it('should handle empty drop (no files)', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="" />);
    const input = screen.getByTestId('dnd-input');

    fireEvent.drop(input, { dataTransfer: { files: [], items: [], types: [] } });

    expect(onFilesDropped).not.toHaveBeenCalled();
  });

  it('should insert at cursor position with existing text', () => {
    const onFilesDropped = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onFilesDropped={onFilesDropped} value="Hello world" />);
    const input = screen.getByTestId('dnd-input') as HTMLInputElement;

    // Position cursor at index 5 by clicking then updating selection
    input.setSelectionRange(5, 5);
    fireEvent.click(input);

    fireEvent.drop(input, { dataTransfer: createDataTransfer(['/Users/test/file.txt']) });

    // "@/Users/test/file.txt" inserted at position 5
    expect(onFilesDropped).toHaveBeenCalledWith('Hello@/Users/test/file.txt world', 26);
  });

  it('should forward onChange to parent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DragDropInput data-testid="dnd-input" onChange={onChange} value="" />);
    const input = screen.getByTestId('dnd-input');

    await user.type(input, 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('should remove ring styling after drop', () => {
    render(<DragDropInput data-testid="dnd-input" value="" />);
    const input = screen.getByTestId('dnd-input');

    // Drag over first
    fireEvent.dragOver(input);
    expect(input.className).toContain('ring-2');

    // Then drop
    fireEvent.drop(input, { dataTransfer: { files: [], items: [], types: [] } });
    expect(input.className).not.toContain('ring-2');
  });
});
