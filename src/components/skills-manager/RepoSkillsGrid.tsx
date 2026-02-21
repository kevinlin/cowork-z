import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { RepoSkill } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { SkillCard } from './SkillCard';

export function RepoSkillsGrid() {
  const { repoSkills, repoSkillsLoading, searchQuery, setSearchQuery, activeCategory, setActiveCategory, targetFolder, refreshAll } =
    useSkillsManagerStore();
  const [installingPath, setInstallingPath] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
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

  const handleDelete = async (skill: RepoSkill) => {
    setDeletingPath(skill.skillPath);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[skill.skillPath];
      return next;
    });
    try {
      const api = getTauriAPI();
      await api.skillsDeleteInstalled(skill.skillId, targetFolder);
      await refreshAll();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [skill.skillPath]: String(e) }));
    } finally {
      setDeletingPath(null);
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
                deleting={deletingPath === skill.skillPath}
                error={errors[skill.skillPath]}
                installing={installingPath === skill.skillPath}
                key={`${skill.repoId}-${skill.skillPath}`}
                onDelete={() => handleDelete(skill)}
                onInstall={() => handleInstall(skill)}
                skill={skill}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
