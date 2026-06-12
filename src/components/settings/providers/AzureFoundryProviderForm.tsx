// apps/desktop/src/renderer/components/settings/providers/AzureFoundryProviderForm.tsx

import { useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { AzureFoundryCredentials, ConnectedProvider } from '@/shared';
// Import Azure logo
import azureLogo from '/assets/ai-logos/azure.svg';
import { ConnectButton, ConnectedControls, FormError, ModelSelector, ProviderFormHeader } from '../shared';

interface AzureFoundryProviderFormProps {
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function AzureFoundryProviderForm({
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: AzureFoundryProviderFormProps) {
  const [authType, setAuthType] = useState<'api-key' | 'entra-id'>('api-key');
  const [endpoint, setEndpoint] = useState('');
  const [deploymentName, setDeploymentName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = connectedProvider?.connectionStatus === 'connected';

  const handleConnect = async () => {
    if (!(endpoint.trim() && deploymentName.trim())) {
      setError('Endpoint URL and Deployment Name are required');
      return;
    }

    if (authType === 'api-key' && !apiKey.trim()) {
      setError('API Key is required for API Key authentication');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const api = getTauriAPI();

      // Validate connection
      const validation = await api.testAzureFoundryConnection({
        endpoint: endpoint.trim(),
        deploymentName: deploymentName.trim(),
        authType,
        apiKey: authType === 'api-key' ? apiKey.trim() : undefined,
      });

      if (!validation.success) {
        setError(validation.error || 'Connection failed');
        setConnecting(false);
        return;
      }

      // Save credentials
      await api.saveAzureFoundryConfig({
        endpoint: endpoint.trim(),
        deploymentName: deploymentName.trim(),
        authType,
        apiKey: authType === 'api-key' ? apiKey.trim() : undefined,
      });

      // Build the model entry - Azure Foundry uses deployment name as model
      const modelId = `azure-foundry/${deploymentName.trim()}`;
      const models = [{ id: modelId, name: deploymentName.trim() }];

      const provider: ConnectedProvider = {
        providerId: 'azure-foundry',
        connectionStatus: 'connected',
        selectedModelId: modelId, // Auto-select the deployment as model
        credentials: {
          type: 'azure-foundry',
          authMethod: authType,
          endpoint: endpoint.trim(),
          deploymentName: deploymentName.trim(),
          ...(authType === 'api-key' && apiKey ? { keyPrefix: apiKey.slice(0, 8) + '...' } : {}),
        } as AzureFoundryCredentials,
        lastConnectedAt: new Date().toISOString(),
        availableModels: models,
      };

      onConnect(provider);
      setApiKey(''); // Clear sensitive data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const models = connectedProvider?.availableModels || [];

  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="provider-settings-panel">
      <ProviderFormHeader logoSrc={azureLogo} providerName="Azure AI Foundry" />

      <div className="space-y-3">
        {isConnected ? (
          <>
            {/* Display saved credentials info */}
            <div className="space-y-3">
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">Endpoint</label>
                <input
                  className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                  disabled
                  type="text"
                  value={(connectedProvider?.credentials as AzureFoundryCredentials)?.endpoint || ''}
                />
              </div>
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">Deployment</label>
                <input
                  className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                  disabled
                  type="text"
                  value={(connectedProvider?.credentials as AzureFoundryCredentials)?.deploymentName || ''}
                />
              </div>
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">Authentication</label>
                <input
                  className="w-full rounded-md border border-input bg-muted/50 px-3 py-2.5 text-muted-foreground text-sm"
                  disabled
                  type="text"
                  value={
                    (connectedProvider?.credentials as AzureFoundryCredentials)?.authMethod === 'entra-id'
                      ? 'Entra ID (Azure CLI)'
                      : 'API Key'
                  }
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
          </>
        ) : (
          <>
            {/* Auth type tabs */}
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                  authType === 'api-key' ? 'bg-[#0078D4] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
                data-testid="azure-foundry-auth-api-key"
                onClick={() => setAuthType('api-key')}
              >
                API Key
              </button>
              <button
                className={`flex-1 rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                  authType === 'entra-id' ? 'bg-[#0078D4] text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
                data-testid="azure-foundry-auth-entra-id"
                onClick={() => setAuthType('entra-id')}
              >
                Entra ID
              </button>
            </div>

            {authType === 'entra-id' && (
              <p className="text-muted-foreground text-xs">
                Uses your Azure CLI credentials. Run <code className="rounded bg-muted px-1">az login</code> first.
              </p>
            )}

            {/* Endpoint URL */}
            <div>
              <label className="mb-2 block font-medium text-foreground text-sm">Azure OpenAI Endpoint</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                data-testid="azure-foundry-endpoint"
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://your-resource.openai.azure.com"
                type="text"
                value={endpoint}
              />
            </div>

            {/* Deployment Name */}
            <div>
              <label className="mb-2 block font-medium text-foreground text-sm">Deployment Name</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                data-testid="azure-foundry-deployment"
                onChange={(e) => setDeploymentName(e.target.value)}
                placeholder="e.g., gpt-4o, gpt-5"
                type="text"
                value={deploymentName}
              />
            </div>

            {/* API Key - only for API key auth */}
            {authType === 'api-key' && (
              <div>
                <label className="mb-2 block font-medium text-foreground text-sm">API Key</label>
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
                  data-testid="azure-foundry-api-key"
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your Azure API key"
                  type="password"
                  value={apiKey}
                />
              </div>
            )}

            <FormError error={error} />
            <ConnectButton connecting={connecting} onClick={handleConnect} />
          </>
        )}
      </div>
    </div>
  );
}
