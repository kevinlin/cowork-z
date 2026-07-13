import { ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
      <div className="flex items-center justify-between gap-3 px-6 py-3">
        <p className="text-muted-foreground text-xs">Browse curated skill repositories — open one in Skills Manager to install.</p>
        <Input
          className="h-7 w-48 text-xs"
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
          <EmptyState>No skills match your search.</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((repo) => (
              <div
                className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                key={repo.url}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm leading-snug">{repo.name}</div>
                    <Tooltip delayDuration={400}>
                      <TooltipTrigger asChild>
                        <div className="mt-0.5 line-clamp-3 cursor-default text-muted-foreground text-xs">{repo.summary}</div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm" side="bottom" sideOffset={6}>
                        <p className="text-xs leading-relaxed">{repo.summary}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <button
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                    onClick={() => handleOpen(repo)}
                    type="button"
                  >
                    Open
                    <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {repo.categories.map((category) => (
                    <span className={`rounded-full px-2 py-0.5 font-medium text-xs ${getCategoryColorClass(category)}`} key={category}>
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
