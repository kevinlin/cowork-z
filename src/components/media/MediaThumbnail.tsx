/**
 * MediaThumbnail — fixed-size preview tile for images and videos.
 *
 * Uses Tauri's convertFileSrc() to securely load local files via
 * the asset protocol.  Shows an error state when loading fails.
 */

import { AlertCircle } from 'lucide-react';
import { memo, useState } from 'react';

import { analyzeFile } from '@/lib/file-utils';
import { getFileIcon } from '@/lib/icon-utils';
import { convertFileSrc } from '@/lib/tauri-api';
import { cn } from '@/lib/utils';

interface MediaThumbnailProps {
  /** Absolute path to the media file */
  filePath: string;
  /** Callback when the thumbnail is clicked (opens modal) */
  onClick: () => void;
}

const MediaThumbnail = memo(function MediaThumbnail({ filePath, onClick }: MediaThumbnailProps) {
  const [error, setError] = useState(false);
  const info = analyzeFile(filePath);
  const Icon = getFileIcon(info.category);
  const assetUrl = convertFileSrc(filePath);

  if (error) {
    return (
      <button
        className="flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted text-muted-foreground"
        onClick={onClick}
        title={filePath}
        type="button"
      >
        <AlertCircle className="h-6 w-6" />
        <span className="text-xs">Failed to load</span>
      </button>
    );
  }

  return (
    <button
      className={cn(
        'group/thumb relative h-32 w-32 overflow-hidden rounded-lg border border-border',
        'cursor-pointer transition-colors duration-150 hover:border-primary'
      )}
      onClick={onClick}
      title={filePath}
      type="button"
    >
      {info.category === 'video' ? (
        <video className="h-full w-full object-cover" muted onError={() => setError(true)} preload="metadata" src={assetUrl} />
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is a lifecycle event, not a user interaction
        <img alt={info.filename} className="h-full w-full object-cover" onError={() => setError(true)} src={assetUrl} />
      )}

      {/* Hover overlay with icon */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100">
        <Icon className="h-6 w-6 text-white" />
      </div>
    </button>
  );
});

export { MediaThumbnail };
