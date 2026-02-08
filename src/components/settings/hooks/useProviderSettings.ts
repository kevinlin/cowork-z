// apps/desktop/src/renderer/components/settings/hooks/useProviderSettings.ts

import { useCallback, useEffect, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { ConnectedProvider, ProviderId, ProviderSettings } from '@/shared';

export function useProviderSettings() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const api = getTauriAPI();
      const data = (await api.getProviderSettings()) as ProviderSettings;
      setSettings(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const setActiveProvider = useCallback(async (providerId: ProviderId | null) => {
    const api = getTauriAPI();
    await api.setActiveProvider(providerId);
    setSettings((prev) => (prev ? { ...prev, activeProviderId: providerId } : null));
  }, []);

  const connectProvider = useCallback(async (providerId: ProviderId, provider: ConnectedProvider) => {
    const api = getTauriAPI();
    await api.setConnectedProvider(providerId, provider);
    setSettings((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        connectedProviders: {
          ...prev.connectedProviders,
          [providerId]: provider,
        },
      };
    });
  }, []);

  const disconnectProvider = useCallback(async (providerId: ProviderId) => {
    const api = getTauriAPI();
    await api.removeConnectedProvider(providerId);
    setSettings((prev) => {
      if (!prev) return null;
      const { [providerId]: _, ...rest } = prev.connectedProviders;
      return {
        ...prev,
        connectedProviders: rest,
        activeProviderId: prev.activeProviderId === providerId ? null : prev.activeProviderId,
      };
    });
  }, []);

  const updateModel = useCallback(async (providerId: ProviderId, modelId: string | null) => {
    const api = getTauriAPI();
    await api.updateProviderModel(providerId, modelId);
    setSettings((prev) => {
      if (!prev) return null;
      const provider = prev.connectedProviders[providerId];
      if (!provider) return prev;
      return {
        ...prev,
        connectedProviders: {
          ...prev.connectedProviders,
          [providerId]: { ...provider, selectedModelId: modelId },
        },
      };
    });
  }, []);

  const setDebugMode = useCallback(async (enabled: boolean) => {
    const api = getTauriAPI();
    await api.setProviderDebugMode(enabled);
    setSettings((prev) => (prev ? { ...prev, debugMode: enabled } : null));
  }, []);

  return {
    settings,
    loading,
    error,
    refetch: fetchSettings,
    setActiveProvider,
    connectProvider,
    disconnectProvider,
    updateModel,
    setDebugMode,
  };
}
