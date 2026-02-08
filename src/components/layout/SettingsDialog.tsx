'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useProviderSettings } from '@/components/settings/hooks/useProviderSettings';
import { ProviderGrid } from '@/components/settings/ProviderGrid';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccomplish } from '@/lib/accomplish';
import { analytics } from '@/lib/analytics';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import { getHomeDir, revealInFinder } from '@/lib/tauri-api';
import type { ConnectedProvider, ProviderId } from '@/shared';
import { hasAnyReadyProvider, isProviderReady } from '@/shared';

// First 4 providers shown in collapsed view (matches PROVIDER_ORDER in ProviderGrid)
const FIRST_FOUR_PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'google', 'bedrock'];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApiKeySaved?: () => void;
}

export default function SettingsDialog({ open, onOpenChange, onApiKeySaved }: SettingsDialogProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [gridExpanded, setGridExpanded] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);
  const [showModelError, setShowModelError] = useState(false);

  const { settings, loading, setActiveProvider, connectProvider, disconnectProvider, updateModel, refetch } = useProviderSettings();

  // Debug mode state - stored in appSettings, not providerSettings
  const [debugMode, setDebugModeState] = useState(false);
  const [skillsFolderPath, setSkillsFolderPath] = useState<string | null>(null);
  const accomplish = getAccomplish();

  // Resolve skills folder path on mount
  useEffect(() => {
    getHomeDir().then((home) => {
      const normalizedHome = home.endsWith('/') ? home : `${home}/`;
      setSkillsFolderPath(`${normalizedHome}.config/opencode/skills`);
    });
  }, []);

  // Refetch settings and debug mode when dialog opens
  useEffect(() => {
    if (!open) return;
    refetch();
    // Load debug mode from appSettings (correct store)
    accomplish.getDebugMode().then(setDebugModeState);
  }, [open, refetch, accomplish]);

  // Auto-select active provider and expand grid if needed when dialog opens
  useEffect(() => {
    if (!open || loading || !settings?.activeProviderId) return;

    // Auto-select the active provider to show its connection details immediately
    setSelectedProvider(settings.activeProviderId);

    // Auto-expand grid if active provider is not in the first 4 visible providers
    if (!FIRST_FOUR_PROVIDERS.includes(settings.activeProviderId)) {
      setGridExpanded(true);
    }
  }, [open, loading, settings?.activeProviderId]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedProvider(null);
      setGridExpanded(false);
      setCloseWarning(false);
      setShowModelError(false);
    }
  }, [open]);

  // Handle close attempt
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && settings) {
        // Check if user is trying to close
        if (!hasAnyReadyProvider(settings)) {
          // No ready provider - show warning
          setCloseWarning(true);
          return;
        }
      }
      setCloseWarning(false);
      onOpenChange(newOpen);
    },
    [settings, onOpenChange]
  );

  // Handle provider selection
  const handleSelectProvider = useCallback(
    async (providerId: ProviderId) => {
      setSelectedProvider(providerId);
      setCloseWarning(false);
      setShowModelError(false);

      // Auto-set as active if the selected provider is ready
      const provider = settings?.connectedProviders?.[providerId];
      if (provider && isProviderReady(provider)) {
        await setActiveProvider(providerId);
      }
    },
    [settings?.connectedProviders, setActiveProvider]
  );

  // Handle provider connection
  const handleConnect = useCallback(
    async (provider: ConnectedProvider) => {
      await connectProvider(provider.providerId, provider);
      analytics.trackSaveApiKey(provider.providerId);

      // Auto-set as active if the new provider is ready (connected + has model selected)
      // This ensures newly connected ready providers become active, regardless of
      // whether another provider was already active
      if (isProviderReady(provider)) {
        await setActiveProvider(provider.providerId);
        onApiKeySaved?.();
      }
    },
    [connectProvider, setActiveProvider, onApiKeySaved]
  );

  // Handle provider disconnection
  const handleDisconnect = useCallback(async () => {
    if (!selectedProvider) return;
    const wasActiveProvider = settings?.activeProviderId === selectedProvider;
    await disconnectProvider(selectedProvider);
    setSelectedProvider(null);

    // If we just removed the active provider, auto-select another ready provider
    if (wasActiveProvider && settings?.connectedProviders) {
      const readyProviderId = Object.keys(settings.connectedProviders).find(
        (id) => id !== selectedProvider && isProviderReady(settings.connectedProviders[id as ProviderId])
      ) as ProviderId | undefined;
      if (readyProviderId) {
        await setActiveProvider(readyProviderId);
      }
    }
  }, [selectedProvider, disconnectProvider, settings?.activeProviderId, settings?.connectedProviders, setActiveProvider]);

  // Handle model change
  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!selectedProvider) return;
      await updateModel(selectedProvider, modelId);
      analytics.trackSelectModel(modelId);

      // Auto-set as active if this provider is now ready
      const provider = settings?.connectedProviders[selectedProvider];
      if (
        provider &&
        isProviderReady({ ...provider, selectedModelId: modelId }) &&
        (!settings?.activeProviderId || settings.activeProviderId !== selectedProvider)
      ) {
        await setActiveProvider(selectedProvider);
      }

      setShowModelError(false);
      onApiKeySaved?.();
    },
    [selectedProvider, updateModel, settings, setActiveProvider, onApiKeySaved]
  );

  // Handle debug mode toggle - writes to appSettings (correct store)
  const handleDebugToggle = useCallback(async () => {
    const newValue = !debugMode;
    await accomplish.setDebugMode(newValue);
    setDebugModeState(newValue);
    analytics.trackToggleDebugMode(newValue);
  }, [debugMode, accomplish]);

  // Handle done button (close with validation)
  const handleDone = useCallback(() => {
    if (!settings) return;

    // Check if selected provider needs a model
    if (selectedProvider) {
      const provider = settings.connectedProviders[selectedProvider];
      if (provider?.connectionStatus === 'connected' && !provider.selectedModelId) {
        setShowModelError(true);
        return;
      }
    }

    // Check if any provider is ready
    if (!hasAnyReadyProvider(settings)) {
      setCloseWarning(true);
      return;
    }

    // Validate active provider is still connected and ready
    // This handles the case where the active provider was removed
    if (settings.activeProviderId) {
      const activeProvider = settings.connectedProviders[settings.activeProviderId];
      if (!isProviderReady(activeProvider)) {
        // Active provider is no longer ready - find a ready provider to set as active
        const readyProviderId = Object.keys(settings.connectedProviders).find((id) =>
          isProviderReady(settings.connectedProviders[id as ProviderId])
        ) as ProviderId | undefined;
        if (readyProviderId) {
          setActiveProvider(readyProviderId);
        }
      }
    } else {
      // No active provider set - auto-select first ready provider
      const readyProviderId = Object.keys(settings.connectedProviders).find((id) =>
        isProviderReady(settings.connectedProviders[id as ProviderId])
      ) as ProviderId | undefined;
      if (readyProviderId) {
        setActiveProvider(readyProviderId);
      }
    }

    onOpenChange(false);
  }, [settings, selectedProvider, onOpenChange, setActiveProvider]);

  // Force close (dismiss warning)
  const handleForceClose = useCallback(() => {
    setCloseWarning(false);
    onOpenChange(false);
  }, [onOpenChange]);

  if (loading || !settings) {
    return (
      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="settings-dialog">
          <DialogHeader>
            <DialogTitle>Set up Openwork</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Set up Openwork</DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Close Warning */}
          <AnimatePresence>
            {closeWarning && (
              <motion.div
                animate="animate"
                className="rounded-lg border border-warning bg-warning/10 p-4"
                exit="exit"
                initial="initial"
                transition={settingsTransitions.enter}
                variants={settingsVariants.fadeSlide}
              >
                <div className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-medium text-sm text-warning">No provider ready</p>
                    <p className="mt-1 text-muted-foreground text-sm">
                      You need to connect a provider and select a model before you can run tasks.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-md bg-muted px-3 py-1.5 font-medium text-muted-foreground text-sm hover:bg-muted/80"
                        onClick={handleForceClose}
                      >
                        Close Anyway
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Provider Grid Section */}
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

          {/* Skills Folder Section - only shown when a provider is selected */}
          <AnimatePresence>
            {selectedProvider && skillsFolderPath && (
              <motion.section
                animate="animate"
                exit="exit"
                initial="initial"
                transition={{ ...settingsTransitions.enter, delay: 0.1 }}
                variants={settingsVariants.slideDown}
              >
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="font-medium text-foreground">Skills Folder</div>
                  <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
                    Place skills folder containing <code className="rounded bg-muted px-1 py-0.5 text-xs">SKILL.md</code> files here for the agent to discover
                    automatically.
                  </p>
                  <button
                    className="mt-3 inline-flex items-center gap-1.5 text-primary text-sm hover:underline"
                    onClick={() => revealInFinder(skillsFolderPath)}
                  >
                    <span className="truncate">~/.config/opencode/skills</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Debug Mode Section - only shown when a provider is selected */}
          <AnimatePresence>
            {selectedProvider && (
              <motion.section
                animate="animate"
                exit="exit"
                initial="initial"
                transition={{ ...settingsTransitions.enter, delay: 0.05 }}
                variants={settingsVariants.slideDown}
              >
                <div className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-foreground">Debug Mode</div>
                      <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">Show detailed backend logs in the task view.</p>
                    </div>
                    <div className="ml-4">
                      <button
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-accomplish ${
                          debugMode ? 'bg-primary' : 'bg-muted'
                        }`}
                        data-testid="settings-debug-toggle"
                        onClick={handleDebugToggle}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-accomplish ${
                            debugMode ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  {debugMode && (
                    <div className="mt-4 rounded-xl bg-warning/10 p-3.5">
                      <p className="text-sm text-warning">
                        Debug mode is enabled. Backend logs will appear in the task view when running tasks.
                      </p>
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Done Button */}
          <div className="flex justify-end">
            <button
              className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90"
              data-testid="settings-done-button"
              onClick={handleDone}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
              Done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
