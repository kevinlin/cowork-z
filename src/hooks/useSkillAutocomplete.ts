import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SkillMeta } from '@/lib/tauri-api';
import { useSkillsStore } from '@/stores/skillsStore';

interface UseSkillAutocompleteOptions {
  text: string;
  onTextChange: (text: string) => void;
  disabled?: boolean;
}

export interface SkillAutocompleteResult {
  selectedSkill: SkillMeta | null;
  clearSkill: () => void;
  isPopoverOpen: boolean;
  filteredSkills: SkillMeta[];
  highlightedIndex: number;
  setHighlightedIndex: (i: number) => void;
  selectSkill: (skill: SkillMeta) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  composePrompt: () => string;
  hasSkill: boolean;
}

export function useSkillAutocomplete({ text, onTextChange, disabled }: UseSkillAutocompleteOptions): SkillAutocompleteResult {
  const { installedSkills, isLoaded, fetchInstalledSkills } = useSkillsStore();
  const [selectedSkill, setSelectedSkill] = useState<SkillMeta | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!(isLoaded || disabled)) {
      fetchInstalledSkills();
    }
  }, [isLoaded, disabled, fetchInstalledSkills]);

  const isPopoverOpen = !(disabled || selectedSkill) && text.startsWith('/');

  const query = isPopoverOpen ? text.slice(1).toLowerCase() : '';

  const filteredSkills = useMemo(() => {
    if (!isPopoverOpen) return [];
    if (!query) return installedSkills;
    return installedSkills.filter(
      (s) => s.id.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)
    );
  }, [isPopoverOpen, query, installedSkills]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  const selectSkill = useCallback(
    (skill: SkillMeta) => {
      setSelectedSkill(skill);
      onTextChange('');
    },
    [onTextChange]
  );

  const clearSkill = useCallback(() => {
    setSelectedSkill(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isPopoverOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % Math.max(filteredSkills.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + Math.max(filteredSkills.length, 1)) % Math.max(filteredSkills.length, 1));
      } else if ((e.key === 'Tab' || e.key === 'Enter') && filteredSkills.length > 0) {
        e.preventDefault();
        selectSkill(filteredSkills[highlightedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onTextChange('');
      }
    },
    [isPopoverOpen, filteredSkills, highlightedIndex, selectSkill, onTextChange]
  );

  const composePrompt = useCallback(() => {
    if (selectedSkill) {
      return `/${selectedSkill.id} ${text}`.trimEnd();
    }
    return text;
  }, [selectedSkill, text]);

  return {
    selectedSkill,
    clearSkill,
    isPopoverOpen,
    filteredSkills,
    highlightedIndex,
    setHighlightedIndex,
    selectSkill,
    handleKeyDown,
    composePrompt,
    hasSkill: selectedSkill !== null,
  };
}
