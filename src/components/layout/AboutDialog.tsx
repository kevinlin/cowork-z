'use client';

import { useEffect, useState } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getVersion } from '@/lib/tauri-api';
import appIcon from '../../../src-tauri/icons/128x128.png';
import changelogRaw from '../../../UPDATE_LOG.md?raw';

const imageMap: Record<string, string> = {
  'src-tauri/icons/128x128.png': appIcon,
};

const markdownComponents: Components = {
  img: ({ src, alt, ...props }) => {
    const resolved = src && imageMap[src] ? imageMap[src] : src;
    return <img alt={alt} src={resolved} {...props} />;
  },
};

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      getVersion()
        .then(setVersion)
        .catch(() => setVersion(null));
    }
  }, [open]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About Cowork-Z</DialogTitle>
        </DialogHeader>

        {/* Version badge */}
        {version && (
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-primary text-sm">v{version}</span>
          </div>
        )}

        {/* Changelog */}
        <div className="max-h-[50vh] overflow-y-auto pr-2">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {changelogRaw}
            </ReactMarkdown>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
