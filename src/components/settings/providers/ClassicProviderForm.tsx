// apps/desktop/src/renderer/components/settings/providers/ClassicProviderForm.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ApiKeyCredentials, ConnectedProvider, ProviderId } from '@/shared';
import { DEFAULT_PROVIDERS, getDefaultModelForProvider, PROVIDER_META } from '@/shared';
// Import provider logos
import anthropicLogo from '/assets/ai-logos/anthropic.svg';
import deepseekLogo from '/assets/ai-logos/deepseek.svg';
import googleLogo from '/assets/ai-logos/google.svg';
import openaiLogo from '/assets/ai-logos/openai.svg';
import xaiLogo from '/assets/ai-logos/xai.svg';
import zaiLogo from '/assets/ai-logos/zai.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

const PROVIDER_LOGOS: Record<string, string> = {
  anthropic: anthropicLogo,
  openai: openaiLogo,
  google: googleLogo,
  xai: xaiLogo,
  deepseek: deepseekLogo,
  zai: zaiLogo,
};

interface ClassicProviderFormProps {
  providerId: ProviderId;
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function ClassicProviderForm({
  providerId,
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: ClassicProviderFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = PROVIDER_META[providerId];
  const providerConfig = DEFAULT_PROVIDERS.find((p) => p.id === providerId);
  const models =
    providerConfig?.models.map((m) => ({
      id: m.fullId,
      name: m.displayName,
    })) || [];
  const isConnected = connectedProvider?.connectionStatus === 'connected';
  const logoSrc = PROVIDER_LOGOS[providerId];

  const handleConnect = async () => {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      setError('Please enter an API key');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const accomplish = getAccomplish();
      const validation = await accomplish.validateApiKeyForProvider(providerId, trimmedKey);

      if (!validation.valid) {
        setError(validation.error || 'Invalid API key');
        setConnecting(false);
        return;
      }

      // Save the API key
      await accomplish.addApiKey(providerId as any, trimmedKey);

      // Get default model for this provider (if one exists)
      const defaultModel = getDefaultModelForProvider(providerId);

      // Create connected provider - store longer key prefix for display
      const provider: ConnectedProvider = {
        providerId,
        connectionStatus: 'connected',
        selectedModelId: defaultModel, // Auto-select default model for main providers
        credentials: {
          type: 'api_key',
          keyPrefix:
            trimmedKey.length > 40 ? trimmedKey.substring(0, 40) + '...' : trimmedKey.substring(0, Math.min(trimmedKey.length, 20)) + '...',
        } as ApiKeyCredentials,
        lastConnectedAt: new Date().toISOString(),
      };

      onConnect(provider);
      setApiKey('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={logoSrc} providerName={meta.name} />

      {/* API Key Section */}
      <div className="space-y-3">
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
              <input
                className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                data-testid="api-key-display"
                disabled
                type="text"
                value={(() => {
                  const creds = connectedProvider?.credentials as ApiKeyCredentials | undefined;
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
              {/* Disconnected: API Key input with trash */}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2.5 text-sm disabled:opacity-50"
                  data-testid="api-key-input"
                  disabled={connecting}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter API Key"
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
