import { useEffect, useState } from 'react';
import type { SkillWithStatus } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';

export default function SkillsCatalog() {
  const [skills, setSkills] = useState<SkillWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const api = getTauriAPI();

  useEffect(() => {
    api
      .listSkillsWithStatus()
      .then(setSkills)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [api]);

  const categories = ['All', ...Array.from(new Set(skills.map((s) => s.meta.category))).sort()];

  const filtered = skills.filter((s) => {
    const matchCategory = activeCategory === 'All' || s.meta.category === activeCategory;
    const q = query.toLowerCase();
    const matchQuery =
      !q ||
      s.meta.name.toLowerCase().includes(q) ||
      s.meta.description.toLowerCase().includes(q) ||
      s.meta.category.toLowerCase().includes(q);
    return matchCategory && matchQuery;
  });

  const handleInstall = async (skillId: string) => {
    setInstallingId(skillId);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[skillId];
      return next;
    });
    try {
      await api.installSkill(skillId);
      const updated = await api.listSkillsWithStatus();
      setSkills(updated);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [skillId]: String(e) }));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between px-6 py-3">
        <p className="text-muted-foreground text-xs">Install reusable AI skill templates globally.</p>
        <input
          className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          type="search"
          value={query}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto px-6 pb-2">
        {categories.map((cat) => (
          <button
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            key={cat}
            onClick={() => setActiveCategory(cat)}
            type="button"
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Skill grid */}
      <div className="max-h-[400px] overflow-y-auto px-6 pb-4">
        {loading ? (
          <p className="py-4 text-center text-muted-foreground text-sm">Loading skills…</p>
        ) : loadError ? (
          <p className="py-4 text-center text-muted-foreground text-sm">Failed to load skills.</p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            {query ? 'No skills match your search.' : 'No skills available.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((s) => (
              <div
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                key={s.meta.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm leading-snug">{s.meta.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{s.meta.description}</div>
                  </div>
                  <SkillButton
                    installing={installingId === s.meta.id}
                    onInstall={() => handleInstall(s.meta.id)}
                    status={s.status}
                  />
                </div>
                {errors[s.meta.id] && (
                  <p className="text-destructive text-xs">{errors[s.meta.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SkillButtonProps {
  status: SkillWithStatus['status'];
  installing: boolean;
  onInstall: () => void;
}

function SkillButton({ status, installing, onInstall }: SkillButtonProps) {
  if (installing) {
    return (
      <button
        className="shrink-0 cursor-not-allowed rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs opacity-50"
        disabled
        type="button"
      >
        Installing…
      </button>
    );
  }

  if (!status.installed) {
    return (
      <button
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
        onClick={onInstall}
        type="button"
      >
        Install
      </button>
    );
  }

  if (status.needs_update) {
    return (
      <button
        className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-amber-600"
        onClick={onInstall}
        type="button"
      >
        Re-install
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">Installed</span>
      <button
        className="text-muted-foreground text-xs underline hover:text-foreground"
        onClick={onInstall}
        type="button"
      >
        Re-install
      </button>
    </div>
  );
}
