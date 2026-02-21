// apps/desktop/src/renderer/components/settings/ProviderSettingsPanel.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ConnectedProvider, ProviderId } from '@/shared';
import { PROVIDER_META } from '@/shared';
import {
  AzureFoundryProviderForm,
  BedrockProviderForm,
  ClassicProviderForm,
  CopilotProviderForm,
  LiteLLMProviderForm,
  OllamaProviderForm,
  OpenRouterProviderForm,
} from './providers';

interface ProviderSettingsPanelProps {
  providerId: ProviderId;
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function ProviderSettingsPanel({
  providerId,
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: ProviderSettingsPanelProps) {
  const meta = PROVIDER_META[providerId];

  // Render form content based on provider category
  const renderForm = () => {
    switch (meta.category) {
      case 'classic':
        return (
          <ClassicProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            providerId={providerId}
            showModelError={showModelError}
          />
        );

      case 'aws':
        return (
          <BedrockProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      case 'azure':
        return (
          <AzureFoundryProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      case 'local':
        return (
          <OllamaProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      case 'proxy':
        return (
          <OpenRouterProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      case 'hybrid':
        return (
          <LiteLLMProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      case 'copilot':
        return (
          <CopilotProviderForm
            connectedProvider={connectedProvider}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onModelChange={onModelChange}
            showModelError={showModelError}
          />
        );

      default:
        return <div>Unknown provider type</div>;
    }
  };

  // Wrap in min-height container to prevent layout shifts when switching providers
  // Different forms have different heights; this ensures consistent layout
  return (
    <div className="min-h-[260px]">
      <AnimatePresence mode="wait">
        <motion.div
          animate="animate"
          exit="exit"
          initial="initial"
          key={providerId}
          transition={settingsTransitions.enter}
          variants={settingsVariants.slideDown}
        >
          {renderForm()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
