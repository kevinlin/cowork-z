import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MediaGallery } from '../MediaGallery';

// Mock Tauri APIs
vi.mock('@/lib/tauri-api', () => ({
  revealInFinder: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock the file preview store
vi.mock('@/stores/filePreviewStore', () => ({
  useFilePreviewStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openPreviewByPath: vi.fn() })
  ),
}));

describe('MediaGallery', () => {
  it('should render thumbnails for image files', () => {
    const paths = ['/Users/name/photo1.jpg', '/Users/name/photo2.png'];
    render(<MediaGallery filePaths={paths} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('should render thumbnails for video files', () => {
    const paths = ['/Users/name/video.mp4', '/Users/name/clip.webm'];
    render(<MediaGallery filePaths={paths} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('should filter out non-previewable files', () => {
    const paths = [
      '/Users/name/photo.jpg', // previewable
      '/Users/name/readme.pdf', // not previewable
      '/Users/name/app.ts', // not previewable
      '/Users/name/video.mp4', // previewable
    ];
    render(<MediaGallery filePaths={paths} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('should render nothing when no media files', () => {
    const paths = ['/Users/name/readme.txt', '/Users/name/config.json'];
    const { container } = render(<MediaGallery filePaths={paths} />);
    expect(container.innerHTML).toBe('');
  });

  it('should render nothing with empty array', () => {
    const { container } = render(<MediaGallery filePaths={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('should handle mix of previewable and non-previewable correctly', () => {
    const paths = [
      '/Users/name/screenshot.png',
      '/Users/name/archive.zip',
      '/Users/name/demo.mp4',
      '/Users/name/code.js',
      '/Users/name/wallpaper.webp',
    ];
    render(<MediaGallery filePaths={paths} />);
    const buttons = screen.getAllByRole('button');
    // Only png, mp4, webp are previewable
    expect(buttons).toHaveLength(3);
  });
});
