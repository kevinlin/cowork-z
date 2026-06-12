import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownComponents, EnhancedLink, fileAwareUrlTransform } from '../EnhancedLink';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', () => ({
  revealInFinder: vi.fn(() => Promise.resolve()),
  openExternal: vi.fn(() => Promise.resolve()),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  getHomeDir: vi.fn(() => Promise.resolve('/Users/testuser')),
}));

const mockOpenPreviewByPath = vi.fn();
vi.mock('@/stores/filePreviewStore', () => ({
  useFilePreviewStore: { getState: () => ({ openPreviewByPath: mockOpenPreviewByPath }) },
}));

import * as api from '@/lib/tauri-api';

describe('EnhancedLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
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

  it('should open preview panel for file paths on click', async () => {
    render(<EnhancedLink href="file:///Users/name/file.txt">/Users/name/file.txt</EnhancedLink>);
    const link = screen.getByRole('link');
    fireEvent.click(link);
    await waitFor(() => {
      expect(mockOpenPreviewByPath).toHaveBeenCalledWith('/Users/name/file.txt');
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
    expect(mockOpenPreviewByPath).not.toHaveBeenCalled();
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

describe('fileAwareUrlTransform', () => {
  it('should preserve file: hrefs', () => {
    expect(fileAwareUrlTransform('file:///Users/name/report.pdf')).toBe('file:///Users/name/report.pdf');
  });

  it('should preserve default-safe protocols', () => {
    expect(fileAwareUrlTransform('https://example.com')).toBe('https://example.com');
    expect(fileAwareUrlTransform('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('should strip unsafe protocols', () => {
    expect(fileAwareUrlTransform('javascript:alert(1)')).toBe('');
  });

  // Regression for technical review finding #22: previous tests called the
  // component factory directly and never exercised react-markdown's URL
  // sanitizer, which strips file: hrefs to "" without a custom urlTransform.
  it('should keep file:// hrefs clickable through a full ReactMarkdown render', () => {
    const markdown = '[/Users/name/report.pdf](file:///Users/name/report.pdf)';
    const { container } = render(
      <ReactMarkdown components={createMarkdownComponents()} urlTransform={fileAwareUrlTransform}>
        {markdown}
      </ReactMarkdown>
    );
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('file:///Users/name/report.pdf');
  });
});
