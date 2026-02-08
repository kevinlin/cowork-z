// apps/desktop/src/renderer/components/settings/providers/BedrockProviderForm.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { BedrockProviderCredentials, ConnectedProvider } from '@/shared';
import { getDefaultModelForProvider } from '@/shared';
// Import Bedrock logo
import bedrockLogo from '/assets/ai-logos/bedrock.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader, RegionSelector } from '../shared';

interface BedrockProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function BedrockProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: BedrockProviderFormProps) {
  const [authTab, setAuthTab] = useState<'accessKey' | 'profile'>('accessKey');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [profileName, setProfileName] = useState('default');
  const [region, setRegion] = useState('us-east-1');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const api = getTauriAPI();

      const credentials =
        authTab === 'accessKey'
          ? {
              authType: 'accessKeys' as const,
              accessKeyId: accessKeyId.trim(),
              secretAccessKey: secretKey.trim(),
              sessionToken: sessionToken.trim() || undefined,
              region,
            }
          : {
              authType: 'profile' as const,
              profileName: profileName.trim() || 'default',
              region,
            };

      const validation = await api.validateBedrockCredentials(credentials);

      if (!validation.valid) {
        setError(validation.error || 'Invalid credentials');
        setConnecting(false);
        return;
      }

      // Save credentials
      await api.saveBedrockCredentials(credentials);

      // Fetch available models dynamically from AWS
      const credentialsJson = JSON.stringify(credentials);
      const modelsResult = await api.fetchBedrockModels(credentialsJson);
      const fetchedModels = modelsResult.success ? modelsResult.models : [];
      setAvailableModels(fetchedModels);

      // Auto-select default model if available in fetched list
      const defaultModelId = getDefaultModelForProvider('bedrock');
      const hasDefaultModel = defaultModelId && fetchedModels.some((m) => m.id === defaultModelId);

      const provider: ConnectedProvider = {
        providerId: 'bedrock',
        connectionStatus: 'connected',
        selectedModelId: hasDefaultModel ? defaultModelId : null,
        credentials: {
          type: 'bedrock',
          authMethod: authTab,
          region,
          ...(authTab === 'accessKey'
            ? { accessKeyIdPrefix: accessKeyId.substring(0, 8) + '...' }
            : { profileName: profileName.trim() || 'default' }),
        } as BedrockProviderCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: fetchedModels,
      };

      onConnect(provider);
      setSecretKey('');
      setSessionToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || availableModels;

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={bedrockLogo} providerName="Bedrock" />

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
              {/* Display saved credentials info */}
              <div className="space-y-3">
                {(connectedProvider?.credentials as BedrockProviderCredentials)?.authMethod === 'accessKey' ? (
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">Access Key ID</label>
                    <input
                      className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                      disabled
                      type="text"
                      value={(connectedProvider?.credentials as BedrockProviderCredentials)?.accessKeyIdPrefix || 'AKIA...'}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">AWS Profile</label>
                    <input
                      className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                      disabled
                      type="text"
                      value={(connectedProvider?.credentials as BedrockProviderCredentials)?.profileName || 'default'}
                    />
                  </div>
                )}
                <div>
                  <label className="mb-2 block font-medium text-foreground text-sm">Region</label>
                  <input
                    className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                    disabled
                    type="text"
                    value={(connectedProvider?.credentials as BedrockProviderCredentials)?.region || 'us-east-1'}
                  />
                </div>
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
              {/* Auth tabs */}
              <div className="flex gap-2">
                <button
                  className={`flex-1 rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                    authTab === 'accessKey' ? 'bg-[#4A7C59] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setAuthTab('accessKey')}
                >
                  Access Key
                </button>
                <button
                  className={`flex-1 rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                    authTab === 'profile' ? 'bg-[#4A7C59] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setAuthTab('profile')}
                >
                  AWS Profile
                </button>
              </div>

              {authTab === 'accessKey' ? (
                <>
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">Access Key ID</label>
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                      data-testid="bedrock-access-key-id"
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      placeholder="AKIA..."
                      type="text"
                      value={accessKeyId}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">Secret Access Key</label>
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                      data-testid="bedrock-secret-key"
                      onChange={(e) => setSecretKey(e.target.value)}
                      placeholder="Enter secret access key"
                      type="password"
                      value={secretKey}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block font-medium text-foreground text-sm">
                      Session Token <span className="text-muted-foreground">(Optional)</span>
                    </label>
                    <input
                      className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                      data-testid="bedrock-session-token"
                      onChange={(e) => setSessionToken(e.target.value)}
                      placeholder="For temporary credentials"
                      type="password"
                      value={sessionToken}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-2 block font-medium text-foreground text-sm">Profile Name</label>
                  <input
                    className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                    data-testid="bedrock-profile-name"
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="default"
                    type="text"
                    value={profileName}
                  />
                </div>
              )}

              <RegionSelector onChange={setRegion} value={region} />

              <FormError error={error} />
              <ConnectButton connecting={connecting} onClick={handleConnect} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
