import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PackMeta } from '@/lib/tauri-api';
import { pickFolder } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useTaskStore } from '@/stores/taskStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const COMPLEXITY_COLORS: Record<string, string> = {
  'Beginner-Intermediate': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Intermediate: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'Intermediate-Advanced': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function StarterPacks() {
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [packErrors, setPackErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  const { startTask } = useTaskStore();
  const { addWorkspace, switchWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const api = getTauriAPI();

  useEffect(() => {
    api
      .listPacks()
      .then(setPacks)
      .catch(() => setPacks([]))
      .finally(() => setPacksLoading(false));
  }, [api]);

  const filteredPacks = packs.filter((p) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.complexity.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const executeTask = useCallback(
    async (taskPrompt: string) => {
      const taskId = `task_${Date.now()}`;
      const task = await startTask({ prompt: taskPrompt, taskId });
      if (task) {
        navigate(`/execution/${task.id}`);
      }
    },
    [startTask, navigate],
  );

  const handleInstall = async (packId: string) => {
    setInstallingId(packId);
    setPackErrors((prev) => {
      const next = { ...prev };
      delete next[packId];
      return next;
    });

    try {
      const destination = await pickFolder();
      if (!destination) {
        setInstallingId(null);
        return;
      }

      const result = await api.installPack(packId, destination);
      const workspace = await addWorkspace(result.installed_path);
      await switchWorkspace(workspace.id);
      await executeTask('Open `START_HERE.md` and follow it step-by-step.');
    } catch (e) {
      setPackErrors((prev) => ({ ...prev, [packId]: String(e) }));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between px-6 py-3">
        <p className="text-muted-foreground text-xs">Guided, copyable folders for real-world tasks.</p>
        <input
          className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search packs…"
          type="search"
          value={query}
        />
      </div>

      {/* Pack grid */}
      <div className="max-h-[560px] overflow-y-auto px-6 pb-4">
        {packsLoading ? (
          <p className="py-4 text-center text-muted-foreground text-sm">Loading packs…</p>
        ) : filteredPacks.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            {query ? 'No packs match your search.' : 'No packs available.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredPacks.map((pack) => (
              <div
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                key={pack.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm leading-snug">{pack.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{pack.description}</div>
                  </div>
                  <button
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={installingId === pack.id}
                    onClick={() => handleInstall(pack.id)}
                    type="button"
                  >
                    {installingId === pack.id ? 'Installing…' : 'Install'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${COMPLEXITY_COLORS[pack.complexity] ?? 'bg-muted text-muted-foreground'}`}
                  >
                    {pack.complexity}
                  </span>
                  <span className="text-muted-foreground text-xs">{pack.time_estimate}</span>
                  {pack.tags.slice(0, 4).map((tag) => (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>

                {packErrors[pack.id] && (
                  <p className="text-destructive text-xs">{packErrors[pack.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
