// apps/desktop/src/renderer/components/settings/shared/ApiKeyInput.tsx

interface ApiKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  helpUrl?: string;
  error?: string | null;
  disabled?: boolean;
}

export function ApiKeyInput({
  value,
  onChange,
  placeholder = 'Enter API Key',
  label = 'API Key',
  helpUrl,
  error,
  disabled,
}: ApiKeyInputProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="font-medium text-foreground text-sm">{label}</label>
        {helpUrl && (
          <a className="text-muted-foreground text-sm hover:text-primary" href={helpUrl} rel="noopener noreferrer" target="_blank">
            How can I find it?
          </a>
        )}
      </div>
      <div className="relative">
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 pr-10 text-sm disabled:opacity-50"
          data-testid="api-key-input"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type="password"
          value={value}
        />
        {value && (
          <button
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onChange('')}
            type="button"
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
      {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
    </div>
  );
}
