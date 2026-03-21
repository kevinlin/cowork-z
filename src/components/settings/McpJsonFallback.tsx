import { useCallback, useRef, useState } from 'react';
import type { McpServersConfig } from '@/shared';

/**
 * Validate that the parsed JSON conforms to the MCP servers config schema.
 * Throws a descriptive error if validation fails.
 */
export function validateMcpConfig(parsed: unknown): asserts parsed is McpServersConfig {
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

interface McpJsonFallbackProps {
  config: McpServersConfig;
  onChange: (newConfig: McpServersConfig) => void;
}

export function McpJsonFallback({ config, onChange }: McpJsonFallbackProps) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const saveConfig = useCallback(
    async (text: string) => {
      try {
        const parsed = JSON.parse(text);
        validateMcpConfig(parsed);
        setParseError(null);
        setSaving(true);
        onChange(parsed);
        setSaving(false);
      } catch (e) {
        setSaving(false);
        setParseError(e instanceof Error ? e.message : 'Invalid JSON');
      }
    },
    [onChange]
  );

  const handleTextChange = useCallback(
    (newText: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        saveConfig(newText);
      }, 500);
    },
    [saveConfig]
  );

  const defaultText = Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : '';

  return (
    <div className="space-y-3">
      <textarea
        className={`w-full rounded-lg border bg-background p-3 font-mono text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 ${
          parseError
            ? 'border-destructive focus:border-destructive focus:ring-destructive'
            : 'border-border focus:border-primary focus:ring-primary'
        }`}
        data-testid="settings-mcp-json-textarea"
        defaultValue={defaultText}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={`{\n  "filesystem": {\n    "type": "local",\n    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"]\n  }\n}`}
        ref={textareaRef}
        rows={8}
        spellCheck={false}
      />

      {parseError && (
        <p className="text-destructive text-sm" data-testid="settings-mcp-json-error">
          {parseError}
        </p>
      )}
      {saving && <span className="text-muted-foreground text-xs">Saving...</span>}
    </div>
  );
}
