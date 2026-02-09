import { useCallback, useEffect, useRef, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { McpServersConfig } from '@/shared';

/**
 * Validate that the parsed JSON conforms to the MCP servers config schema.
 * Throws a descriptive error if validation fails.
 */
function validateMcpConfig(parsed: unknown): asserts parsed is McpServersConfig {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MCP config must be a JSON object');
  }

  for (const [name, config] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(`Server "${name}": must be an object`);
    }

    const cfg = config as Record<string, unknown>;
    if (cfg.type !== 'local' && cfg.type !== 'remote') {
      throw new Error(`Server "${name}": type must be "local" or "remote"`);
    }

    if (cfg.type === 'local') {
      if (!(cfg.command && Array.isArray(cfg.command)) || cfg.command.length === 0) {
        throw new Error(`Server "${name}": local servers require a non-empty command array`);
      }
    }

    if (cfg.type === 'remote') {
      if (!cfg.url || typeof cfg.url !== 'string') {
        throw new Error(`Server "${name}": remote servers require a url string`);
      }
    }
  }
}

interface McpServersSettingsProps {
  onLoad?: () => void;
}

export function McpServersSettings({ onLoad }: McpServersSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [configText, setConfigText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverSummary, setServerSummary] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const api = getTauriAPI();

  // Load persisted config on mount
  useEffect(() => {
    api.getMcpServersConfig().then((config) => {
      if (config && Object.keys(config).length > 0) {
        setEnabled(true);
        setConfigText(JSON.stringify(config, null, 2));
        setServerSummary(Object.entries(config).map(([name, cfg]) => `${name} (${cfg.type})`));
      }
      onLoad?.();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save — no React state update for the text while typing (read from ref)
  const saveConfig = useCallback(
    async (text: string) => {
      try {
        const parsed = JSON.parse(text);
        validateMcpConfig(parsed);
        setParseError(null);
        setServerSummary(
          Object.entries(parsed).map(([name, cfg]) => {
            const c = cfg as { type: string };
            return `${name} (${c.type})`;
          })
        );
        setSaving(true);
        await api.setMcpServersConfig(parsed);
        setSaving(false);
      } catch (e) {
        setSaving(false);
        setParseError(e instanceof Error ? e.message : 'Invalid JSON');
        setServerSummary([]);
      }
    },
    [api]
  );

  const handleTextChange = useCallback(
    (newText: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setConfigText(newText);
        saveConfig(newText);
      }, 500);
    },
    [saveConfig]
  );

  // Read latest text from the textarea ref to avoid stale state
  const handleToggle = useCallback(async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    if (newEnabled) {
      const currentText = textareaRef.current?.value ?? configText;
      if (currentText) {
        setConfigText(currentText);
        saveConfig(currentText);
      }
    } else {
      await api.setMcpServersConfig(null);
      setServerSummary([]);
      setParseError(null);
      setConfigText('');
    }
  }, [enabled, configText, api, saveConfig]);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium text-foreground">MCP Servers</div>
          <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
            Configure{' '}
            <a
              className="text-primary hover:underline"
              href="https://opencode.ai/docs/mcp-servers/"
              rel="noopener noreferrer"
              target="_blank"
            >
              MCP servers
            </a>{' '}
            to extend the agent with additional tools.
          </p>
        </div>
        <div className="ml-4">
          <button
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
              enabled ? 'bg-primary' : 'bg-muted'
            }`}
            data-testid="settings-mcp-toggle"
            onClick={handleToggle}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {enabled && (
        <div className="mt-4 space-y-3">
          <textarea
            className={`w-full rounded-lg border bg-background p-3 font-mono text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 ${
              parseError
                ? 'border-destructive focus:border-destructive focus:ring-destructive'
                : 'border-border focus:border-primary focus:ring-primary'
            }`}
            data-testid="settings-mcp-textarea"
            defaultValue={configText}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={`{\n  "filesystem": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"]\n  }\n}`}
            ref={textareaRef}
            rows={8}
            spellCheck={false}
          />

          {parseError && (
            <p className="text-destructive text-sm" data-testid="settings-mcp-error">
              {parseError}
            </p>
          )}

          {!parseError && serverSummary.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {serverSummary.map((s) => (
                <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground text-xs" key={s}>
                  {s}
                </span>
              ))}
              {saving && <span className="text-muted-foreground text-xs">Saving...</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
