import { X } from 'lucide-react';
import type { SkillMeta } from '@/lib/tauri-api';

interface SkillPillProps {
  skill: SkillMeta;
  onRemove: () => void;
  onClick?: () => void;
}

export function SkillPill({ skill, onRemove, onClick }: SkillPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-primary text-sm">
      <button
        className="max-w-[200px] truncate font-medium hover:underline"
        onClick={onClick}
        title={`View ${skill.name} skill definition`}
        type="button"
      >
        {skill.name}
      </button>
      <button
        aria-label={`Remove ${skill.name}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-primary/60 hover:bg-primary/10 hover:text-primary"
        onClick={onRemove}
        type="button"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
