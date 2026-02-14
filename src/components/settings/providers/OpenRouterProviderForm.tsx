// apps/desktop/src/renderer/components/settings/providers/OpenRouterProviderForm.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { ConnectedProvider, OpenRouterCredentials } from '@/shared';
import { PROVIDER_META } from '@/shared';
// Import OpenRouter logo
import openrouterLogo from '/assets/ai-logos/openrouter.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

interface OpenRouterProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function OpenRouterProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: OpenRouterProviderFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);

  const meta = PROVIDER_META.openrouter;
  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const api = getTauriAPI();

      // Validate key
      const validation = await api.validateApiKeyForProvider('openrouter', apiKey.trim());
      if (!validation.valid) {
        setError(validation.error || 'Invalid API key');
        setConnecting(false);
        return;
      }

      // Save key
      await api.addApiKey('openrouter', apiKey.trim());

      // Fetch models
      const result = await api.fetchProviderModels('openrouter');
      if (!result.success) {
        setError(result.error || 'Failed to fetch models');
        setConnecting(false);
        return;
      }

      const models =
        result.models?.map((m) => ({
          id: `openrouter/${m.id}`,
          name: m.name,
        })) || [];
      setAvailableModels(models);

      // Store longer key prefix for display
      const trimmedKey = apiKey.trim();
      const provider: ConnectedProvider = {
        providerId: 'openrouter',
        connectionStatus: 'connected',
        selectedModelId: null,
        credentials: {
          type: 'openrouter',
          keyPrefix:
            trimmedKey.length > 40 ? trimmedKey.substring(0, 40) + '...' : trimmedKey.substring(0, Math.min(trimmedKey.length, 20)) + '...',
        } as OpenRouterCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: models,
      };

      onConnect(provider);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || availableModels;

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={openrouterLogo} providerName="OpenRouter" />

      <div className="space-y-3">
        <AnimatePresence mode="wait">
          {isConnected ? (
            <motion.div
              animate="animate"
              className="space-y-3"
              exit="exit"
              initial="initial"
              key="connected"
              transition={settingsTransitions.enter}
              variants={settingsVariants.fadeSlide}
            >
              {/* Connected: Show masked key + Connected button + Model */}
              <div className="flex items-center justify-between">
                <label className="font-medium text-foreground text-sm">API Key</label>
                {meta.helpUrl && (
                  <a
                    className="text-muted-foreground text-sm underline hover:text-primary"
                    href={meta.helpUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    How can I find it?
                  </a>
                )}
              </div>

              <input
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                data-testid="api-key-display"
                disabled
                type="text"
                value={(() => {
                  const creds = connectedProvider?.credentials as OpenRouterCredentials | undefined;
                  if (creds?.keyPrefix) return creds.keyPrefix;
                  return 'API key saved (reconnect to see prefix)';
                })()}
              />

              <ConnectedControls onDisconnect={onDisconnect} />

              {/* Model Selector */}
              <ModelSelector
                error={showModelError && !connectedProvider?.selectedModelId}
                models={models}
                onChange={onModelChange}
                value={connectedProvider?.selectedModelId || null}
              />
            </motion.div>
          ) : (
            <motion.div
              animate="animate"
              className="space-y-3"
              exit="exit"
              initial="initial"
              key="disconnected"
              transition={settingsTransitions.enter}
              variants={settingsVariants.fadeSlide}
            >
              {/* API Key Section */}
              <div className="flex items-center justify-between">
                <label className="font-medium text-foreground text-sm">API Key</label>
                {meta.helpUrl && (
                  <a
                    className="text-muted-foreground text-sm underline hover:text-primary"
                    href={meta.helpUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    How can I find it?
                  </a>
                )}
              </div>

              {/* API Key input with trash */}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2.5 text-sm disabled:opacity-50"
                  data-testid="api-key-input"
                  disabled={connecting}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  type="password"
                  value={apiKey}
                />
                <button
                  className="rounded-md border border-border p-2.5 text-muted-foreground transition-colors hover:text-foreground"
                  disabled={!apiKey}
                  onClick={() => setApiKey('')}
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
              </div>

              <FormError error={error} />
              <ConnectButton connecting={connecting} disabled={!apiKey.trim()} onClick={handleConnect} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
