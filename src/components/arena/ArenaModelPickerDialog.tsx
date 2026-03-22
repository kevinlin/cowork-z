'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useProviderSettings } from '@/components/settings/hooks/useProviderSettings';
import { ProviderGrid } from '@/components/settings/ProviderGrid';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ConnectedProvider, ProviderId } from '@/shared';
import { isProviderReady } from '@/shared';

interface ArenaModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnIndex: 0 | 1 | 2;
  onModelSelected: (modelId: string, displayName: string) => void;
}

export function ArenaModelPickerDialog({ open, onOpenChange, columnIndex, onModelSelected }: ArenaModelPickerDialogProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [gridExpanded, setGridExpanded] = useState(false);
  const [showModelError, setShowModelError] = useState(false);

  const { settings, loading, setActiveProvider, connectProvider, disconnectProvider, updateModel, refetch } = useProviderSettings();

  // Refetch settings when dialog opens
  useEffect(() => {
    if (open) {
      refetch();
      setSelectedProvider(null);
      setGridExpanded(false);
      setShowModelError(false);
    }
  }, [open, refetch]);

  const handleSelectProvider = useCallback(
    async (providerId: ProviderId) => {
      setSelectedProvider(providerId);
      setShowModelError(false);

      const provider = settings?.connectedProviders?.[providerId];
      if (provider && isProviderReady(provider)) {
        await setActiveProvider(providerId);
      }
    },
    [settings?.connectedProviders, setActiveProvider]
  );

  const handleConnect = useCallback(
    async (provider: ConnectedProvider) => {
      await connectProvider(provider.providerId, provider);
      if (isProviderReady(provider)) {
        await setActiveProvider(provider.providerId);
      }
    },
    [connectProvider, setActiveProvider]
  );

  const handleDisconnect = useCallback(async () => {
    if (!selectedProvider) return;
    await disconnectProvider(selectedProvider);
    setSelectedProvider(null);
  }, [selectedProvider, disconnectProvider]);

  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!selectedProvider) return;
      await updateModel(selectedProvider, modelId);
      setShowModelError(false);
    },
    [selectedProvider, updateModel]
  );

  const handleDone = useCallback(() => {
    if (!(selectedProvider && settings)) {
      setShowModelError(true);
      return;
    }

    const provider = settings.connectedProviders[selectedProvider];
    if (!provider?.selectedModelId) {
      setShowModelError(true);
      return;
    }

    // Build the full model ID and display name
    const modelId = provider.selectedModelId;
    const displayName =
      provider.availableModels?.find((m) => m.id === modelId || `${selectedProvider}/${m.id}` === modelId)?.name ??
      modelId.split('/').pop() ??
      modelId;

    // Ensure model ID has provider prefix
    const fullModelId = modelId.includes('/') ? modelId : `${selectedProvider}/${modelId}`;

    onModelSelected(fullModelId, displayName);
    onOpenChange(false);
  }, [selectedProvider, settings, onModelSelected, onOpenChange]);

  if (loading || !settings) {
    return (
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Select model for Column {columnIndex + 1}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Select model for Column {columnIndex + 1}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 px-6 pb-6">
          {/* Provider Grid */}
          <section>
            <ProviderGrid
              expanded={gridExpanded}
              onSelectProvider={handleSelectProvider}
              onToggleExpanded={() => setGridExpanded(!gridExpanded)}
              selectedProvider={selectedProvider}
              settings={settings}
            />
          </section>

          {/* Provider Settings Panel (shown when a provider is selected) */}
          <AnimatePresence>
            {selectedProvider && (
              <motion.section
                animate="animate"
                exit="exit"
                initial="initial"
                transition={settingsTransitions.enter}
                variants={settingsVariants.slideDown}
              >
                <ProviderSettingsPanel
                  connectedProvider={settings?.connectedProviders?.[selectedProvider]}
                  key={selectedProvider}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                  onModelChange={handleModelChange}
                  providerId={selectedProvider}
                  showModelError={showModelError}
                />
              </motion.section>
            )}
          </AnimatePresence>

          {/* Done Button */}
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!selectedProvider} onClick={handleDone}>
              Select Model
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
