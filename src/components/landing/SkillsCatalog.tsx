import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getCategoryColorClass } from '@/lib/skill-categories';
import { openSkillsManagerForRepo, openSkillsManagerWindow } from '@/lib/skills-window';
import { CURATED_SKILL_REPOS, type CuratedSkillRepo } from './curatedSkillRepos';

export default function SkillsCatalog() {
  const [activeCategory, setActiveCategory] = useState('All');
  const [query, setQuery] = useState('');

  const categories = useMemo(() => ['All', ...Array.from(new Set(CURATED_SKILL_REPOS.flatMap((r) => r.categories))).sort()], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CURATED_SKILL_REPOS.filter((repo) => {
      const matchCategory = activeCategory === 'All' || repo.categories.includes(activeCategory);
      const matchQuery =
        !q ||
        repo.name.toLowerCase().includes(q) ||
        repo.summary.toLowerCase().includes(q) ||
        repo.categories.some((c) => c.toLowerCase().includes(q));
      return matchCategory && matchQuery;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeCategory, query]);

  const handleOpen = (repo: CuratedSkillRepo) => {
    openSkillsManagerForRepo({ url: repo.url, branch: repo.branch });
  };

  return (
    <div>
      <div className="flex items-center justify-between px-6 py-3">
        <p className="text-muted-foreground text-xs">Browse curated skill repositories — open one in Skills Manager to install.</p>
        <input
          className="h-7 w-48 rounded-md border border-border bg-background px-2 text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          type="search"
          value={query}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto px-6 pb-2">
        {categories.map((cat) => (
          <button
            className={`shrink-0 rounded-full px-3 py-1 font-medium text-xs transition-colors ${
              activeCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            key={cat}
            onClick={() => setActiveCategory(cat)}
            type="button"
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="max-h-[560px] overflow-y-auto px-6 pb-4">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">No skills match your search.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((repo) => (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" key={repo.url}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm leading-snug">{repo.name}</div>
                    <div className="mt-0.5 line-clamp-3 text-muted-foreground text-xs">{repo.summary}</div>
                  </div>
                  <button
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/90"
                    onClick={() => handleOpen(repo)}
                    type="button"
                  >
                    Open
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {repo.categories.map((category) => (
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium text-xs ${getCategoryColorClass(category)}`}
                      key={category}
                    >
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-6 py-3">
        <p className="text-muted-foreground text-xs">
          Manage all installed skills and add your own repos in{' '}
          <button className="font-medium text-primary underline hover:no-underline" onClick={openSkillsManagerWindow} type="button">
            Skills Manager
          </button>
        </p>
      </div>
    </div>
  );
}
