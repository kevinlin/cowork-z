// apps/desktop/src/renderer/components/settings/ProviderGrid.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { ProviderId, ProviderSettings } from '@/shared';
import { PROVIDER_META } from '@/shared';
import { ProviderCard } from './ProviderCard';

// import { settingsVariants, settingsTransitions } from '@/lib/animations';

// Provider order matching Figma design (4 columns per row)
const PROVIDER_ORDER: ProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'github-copilot',
  'bedrock',
  'azure-foundry',
  'deepseek',
  'zai',
  'ollama',
  'xai',
  'openrouter',
  'litellm',
];

interface ProviderGridProps {
  settings: ProviderSettings;
  selectedProvider: ProviderId | null;
  onSelectProvider: (providerId: ProviderId) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function ProviderGrid({ settings, selectedProvider, onSelectProvider, expanded, onToggleExpanded }: ProviderGridProps) {
  const [search, setSearch] = useState('');

  const filteredProviders = useMemo(() => {
    if (!search.trim()) return PROVIDER_ORDER;
    const query = search.toLowerCase();
    return PROVIDER_ORDER.filter((id) => {
      const meta = PROVIDER_META[id];
      return meta.name.toLowerCase().includes(query);
    });
  }, [search]);

  return (
    <div className="rounded-xl border border-border bg-muted p-4" data-testid="provider-grid">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <span className="font-medium text-foreground text-sm">Providers</span>
        <div className="relative">
          <svg
            className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
          </svg>
          <input
            className="w-48 rounded-md border border-input bg-background py-1.5 pr-3 pl-9 text-sm"
            data-testid="provider-search-input"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Providers"
            type="text"
            value={search}
          />
          {search && (
            <button
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch('')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Providers - first 4 always visible */}
      <div className="grid min-h-[110px] grid-cols-4 justify-items-center gap-3">
        {filteredProviders.slice(0, 4).map((providerId) => (
          <ProviderCard
            connectedProvider={settings?.connectedProviders?.[providerId]}
            isActive={settings?.activeProviderId === providerId}
            isSelected={selectedProvider === providerId}
            key={providerId}
            onSelect={onSelectProvider}
            providerId={providerId}
          />
        ))}
      </div>

      {/* Expanded providers (5-10) with staggered animation */}
      <AnimatePresence mode="sync">
        {expanded && filteredProviders.length > 4 && (
          <motion.div
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 grid grid-cols-4 justify-items-center gap-3 overflow-hidden"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {filteredProviders.slice(4).map((providerId, index) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 8 }}
                key={providerId}
                transition={{ duration: 0.15, delay: index * 0.03 }}
              >
                <ProviderCard
                  connectedProvider={settings?.connectedProviders?.[providerId]}
                  isActive={settings?.activeProviderId === providerId}
                  isSelected={selectedProvider === providerId}
                  onSelect={onSelectProvider}
                  providerId={providerId}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Show All / Hide toggle */}
      <div className="mt-4 border-border border-t pt-3 text-center">
        <button
          className="font-medium text-muted-foreground text-sm hover:text-foreground"
          data-testid="show-all-toggle"
          onClick={onToggleExpanded}
        >
          {expanded ? 'Hide' : 'Show All'}
        </button>
      </div>
    </div>
  );
}
