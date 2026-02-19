'use client';

import { AlertTriangle, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface OpenCodeCliMissingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INSTALL_COMMAND = 'npm install -g opencode-ai';
const DOCS_URL = 'https://opencode.ai/docs';

export default function OpenCodeCliMissingDialog({ open, onOpenChange }: OpenCodeCliMissingDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — ignore silently
    }
  }, []);

  const handleOpenDocs = useCallback(async () => {
    const { openExternal } = await import('@/lib/tauri-api');
    await openExternal(DOCS_URL);
  }, []);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <DialogTitle>OpenCode CLI Not Found</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            The OpenCode CLI is required to run tasks. It could not be found on your system PATH.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Install command */}
          <div>
            <p className="mb-2 font-medium text-foreground text-sm">Install with npm:</p>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
              <code className="flex-1 font-mono text-sm">{INSTALL_COMMAND}</code>
              <Button className="h-7 w-7 shrink-0" onClick={handleCopy} size="icon" title="Copy to clipboard" variant="ghost">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {copied && <p className="mt-1 text-muted-foreground text-xs">Copied to clipboard</p>}
          </div>

          {/* Help text */}
          <p className="text-muted-foreground text-sm">After installing, you may need to restart Cowork-Z for the CLI to be detected.</p>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button className="gap-1.5 text-muted-foreground" onClick={handleOpenDocs} size="sm" variant="link">
              <ExternalLink className="h-3.5 w-3.5" />
              OpenCode Docs
            </Button>
            <Button onClick={() => onOpenChange(false)} size="sm">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
