/**
 * MediaPreviewModal — full-screen preview for images and videos.
 *
 * Renders inside the shared Dialog component.  Provides a
 * "Show in Finder" button and keyboard shortcut (ESC) to close.
 */

import { ExternalLink } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { analyzeFile } from '@/lib/file-utils';
import * as api from '@/lib/tauri-api';
import { convertFileSrc } from '@/lib/tauri-api';

interface MediaPreviewModalProps {
  /** Path to the media file, or null when closed */
  filePath: string | null;
  /** Whether the modal is open */
  open: boolean;
  /** Callback to change open state */
  onOpenChange: (open: boolean) => void;
}

export function MediaPreviewModal({ filePath, open, onOpenChange }: MediaPreviewModalProps) {
  const info = filePath ? analyzeFile(filePath) : null;
  const assetUrl = filePath ? convertFileSrc(filePath) : '';

  const handleReveal = useCallback(async () => {
    if (!filePath) return;
    try {
      await api.revealInFinder(filePath);
    } catch (err) {
      console.error('[MediaPreviewModal] Failed to reveal in Finder:', err);
    }
  }, [filePath]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="truncate text-base">{info?.filename ?? 'Preview'}</DialogTitle>
            <Button className="shrink-0 gap-1.5" onClick={handleReveal} size="sm" variant="outline">
              <ExternalLink className="h-3.5 w-3.5" />
              Show in Finder
            </Button>
          </div>
        </DialogHeader>

        <div className="flex items-center justify-center rounded-lg bg-black/5 p-2 dark:bg-white/5">
          {info?.category === 'video' ? (
            <video className="max-h-[70vh] rounded-lg object-contain" controls src={assetUrl}>
              <track kind="captions" />
            </video>
          ) : (
            <img alt={info?.filename ?? 'Preview'} className="max-h-[70vh] rounded-lg object-contain" src={assetUrl} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
