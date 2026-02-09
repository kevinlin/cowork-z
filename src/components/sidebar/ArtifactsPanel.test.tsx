import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@/shared';
import { ArtifactsPanel } from './ArtifactsPanel';

// Mock the EnhancedLink component
vi.mock('@/components/markdown/EnhancedLink', () => ({
  EnhancedLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-testid="enhanced-link" href={href}>
      {children}
    </a>
  ),
}));

describe('ArtifactsPanel', () => {
  it('should render null when no artifacts', () => {
    const { container } = render(<ArtifactsPanel artifacts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should display artifact count and files', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/test/file1.ts',
        fileName: 'file1.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
      {
        id: '2',
        filePath: '/test/file2.json',
        fileName: 'file2.json',
        fileExt: 'json',
        timestamp: '2026-02-10T10:01:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
    expect(screen.getByText('file2.json')).toBeInTheDocument();
  });

  it('should show singular "file" for single artifact', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/test/file.ts',
        fileName: 'file.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    expect(screen.getByText('1 file')).toBeInTheDocument();
  });

  it('should render EnhancedLink with correct file:// href', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/test/file.ts',
        fileName: 'file.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    const link = screen.getByTestId('enhanced-link');
    expect(link).toHaveAttribute('href', 'file:///test/file.ts');
  });

  it('should sort artifacts by timestamp descending', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/test/a.ts',
        fileName: 'a.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
      {
        id: '2',
        filePath: '/test/c.ts',
        fileName: 'c.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:02:00Z',
        operation: 'write',
      },
      {
        id: '3',
        filePath: '/test/b.ts',
        fileName: 'b.ts',
        fileExt: 'ts',
        timestamp: '2026-02-10T10:01:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    const links = screen.getAllByTestId('enhanced-link');
    expect(links[0]).toHaveTextContent('c.ts'); // Newest
    expect(links[1]).toHaveTextContent('b.ts');
    expect(links[2]).toHaveTextContent('a.ts'); // Oldest
  });

  it('should handle files with long paths', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/Users/username/projects/my-app/src/components/ui/Button/Button.tsx',
        fileName: 'Button.tsx',
        fileExt: 'tsx',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    expect(screen.getByText('Button.tsx')).toBeInTheDocument();
    expect(screen.getByTestId('enhanced-link')).toHaveAttribute(
      'href',
      'file:///Users/username/projects/my-app/src/components/ui/Button/Button.tsx'
    );
  });

  it('should handle files without extensions', () => {
    const artifacts: Artifact[] = [
      {
        id: '1',
        filePath: '/test/Makefile',
        fileName: 'Makefile',
        fileExt: '',
        timestamp: '2026-02-10T10:00:00Z',
        operation: 'write',
      },
    ];

    render(<ArtifactsPanel artifacts={artifacts} />);

    expect(screen.getByText('Makefile')).toBeInTheDocument();
  });
});
