// apps/desktop/src/renderer/components/settings/shared/ConnectButton.tsx

import connectIcon from '/assets/icons/connect.svg';

interface ConnectButtonProps {
  onClick: () => void;
  connecting: boolean;
  disabled?: boolean;
}

export function ConnectButton({ onClick, connecting, disabled }: ConnectButtonProps) {
  return (
    <button
      className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 font-medium text-sm hover:bg-muted disabled:opacity-50"
      data-testid="connect-button"
      disabled={connecting || disabled}
      onClick={onClick}
    >
      {connecting ? (
        <>
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" />
          </svg>
          Connecting...
        </>
      ) : (
        <>
          <img alt="" className="h-4 w-4" src={connectIcon} />
          Connect
        </>
      )}
    </button>
  );
}
