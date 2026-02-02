// apps/desktop/src/renderer/components/settings/providers/OllamaProviderForm.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { getAccomplish } from '@/lib/accomplish';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ConnectedProvider, OllamaCredentials } from '@/shared';
// Import Ollama logo
import ollamaLogo from '/assets/ai-logos/ollama.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

interface OllamaProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function OllamaProviderForm({ connectedProvider, onConnect, onDisconnect, onModelChange, showModelError }: OllamaProviderFormProps) {
  const [serverUrl, setServerUrl] = useState('http://localhost:11434');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const accomplish = getAccomplish();
      const result = await accomplish.testOllamaConnection(serverUrl);

      if (!result.success) {
        setError(result.error || 'Connection failed');
        setConnecting(false);
        return;
      }

      const models =
        result.models?.map((m) => ({
          id: `ollama/${m.id}`,
          name: m.displayName,
        })) || [];
      setAvailableModels(models);

      const provider: ConnectedProvider = {
        providerId: 'ollama',
        connectionStatus: 'connected',
        selectedModelId: null,
        credentials: {
          type: 'ollama',
          serverUrl,
        } as OllamaCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: models,
      };

      onConnect(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || availableModels;

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={ollamaLogo} providerName="Ollama" />

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
              {/* Display saved server URL */}
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">Ollama Server URL</label>
                <input
                  className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                  disabled
                  type="text"
                  value={(connectedProvider?.credentials as OllamaCredentials)?.serverUrl || 'http://localhost:11434'}
                />
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
                <label className="mb-2 block font-medium text-foreground text-sm">Ollama Server URL</label>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                  data-testid="ollama-server-url"
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  type="text"
                  value={serverUrl}
                />
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
