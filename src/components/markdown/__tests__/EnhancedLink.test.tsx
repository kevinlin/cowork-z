import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnhancedLink } from '../EnhancedLink';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', () => ({
  revealInFinder: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

import * as api from '@/lib/tauri-api';

describe('EnhancedLink', () => {
  it('should render with globe icon for http URLs', () => {
    render(<EnhancedLink href="https://example.com">example.com</EnhancedLink>);
    expect(screen.getByText('example.com')).toBeInTheDocument();
    // The link should have an href
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('should render with file icon for file:// URLs', () => {
    render(
      <EnhancedLink href="file:///Users/name/photo.jpg">
        /Users/name/photo.jpg
      </EnhancedLink>
    );
    expect(screen.getByText('/Users/name/photo.jpg')).toBeInTheDocument();
  });

  it('should call openExternal for http URLs on click', async () => {
    render(<EnhancedLink href="https://example.com">Link</EnhancedLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    expect(api.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('should call revealInFinder for file paths on click', async () => {
    render(
      <EnhancedLink href="file:///Users/name/file.txt">
        /Users/name/file.txt
      </EnhancedLink>
    );
    const link = screen.getByRole('link');
    fireEvent.click(link);
    expect(api.revealInFinder).toHaveBeenCalledWith('/Users/name/file.txt');
  });

  it('should block unsafe paths', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <EnhancedLink href="file:///Users/name/../../etc/passwd">
        unsafe path
      </EnhancedLink>
    );
    const link = screen.getByRole('link');
    fireEvent.click(link);
    expect(api.revealInFinder).not.toHaveBeenCalledWith('/Users/name/../../etc/passwd');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should truncate very long display text', () => {
    const longPath = '/Users/name/very/long/deeply/nested/directory/structure/with/many/segments/photo.jpg';
    render(
      <EnhancedLink href={`file://${longPath}`}>
        {longPath}
      </EnhancedLink>
    );
    // Should be truncated (original is > 60 chars)
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('…');
  });
});
