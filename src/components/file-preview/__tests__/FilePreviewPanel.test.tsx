import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePreviewPanel } from '../FilePreviewPanel';

vi.mock('@/lib/tauri-api', () => ({
  readFileContent: vi.fn(() => Promise.resolve('')),
  openFilePath: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => path),
}));

// A binary file skips content loading, so the header renders synchronously.
const file = { name: 'blob.bin', path: '/Users/me/ws/blob.bin', isDirectory: false, isSymlink: false, extension: 'bin' };

describe('FilePreviewPanel close button', () => {
  it('has no header close button when onClose is omitted (the rail tab owns closing)', () => {
    render(<FilePreviewPanel file={file} />);
    expect(screen.queryByTitle('Close preview')).toBeNull();
  });

  it('shows the close button when onClose is given (Skills Manager)', () => {
    const onClose = vi.fn();
    render(<FilePreviewPanel file={file} onClose={onClose} />);
    fireEvent.click(screen.getByTitle('Close preview'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
