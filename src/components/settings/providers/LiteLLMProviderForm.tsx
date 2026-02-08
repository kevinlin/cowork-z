// apps/desktop/src/renderer/components/settings/providers/LiteLLMProviderForm.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ConnectedProvider, LiteLLMCredentials } from '@/shared';
// Import LiteLLM logo
import litellmLogo from '/assets/ai-logos/litellm.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

interface LiteLLMProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function LiteLLMProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: LiteLLMProviderFormProps) {
  const [serverUrl, setServerUrl] = useState('http://localhost:4000');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const api = getTauriAPI();
      const trimmedKey = apiKey.trim() || undefined;

      // Test connection and fetch models
      const result = await api.testLiteLLMConnection(serverUrl, trimmedKey);
      if (!result.success) {
        setError(result.error || 'Connection failed');
        setConnecting(false);
        return;
      }

      // Save or remove API key based on user input
      if (trimmedKey) {
        await api.addApiKey('litellm', trimmedKey);
      } else {
        // Remove any previously stored key when connecting without one
        await api.removeApiKey('litellm');
      }

      // Map models to the expected format
      const models =
        result.models?.map((m) => ({
          id: m.id,
          name: m.name,
        })) || [];

      const provider: ConnectedProvider = {
        providerId: 'litellm',
        connectionStatus: 'connected',
        selectedModelId: null,
        credentials: {
          type: 'litellm',
          serverUrl,
          hasApiKey: !!trimmedKey,
          keyPrefix: trimmedKey ? trimmedKey.substring(0, 10) + '...' : undefined,
        } as LiteLLMCredentials,
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

  const models = connectedProvider?.availableModels || [];

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={litellmLogo} providerName="LiteLLM" />

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
              {/* Display saved connection details */}
              <div className="space-y-3">
                <div>
                  <label className="mb-2 block font-medium text-foreground text-sm">Server URL</label>
                  <input
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                    disabled
                    type="text"
                    value={(connectedProvider?.credentials as LiteLLMCredentials)?.serverUrl || 'http://localhost:4000'}
                  />
                </div>
                {(connectedProvider?.credentials as LiteLLMCredentials)?.hasApiKey && (
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">API Key</label>
                    <input
                      className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                      disabled
                      type="text"
                      value={(connectedProvider?.credentials as LiteLLMCredentials)?.keyPrefix || 'API key saved'}
                    />
                  </div>
                )}
              </div>

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
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">Server URL</label>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                  data-testid="litellm-server-url"
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:4000"
                  type="text"
                  value={serverUrl}
                />
              </div>

              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">
                  API Key <span className="text-muted-foreground">(Optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                    data-testid="litellm-api-key"
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Optional API key"
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
              </div>

              <FormError error={error} />
              <ConnectButton connecting={connecting} onClick={handleConnect} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
