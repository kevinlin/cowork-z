// apps/desktop/src/renderer/components/settings/shared/ConnectionStatus.tsx

import type { ConnectionStatus as ConnectionStatusType } from '@/shared';

interface ConnectionStatusProps {
  status: ConnectionStatusType;
  onDisconnect?: () => void;
}

export function ConnectionStatus({ status, onDisconnect }: ConnectionStatusProps) {
  if (status === 'disconnected') {
    return null;
  }

  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
        </svg>
        Connecting...
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2 text-destructive text-sm">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
        An error has occurred
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#4A7C59] px-4 py-2.5 font-medium text-sm text-white"
        disabled
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
        Connected
      </button>
      {onDisconnect && (
        <button
          className="rounded-md border border-border p-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          data-testid="disconnect-button"
          onClick={onDisconnect}
          title="Disconnect"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </button>
      )}
    </div>
  );
}
