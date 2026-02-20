'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac = /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_GROUPS = [
  {
    label: 'App',
    shortcuts: [
      { keys: [mod, ','], description: 'Settings' },
      { keys: [mod, 'N'], description: 'New Task' },
      { keys: [mod, 'K'], description: 'Task Launcher' },
      { keys: ['Shift', '?'], description: 'Shortcuts Help' },
    ],
  },
  {
    label: 'Chat',
    shortcuts: [
      { keys: ['Enter'], description: 'Send Message' },
      { keys: ['Shift', 'Enter'], description: 'New Line' },
      { keys: ['Esc'], description: 'Cancel Task' },
    ],
  },
];

export default function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">{group.label}</h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div className="flex items-center justify-between" key={shortcut.description}>
                    <span className="text-foreground text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs"
                          key={key}
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
