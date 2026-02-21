import { homeDir } from '@tauri-apps/api/path';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RepoSkill } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

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

export function RepoSkillsGrid() {
  const { repoSkills, repoSkillsLoading, searchQuery, setSearchQuery, activeCategory, setActiveCategory, targetFolder, refreshAll } =
    useSkillsManagerStore();
  const { openPreviewByPath } = useFilePreviewStore();
  const [installingPath, setInstallingPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const categories = useMemo(() => {
    const cats = new Set(repoSkills.map((s) => s.category));
    return ['All', ...Array.from(cats).sort()];
  }, [repoSkills]);

  const filtered = useMemo(() => {
    const queryLower = searchQuery.toLowerCase();
    return repoSkills
      .filter((s) => activeCategory === 'All' || s.category === activeCategory)
      .filter((s) => {
        if (!queryLower) return true;
        return (
          s.name.toLowerCase().includes(queryLower) ||
          s.description.toLowerCase().includes(queryLower) ||
          s.category.toLowerCase().includes(queryLower)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [repoSkills, activeCategory, searchQuery]);

  const handleInstall = async (skill: RepoSkill) => {
    setInstallingPath(skill.skillPath);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[skill.skillPath];
      return next;
    });
    try {
      const api = getTauriAPI();
      await api.skillsInstallFromRepo(skill.repoId, skill.skillPath, targetFolder);
      await refreshAll();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [skill.skillPath]: String(e) }));
    } finally {
      setInstallingPath(null);
    }
  };

  const handleView = async (skill: RepoSkill) => {
    try {
      const home = await homeDir();
      const homePath = home.endsWith('/') ? home : `${home}/`;
      const paths: Record<string, string> = {
        opencode: `${homePath}.config/opencode/skills`,
        claude: `${homePath}.claude/skills`,
        agents: `${homePath}.agents/skills`,
      };
      const skillMdPath = `${paths[targetFolder]}/${skill.skillId}/SKILL.md`;
      openPreviewByPath(skillMdPath);
    } catch {
      // Ignore preview errors
    }
  };

  if (repoSkillsLoading) {
    return <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">Loading skills...</div>;
  }

  if (repoSkills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground text-sm">
        <p>No skills available.</p>
        <p>Add a repository to browse skills from it.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-4 pt-3">
        <Input
          className="h-8 text-xs"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search skills..."
          value={searchQuery}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto px-4 py-2">
        {categories.map((cat) => (
          <button
            className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${
              activeCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
            key={cat}
            onClick={() => setActiveCategory(cat)}
            type="button"
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">No skills match your search</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <SkillCard
                error={errors[skill.skillPath]}
                installing={installingPath === skill.skillPath}
                key={`${skill.repoId}-${skill.skillPath}`}
                onInstall={() => handleInstall(skill)}
                onView={() => handleView(skill)}
                skill={skill}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  installing,
  error,
  onInstall,
  onView,
}: {
  skill: RepoSkill;
  installing: boolean;
  error?: string;
  onInstall: () => void;
  onView: () => void;
}) {
  const colorClass = CATEGORY_COLORS[skill.category] ?? 'bg-muted text-muted-foreground';

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

      <div className="flex items-center gap-2">
        <button className="text-primary text-xs underline hover:no-underline" onClick={onView} type="button">
          View
        </button>

        {installing ? (
          <Button className="ml-auto h-6 text-xs" disabled size="sm">
            Installing...
          </Button>
        ) : skill.installed && !skill.needsUpdate ? (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-green-600 text-xs">Installed</span>
            <button className="text-muted-foreground text-xs underline hover:no-underline" onClick={onInstall} type="button">
              Re-install
            </button>
          </div>
        ) : skill.installed && skill.needsUpdate ? (
          <Button className="ml-auto h-6 bg-amber-500 text-xs hover:bg-amber-600" onClick={onInstall} size="sm">
            Update
          </Button>
        ) : (
          <Button className="ml-auto h-6 text-xs" onClick={onInstall} size="sm">
            Install
          </Button>
        )}
      </div>
    </div>
  );
}
