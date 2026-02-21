import { appDataDir } from '@tauri-apps/api/path';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RepoSkill } from '@/lib/tauri-api';
import { useFilePreviewStore } from '@/stores/filePreviewStore';

const CATEGORY_COLORS: Record<string, string> = {
  Data: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  Design: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  Document: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  Enterprise: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300',
  Finance: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  General: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  Legal: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  Marketing: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  Product: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  Productivity: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  Sales: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  Support: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
};

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
  const colorClass = CATEGORY_COLORS[skill.category] ?? 'bg-muted text-muted-foreground';

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
