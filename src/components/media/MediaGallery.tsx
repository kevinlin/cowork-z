/**
 * MediaGallery — renders thumbnail previews for media files
 * referenced in a chat message.
 *
 * Filters the provided paths to only previewable media (images/videos),
 * renders thumbnails, and manages a shared preview modal.
 */

import { useState } from 'react';

import { analyzeFile } from '@/lib/file-utils';

import { MediaPreviewModal } from './MediaPreviewModal';
import { MediaThumbnail } from './MediaThumbnail';

interface MediaGalleryProps {
  /** Array of absolute file paths extracted from the message content */
  filePaths: string[];
}

export function MediaGallery({ filePaths }: MediaGalleryProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // Filter to only previewable media
  const mediaPaths = filePaths.filter((p) => analyzeFile(p).previewable);

  if (mediaPaths.length === 0) return null;

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {mediaPaths.map((path) => (
          <MediaThumbnail filePath={path} key={path} onClick={() => setPreviewPath(path)} />
        ))}
      </div>

      <MediaPreviewModal
        filePath={previewPath}
        onOpenChange={(open) => {
          if (!open) setPreviewPath(null);
        }}
        open={previewPath !== null}
      />
    </>
  );
}
