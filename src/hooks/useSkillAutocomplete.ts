import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SkillMeta } from '@/lib/tauri-api';
import { useSkillsStore } from '@/stores/skillsStore';

interface UseSkillAutocompleteOptions {
  text: string;
  cursorPosition: number;
  onTextChange: (text: string, cursor?: number) => void;
  disabled?: boolean;
}

export interface SkillAutocompleteResult {
  selectedSkills: SkillMeta[];
  removeSkill: (skillId: string) => void;
  clearAllSkills: () => void;
  isPopoverOpen: boolean;
  filteredSkills: SkillMeta[];
  highlightedIndex: number;
  setHighlightedIndex: (i: number) => void;
  selectSkill: (skill: SkillMeta) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  composePrompt: () => string;
  hasSkills: boolean;
}

interface SlashTrigger {
  slashStart: number;
  query: string;
}

function findSlashTrigger(text: string, cursor: number): SlashTrigger | null {
  const clampedCursor = Math.max(0, Math.min(cursor, text.length));
  for (let i = clampedCursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '/') {
      const prev = i === 0 ? '' : text[i - 1];
      if (i === 0 || /\s/.test(prev)) {
        return { slashStart: i, query: text.slice(i + 1, clampedCursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export function useSkillAutocomplete({
  text,
  cursorPosition,
  onTextChange,
  disabled,
}: UseSkillAutocompleteOptions): SkillAutocompleteResult {
  const { installedSkills, isLoaded, fetchInstalledSkills } = useSkillsStore();
  const [selectedSkills, setSelectedSkills] = useState<SkillMeta[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!(isLoaded || disabled)) {
      fetchInstalledSkills();
    }
  }, [isLoaded, disabled, fetchInstalledSkills]);

  const trigger = useMemo(() => {
    if (disabled) return null;
    return findSlashTrigger(text, cursorPosition);
  }, [disabled, text, cursorPosition]);

  const isPopoverOpen = trigger !== null;
  const query = trigger ? trigger.query.toLowerCase() : '';

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
      const currentTrigger = findSlashTrigger(text, cursorPosition);
      if (currentTrigger) {
        const newText = text.slice(0, currentTrigger.slashStart) + text.slice(cursorPosition);
        onTextChange(newText, currentTrigger.slashStart);
      }
      setSelectedSkills((prev) => {
        if (prev.some((s) => s.id === skill.id)) return prev;
        return [...prev, skill];
      });
    },
    [text, cursorPosition, onTextChange]
  );

  const removeSkill = useCallback((skillId: string) => {
    setSelectedSkills((prev) => prev.filter((s) => s.id !== skillId));
  }, []);

  const clearAllSkills = useCallback(() => {
    setSelectedSkills([]);
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
        const currentTrigger = findSlashTrigger(text, cursorPosition);
        if (currentTrigger) {
          const newText = text.slice(0, currentTrigger.slashStart) + text.slice(cursorPosition);
          onTextChange(newText, currentTrigger.slashStart);
        }
      }
    },
    [isPopoverOpen, filteredSkills, highlightedIndex, selectSkill, text, cursorPosition, onTextChange]
  );

  const composePrompt = useCallback(() => {
    if (selectedSkills.length === 0) return text;
    const prefix = selectedSkills.map((s) => `/${s.id}`).join(' ');
    const trimmedText = text.trim();
    if (!trimmedText) return prefix;
    return `${prefix} ${text}`.trimEnd();
  }, [selectedSkills, text]);

  return {
    selectedSkills,
    removeSkill,
    clearAllSkills,
    isPopoverOpen,
    filteredSkills,
    highlightedIndex,
    setHighlightedIndex,
    selectSkill,
    handleKeyDown,
    composePrompt,
    hasSkills: selectedSkills.length > 0,
  };
}
