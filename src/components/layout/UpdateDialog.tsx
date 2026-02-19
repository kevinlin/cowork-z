'use client';

import { CheckCircle, Download, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { UpdateStatus } from '@/hooks/useAppUpdate';
import type { UpdateInfo } from '@/lib/tauri-api';

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  onInstall: () => void;
  onRetry: () => void;
}

export default function UpdateDialog({ open, onOpenChange, status, updateInfo, error, onInstall, onRetry }: UpdateDialogProps) {
  const canClose = status !== 'downloading';

  return (
    <Dialog onOpenChange={canClose ? onOpenChange : undefined} open={open}>
      <DialogContent className="max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Software Update</DialogTitle>
        </DialogHeader>

        {/* Checking */}
        {status === 'checking' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">Checking for updates…</p>
          </div>
        )}

        {/* Up to date */}
        {status === 'up-to-date' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle className="h-8 w-8 text-green-500" />
            <p className="font-medium text-foreground">You're up to date!</p>
            <p className="text-muted-foreground text-sm">Cowork-Z is running the latest version.</p>
          </div>
        )}

        {/* Update available */}
        {status === 'available' && updateInfo && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Version {updateInfo.version} is available</p>
                <p className="text-muted-foreground text-sm">You're currently running v{updateInfo.currentVersion}</p>
              </div>
            </div>
            {updateInfo.body && (
              <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-3">
                <p className="whitespace-pre-wrap text-muted-foreground text-sm">{updateInfo.body}</p>
              </div>
            )}
          </div>
        )}

        {/* Downloading / installing */}
        {status === 'downloading' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-medium text-foreground">Downloading and installing…</p>
            <p className="text-muted-foreground text-sm">The app will restart automatically when complete.</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle className="h-8 w-8 text-destructive" />
            <p className="font-medium text-foreground">Update check failed</p>
            <p className="text-center text-muted-foreground text-sm">{error || 'An unknown error occurred.'}</p>
          </div>
        )}

        {/* Footer actions */}
        <DialogFooter>
          {status === 'available' && (
            <>
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Later
              </Button>
              <Button onClick={onInstall}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Update Now
              </Button>
            </>
          )}
          {status === 'up-to-date' && (
            <Button onClick={() => onOpenChange(false)} variant="outline">
              OK
            </Button>
          )}
          {status === 'error' && (
            <>
              <Button onClick={() => onOpenChange(false)} variant="outline">
                Close
              </Button>
              <Button onClick={onRetry} variant="default">
                Retry
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
