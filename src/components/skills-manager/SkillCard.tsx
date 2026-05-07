import { appDataDir } from '@tauri-apps/api/path';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCategoryColorClass } from '@/lib/skill-categories';
import type { RepoSkill } from '@/lib/tauri-api';
import { useFilePreviewStore } from '@/stores/filePreviewStore';

interface SkillCardProps {
  skill: RepoSkill;
  displayCategory: string;
  installing: boolean;
  deleting: boolean;
  error?: string;
  onInstall: () => void;
  onDelete: () => void;
}

export function SkillCard({ skill, displayCategory, installing, deleting, error, onInstall, onDelete }: SkillCardProps) {
  const { openPreviewByPath } = useFilePreviewStore();
  const [viewError, setViewError] = useState<string | null>(null);
  const colorClass = getCategoryColorClass(displayCategory);

  const handleView = async () => {
    setViewError(null);
    try {
      const dataDir = await appDataDir();
      const dataDirNorm = dataDir.endsWith('/') ? dataDir : `${dataDir}/`;
      const repoCacheName = skill.repoName.replace(/\//g, '_');
      const skillMdPath = `${dataDirNorm}skill-repo-cache/${repoCacheName}/${skill.skillPath}/SKILL.md`;
      openPreviewByPath(skillMdPath);
    } catch (e) {
      setViewError(String(e));
    }
  };

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <h3 className="cursor-default truncate font-medium text-sm">{skill.name}</h3>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm" side="bottom" sideOffset={6}>
              <p className="text-xs">{skill.name}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <p className="line-clamp-2 cursor-default text-muted-foreground text-xs">{skill.description}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm" side="bottom" sideOffset={6}>
              <p className="text-xs leading-relaxed">{skill.description}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <p className="cursor-default truncate font-mono text-[10px] text-muted-foreground/70">{skill.skillPath}</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-md" side="bottom" sideOffset={6}>
              <p className="break-all font-mono text-[10px]">{skill.skillPath}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${colorClass}`}>{displayCategory}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{skill.repoName}</span>
      </div>

      {error && <div className="rounded border border-destructive/50 bg-destructive/10 p-1 text-[10px] text-destructive">{error}</div>}
      {viewError && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-1 text-[10px] text-destructive">{viewError}</div>
      )}

      <div className="flex items-center gap-2">
        <button className="text-primary text-xs underline hover:no-underline" onClick={handleView} type="button">
          View
        </button>

        <div className="ml-auto flex items-center gap-1">
          {installing ? (
            <Button className="h-6 text-xs" disabled size="sm">
              Installing...
            </Button>
          ) : deleting ? (
            <Button className="h-6 text-xs" disabled size="sm" variant="ghost">
              Deleting...
            </Button>
          ) : skill.installed && !skill.needsUpdate ? (
            <>
              <span className="text-green-600 text-xs">Installed</span>
              <button className="text-muted-foreground text-xs underline hover:no-underline" onClick={onInstall} type="button">
                Re-install
              </button>
              <button
                className="ml-1 text-muted-foreground transition-colors hover:text-destructive"
                onClick={onDelete}
                title="Delete installed skill"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : skill.installed && skill.needsUpdate ? (
            <>
              <Button className="h-6 bg-amber-500 text-xs hover:bg-amber-600" onClick={onInstall} size="sm">
                Update
              </Button>
              <button
                className="text-muted-foreground transition-colors hover:text-destructive"
                onClick={onDelete}
                title="Delete installed skill"
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <Button className="h-6 text-xs" onClick={onInstall} size="sm">
              Install
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
