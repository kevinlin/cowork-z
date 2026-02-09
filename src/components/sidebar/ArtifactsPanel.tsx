'use client';

import { memo, useMemo } from 'react';
import { EnhancedLink } from '@/components/markdown/EnhancedLink';
import { cn } from '@/lib/utils';
import type { Artifact } from '@/shared';

interface ArtifactsPanelProps {
  artifacts: Artifact[];
  className?: string;
}

export const ArtifactsPanel = memo(function ArtifactsPanel({ artifacts, className }: ArtifactsPanelProps) {
  const sortedArtifacts = useMemo(() => [...artifacts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [artifacts]);

  if (artifacts.length === 0) return null;

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* File count */}
      <div className="px-1 text-muted-foreground text-xs">
        {artifacts.length} {artifacts.length === 1 ? 'file' : 'files'}
      </div>

      {/* Artifact items - use EnhancedLink for consistent file handling */}
      <div className="space-y-0.5">
        {sortedArtifacts.map((artifact) => (
          <div className="px-1" key={artifact.id}>
            <EnhancedLink href={`file://${artifact.filePath}`}>{artifact.fileName}</EnhancedLink>
          </div>
        ))}
      </div>
    </div>
  );
});
