'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { hasAnyReadyProvider } from '@/shared';
import TaskInputBar from '../components/landing/TaskInputBar';
import SettingsDialog from '../components/layout/SettingsDialog';
import { springs } from '../lib/animations';
import { pickFolder } from '../lib/tauri-api';
import type { PackMeta } from '../lib/tauri-api';
import { getTauriAPI } from '../lib/tauri-api-interface';
import { useTaskStore } from '../stores/taskStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

const COMPLEXITY_COLORS: Record<string, string> = {
  'Beginner-Intermediate': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  Intermediate: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'Intermediate-Advanced': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Advanced: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  // Packs state
  const [packs, setPacks] = useState<PackMeta[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [packErrors, setPackErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  const { startTask, isLoading, addTaskUpdate, enqueuePermissionRequest } = useTaskStore();
  const { addWorkspace, switchWorkspace } = useWorkspaceStore();
  const navigate = useNavigate();
  const api = getTauriAPI();

  // Subscribe to task events
  useEffect(() => {
    const unsubscribeTask = api.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });
    const unsubscribePermission = api.onPermissionRequest((request) => {
      enqueuePermissionRequest(request);
    });
    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, enqueuePermissionRequest, api]);

  // Load packs catalog on mount
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

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setShowSettingsDialog(true);
        return;
      }
    }
    await executeTask(prompt.trim());
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
  };

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask(prompt.trim());
    }
  };

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
    <>
      <SettingsDialog onApiKeySaved={handleApiKeySaved} onOpenChange={handleSettingsDialogChange} open={showSettingsDialog} />
      <div className="flex h-full items-center justify-center overflow-y-auto bg-accent p-6">
        <div className="flex w-full max-w-4xl flex-col items-center gap-8">
          {/* Main Title */}
          <motion.h1
            animate={{ opacity: 1, y: 0 }}
            className="font-light text-4xl text-foreground tracking-tight"
            data-testid="home-title"
            initial={{ opacity: 0, y: -20 }}
            transition={springs.gentle}
          >
            What will you accomplish today?
          </motion.h1>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <Card className="flex max-h-[calc(100vh-3rem)] w-full flex-col gap-0 bg-card/95 py-0 shadow-xl backdrop-blur-md">
              <CardContent className="flex-shrink-0 p-6 pb-4">
                <TaskInputBar
                  autoFocus={true}
                  isLoading={isLoading}
                  large={true}
                  onChange={setPrompt}
                  onSubmit={handleSubmit}
                  placeholder="Describe a task and let AI handle the rest"
                  value={prompt}
                />
              </CardContent>

              {/* Starter Packs Section */}
              <div className="border-border border-t">
                {/* Header row */}
                <div className="flex items-center justify-between px-6 py-3">
                  <div>
                    <span className="font-medium text-foreground text-sm">Starter Packs</span>
                    <p className="text-muted-foreground text-xs">Guided, copyable folders for real-world tasks.</p>
                  </div>
                  <input
                    className="h-7 w-48 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search packs…"
                    type="search"
                    value={query}
                  />
                </div>

                {/* Pack grid */}
                <div className="max-h-[400px] overflow-y-auto px-6 pb-4">
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
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
