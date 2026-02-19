import { useEffect, useRef } from 'react';
import type { SkillMeta } from '@/lib/tauri-api';

interface SkillAutocompletePopoverProps {
  isOpen: boolean;
  skills: SkillMeta[];
  highlightedIndex: number;
  onSelect: (skill: SkillMeta) => void;
  onHighlightChange: (index: number) => void;
  position?: 'above' | 'below';
}

export function SkillAutocompletePopover({
  isOpen,
  skills,
  highlightedIndex,
  onSelect,
  onHighlightChange,
  position = 'above',
}: SkillAutocompletePopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const el = itemRefs.current.get(highlightedIndex);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  if (!isOpen) return null;

  const positionClasses = position === 'below' ? 'top-full mt-2' : 'bottom-full mb-2';

  if (skills.length === 0) {
    return (
      <div
        className={`absolute right-0 left-0 z-50 ${positionClasses} rounded-md border bg-popover p-3 text-center text-popover-foreground text-sm shadow-md`}
      >
        No skills match
      </div>
    );
  }

  return (
    <div
      className={`absolute right-0 left-0 z-50 ${positionClasses} max-h-[240px] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md`}
      ref={listRef}
    >
      {skills.map((skill, i) => (
        <div
          aria-selected={i === highlightedIndex}
          className={`flex cursor-pointer flex-col gap-0.5 px-3 py-2 transition-colors ${
            i === highlightedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          }`}
          key={skill.id}
          onClick={() => onSelect(skill)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(skill);
            }
          }}
          onMouseEnter={() => onHighlightChange(i)}
          ref={(el) => {
            if (el) itemRefs.current.set(i, el);
            else itemRefs.current.delete(i);
          }}
          role="option"
          tabIndex={-1}
        >
          <span className="font-medium text-sm">{skill.name}</span>
          <span className="line-clamp-1 text-muted-foreground text-xs">{skill.description}</span>
        </div>
      ))}
    </div>
  );
}
