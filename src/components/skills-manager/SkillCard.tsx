import { appDataDir } from '@tauri-apps/api/path';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getCategoryColorClass } from '@/lib/skill-categories';
import type { RepoSkill } from '@/lib/tauri-api';
import { useFilePreviewStore } from '@/stores/filePreviewStore';

interface SkillCardProps {
  skill: RepoSkill;
  installing: boolean;
  deleting: boolean;
  error?: string;
  onInstall: () => void;
  onDelete: () => void;
}

export function SkillCard({ skill, installing, deleting, error, onInstall, onDelete }: SkillCardProps) {
  const { openPreviewByPath } = useFilePreviewStore();
  const [viewError, setViewError] = useState<string | null>(null);
  const colorClass = getCategoryColorClass(skill.category);

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
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-sm">{skill.name}</h3>
          <p className="line-clamp-2 text-muted-foreground text-xs">{skill.description}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={skill.skillPath}>
            {skill.skillPath}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${colorClass}`}>{skill.category}</span>
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

        {installing ? (
          <Button className="ml-auto h-6 text-xs" disabled size="sm">
            Installing...
          </Button>
        ) : deleting ? (
          <Button className="ml-auto h-6 text-xs" disabled size="sm" variant="ghost">
            Deleting...
          </Button>
        ) : skill.installed && !skill.needsUpdate ? (
          <div className="ml-auto flex items-center gap-1">
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
          </div>
        ) : skill.installed && skill.needsUpdate ? (
          <div className="ml-auto flex items-center gap-1">
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
          </div>
        ) : (
          <Button className="ml-auto h-6 text-xs" onClick={onInstall} size="sm">
            Install
          </Button>
        )}
      </div>
    </div>
  );
}
