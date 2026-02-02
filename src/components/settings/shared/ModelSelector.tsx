// apps/desktop/src/renderer/components/settings/shared/ModelSelector.tsx

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { settingsTransitions, settingsVariants } from '@/lib/animations';

interface Model {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  models: Model[];
  value: string | null;
  onChange: (modelId: string) => void;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  placeholder?: string;
}

export function ModelSelector({
  models,
  value,
  onChange,
  loading,
  error,
  errorMessage = 'Please select a model',
  placeholder = 'Select model...',
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show search functionality when there are many models (e.g., OpenRouter)
  const showSearch = models.length > 10;

  // Filter models based on search term
  const filteredModels = search
    ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))
    : models;

  // Get display name for selected value
  const selectedModel = models.find((m) => m.id === value);
  const displayValue = selectedModel?.name || '';

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && showSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, showSearch]);

  if (loading) {
    return <div className="h-10 animate-pulse rounded-md bg-muted" />;
  }

  // For small model lists, use simple select
  if (!showSearch) {
    return (
      <div>
        <label className="mb-2 block font-medium text-foreground text-sm">Model</label>
        <select
          className={`w-full rounded-md border bg-background px-3 py-2.5 text-sm ${error ? 'border-destructive' : 'border-input'}`}
          data-testid="model-selector"
          onChange={(e) => onChange(e.target.value)}
          value={value || ''}
        >
          <option disabled value="">
            {placeholder}
          </option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        {error && !value && (
          <p className="mt-2 text-destructive text-sm" data-testid="model-selector-error">
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  // For large model lists, use searchable dropdown
  return (
    <div ref={containerRef}>
      <label className="mb-2 block font-medium text-foreground text-sm">Model</label>
      <div className="relative">
        <button
          className={`flex w-full items-center justify-between rounded-md border bg-background px-3 py-2.5 text-left text-sm ${error ? 'border-destructive' : 'border-input'}`}
          data-testid="model-selector"
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          <span className={value ? 'text-foreground' : 'text-muted-foreground'}>{displayValue || placeholder}</span>
          <svg
            className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
          </svg>
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              animate="animate"
              className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background shadow-lg"
              exit="exit"
              initial="initial"
              style={{ transformOrigin: 'top' }}
              transition={settingsTransitions.fast}
              variants={settingsVariants.scaleDropdown}
            >
              {/* Search input */}
              <div className="border-input border-b p-2">
                <input
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  ref={inputRef}
                  type="text"
                  value={search}
                />
              </div>

              {/* Model list */}
              <div className="max-h-60 overflow-y-auto">
                {filteredModels.length === 0 ? (
                  <div className="px-3 py-2 text-muted-foreground text-sm">No models found</div>
                ) : (
                  filteredModels.map((model) => (
                    <button
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${model.id === value ? 'bg-muted font-medium' : ''}`}
                      key={model.id}
                      onClick={() => {
                        onChange(model.id);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      type="button"
                    >
                      {model.name}
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && !value && (
        <p className="mt-2 text-destructive text-sm" data-testid="model-selector-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
