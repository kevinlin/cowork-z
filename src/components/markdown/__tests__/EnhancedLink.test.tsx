import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMarkdownComponents, EnhancedLink } from '../EnhancedLink';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', () => ({
  revealInFinder: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  getHomeDir: vi.fn(() => Promise.resolve('/Users/testuser')),
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
    render(<EnhancedLink href="file:///Users/name/photo.jpg">/Users/name/photo.jpg</EnhancedLink>);
    expect(screen.getByText('/Users/name/photo.jpg')).toBeInTheDocument();
  });

  it('should call openExternal for http URLs on click', async () => {
    render(<EnhancedLink href="https://example.com">Link</EnhancedLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    expect(api.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('should call revealInFinder for file paths on click', async () => {
    render(<EnhancedLink href="file:///Users/name/file.txt">/Users/name/file.txt</EnhancedLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    await waitFor(() => {
      expect(api.revealInFinder).toHaveBeenCalledWith('/Users/name/file.txt');
    });
  });

  it('should block unsafe paths', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<EnhancedLink href="file:///Users/name/../../etc/passwd">unsafe path</EnhancedLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(api.revealInFinder).not.toHaveBeenCalledWith('/Users/name/../../etc/passwd');
    warnSpy.mockRestore();
  });

  it('should truncate very long display text', () => {
    const longPath = '/Users/name/very/long/deeply/nested/directory/structure/with/many/segments/photo.jpg';
    render(<EnhancedLink href={`file://${longPath}`}>{longPath}</EnhancedLink>);
    // Should be truncated (original is > 60 chars)
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('…');
  });
});

describe('createMarkdownComponents - code component', () => {
  it('should render file:/// URL in inline code as a clickable link', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    const { container } = render(<CodeComponent>{'file:///Users/name/data.xlsx'}</CodeComponent>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('file:///Users/name/data.xlsx');
  });

  it('should render absolute Mac path in inline code as a clickable link', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    const { container } = render(<CodeComponent>{'/Users/name/Documents/report.pdf'}</CodeComponent>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('file:///Users/name/Documents/report.pdf');
  });

  it('should render absolute Windows path in inline code as a clickable link', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    const { container } = render(<CodeComponent>{'C:\\Users\\name\\file.txt'}</CodeComponent>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('file://C:\\Users\\name\\file.txt');
  });

  it('should render ordinary inline code as <code> element', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    const { container } = render(<CodeComponent>{'npm install'}</CodeComponent>);
    const code = container.querySelector('code');
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe('npm install');
    // Should NOT be a link
    expect(container.querySelector('a')).toBeNull();
  });

  it('should not intercept fenced code block elements (with className)', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    // react-markdown adds className="language-*" to fenced code blocks
    const { container } = render(<CodeComponent className="language-bash">{'/usr/local/bin/node'}</CodeComponent>);
    const code = container.querySelector('code');
    expect(code).toBeTruthy();
    expect(code!.className).toBe('language-bash');
    expect(container.querySelector('a')).toBeNull();
  });

  it('should render file:/// URL with spaces in inline code as a link', () => {
    const components = createMarkdownComponents();
    const CodeComponent = components.code!;
    const { container } = render(<CodeComponent>{'file:///Users/name/My Documents/file.xlsx'}</CodeComponent>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('file:///Users/name/My Documents/file.xlsx');
  });
});
