// apps/desktop/src/renderer/components/settings/ProviderCard.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback } from 'react';
import { settingsTransitions, settingsVariants } from '@/lib/animations';
import type { ConnectedProvider, ProviderId } from '@/shared';
import { isProviderReady, PROVIDER_META } from '@/shared';

// Import provider logos
import anthropicLogo from '/assets/ai-logos/anthropic.svg';
import azureLogo from '/assets/ai-logos/azure.svg';
import bedrockLogo from '/assets/ai-logos/bedrock.svg';
import deepseekLogo from '/assets/ai-logos/deepseek.svg';
import githubCopilotLogo from '/assets/ai-logos/github-copilot.svg';
import googleLogo from '/assets/ai-logos/google.svg';
import litellmLogo from '/assets/ai-logos/litellm.svg';
import ollamaLogo from '/assets/ai-logos/ollama.svg';
import openaiLogo from '/assets/ai-logos/openai.svg';
import openrouterLogo from '/assets/ai-logos/openrouter.svg';
import xaiLogo from '/assets/ai-logos/xai.svg';
import zaiLogo from '/assets/ai-logos/zai.svg';

// Import connected badge icon
import connectedKeyIcon from '/assets/icons/connected-key.svg';

const PROVIDER_LOGOS: Record<ProviderId, string> = {
  anthropic: anthropicLogo,
  openai: openaiLogo,
  google: googleLogo,
  xai: xaiLogo,
  deepseek: deepseekLogo,
  zai: zaiLogo,
  bedrock: bedrockLogo,
  'azure-foundry': azureLogo,
  ollama: ollamaLogo,
  openrouter: openrouterLogo,
  litellm: litellmLogo,
  'github-copilot': githubCopilotLogo,
};

interface ProviderCardProps {
  providerId: ProviderId;
  connectedProvider?: ConnectedProvider;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (providerId: ProviderId) => void;
}

// Memoized to prevent unnecessary re-renders when switching between providers
// Only re-renders when its own props change (not when sibling cards change)
export const ProviderCard = memo(function ProviderCard({
  providerId,
  connectedProvider,
  isActive,
  isSelected,
  onSelect,
}: ProviderCardProps) {
  const meta = PROVIDER_META[providerId];
  const isConnected = connectedProvider?.connectionStatus === 'connected';
  const providerReady = isProviderReady(connectedProvider);
  const logoSrc = PROVIDER_LOGOS[providerId];

  // Green background should ONLY show for the active provider that is ready (connected + model selected)
  // isSelected just means the card is clicked for viewing settings - it should only get a border, not green background
  const showGreenBackground = isActive && providerReady;

  // Handler calls onSelect with this card's providerId
  const handleClick = useCallback(() => {
    onSelect(providerId);
  }, [onSelect, providerId]);

  return (
    <button
      className={`relative flex h-[110px] w-[130px] flex-col items-center justify-center rounded-xl border p-4 transition-[background-color,border-color] duration-150 ${
        showGreenBackground
          ? 'border-2 border-primary bg-primary/10'
          : isSelected
            ? 'border-2 border-primary bg-card'
            : 'border-border bg-card hover:border-ring'
      }`}
      data-testid={`provider-card-${providerId}`}
      onClick={handleClick}
    >
      {/* Connection status badge - always green when connected */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            animate="animate"
            className="absolute top-2 right-2"
            data-testid={`provider-connected-badge-${providerId}`}
            exit="exit"
            initial="initial"
            transition={settingsTransitions.enter}
            variants={settingsVariants.fadeSlide}
          >
            <img
              alt={providerReady ? 'Ready' : 'Connected'}
              className="h-5 w-5"
              src={connectedKeyIcon}
              title={providerReady ? undefined : 'Select a model to complete setup'}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Provider Logo */}
      <div className="mb-2 flex h-10 w-10 items-center justify-center">
        <img alt={`${meta.name} logo`} className="h-8 w-8 object-contain" src={logoSrc} />
      </div>

      {/* Name */}
      <span className="font-medium text-foreground text-sm">{meta.name}</span>

      {/* Label */}
      <span className="text-muted-foreground text-xs">{meta.label}</span>
    </button>
  );
});
