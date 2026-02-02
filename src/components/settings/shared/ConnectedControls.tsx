// apps/desktop/src/renderer/components/settings/shared/ConnectedControls.tsx

import connectedIcon from '/assets/icons/connected.svg';

interface ConnectedControlsProps {
  onDisconnect: () => void;
}

export function ConnectedControls({ onDisconnect }: ConnectedControlsProps) {
  return (
    <div className="flex gap-4">
      <button
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#e6e3dd] bg-[#e9f7e7] px-4 py-2.5 font-semibold text-[#244325] text-sm shadow-sm"
        disabled
      >
        <img alt="" className="h-4 w-4" src={connectedIcon} />
        Connected
      </button>
      <button
        className="rounded-lg border border-[#d7d3ca] bg-[#f9f8f6] p-2.5 text-muted-foreground shadow-sm transition-colors hover:bg-destructive/10 hover:text-destructive"
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
    </div>
  );
}
