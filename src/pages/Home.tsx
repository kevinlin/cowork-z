'use client';

import { motion } from 'framer-motion';
import { Columns3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import type { SkillMeta } from '@/lib/tauri-api';
import { hasAnyReadyProvider } from '@/shared';
import AutomationsList from '../components/landing/AutomationsList';
import SkillsCatalog from '../components/landing/SkillsCatalog';
import StarterPacks from '../components/landing/StarterPacks';
import TaskInputBar from '../components/landing/TaskInputBar';
import SettingsDialog from '../components/layout/SettingsDialog';
import { springs } from '../lib/animations';
import { getTauriAPI } from '../lib/tauri-api-interface';
import { useTaskStore } from '../stores/taskStore';

type HomeTab = 'packs' | 'skills' | 'automations';

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<SkillMeta[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<HomeTab>('skills');

  const { startTask, isLoading, addTaskUpdate, enqueuePermissionRequest } = useTaskStore();
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

  const executeTask = useCallback(
    async (taskPrompt: string) => {
      const taskId = `task_${Date.now()}`;
      const task = await startTask({ prompt: taskPrompt, taskId });
      if (task) {
        navigate(`/execution/${task.id}`);
      }
    },
    [startTask, navigate]
  );

  const composeFinalPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (selectedSkills.length === 0) return trimmed;
    const prefix = selectedSkills.map((s) => `/${s.id}`).join(' ');
    return trimmed ? `${prefix} ${trimmed}` : prefix;
  }, [prompt, selectedSkills]);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    const finalPrompt = composeFinalPrompt();
    const isE2EMode = await api.isE2EMode();
    if (!isE2EMode) {
      const settings = await api.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setPendingPrompt(finalPrompt);
        setShowSettingsDialog(true);
        return;
      }
    }
    await executeTask(finalPrompt);
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
  };

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    const toRun = pendingPrompt ?? composeFinalPrompt();
    setPendingPrompt(null);
    if (toRun.trim()) {
      await executeTask(toRun);
    }
  };

  return (
    <>
      <SettingsDialog onApiKeySaved={handleApiKeySaved} onOpenChange={handleSettingsDialogChange} open={showSettingsDialog} />
      <div className="relative flex h-full items-center justify-center overflow-y-auto bg-accent p-6">
        {/* Arena entry point — top-right corner */}
        <motion.div
          animate={{ opacity: 1 }}
          className="absolute top-6 right-6 z-10"
          initial={{ opacity: 0 }}
          transition={{ ...springs.gentle, delay: 0.05 }}
        >
          <button
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-card hover:text-foreground"
            onClick={() => navigate('/arena/new')}
            title="Compare 3 models side-by-side"
            type="button"
          >
            <Columns3 className="h-4 w-4" />
            Arena
          </button>
        </motion.div>

        <div className="flex w-full max-w-5xl flex-col items-center gap-8">
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
                  onSkillsChange={setSelectedSkills}
                  onSubmit={handleSubmit}
                  placeholder="Describe a task and let AI handle the rest"
                  value={prompt}
                />
              </CardContent>

              {/* Tab bar */}
              <div className="flex border-border border-t">
                <button
                  className={`flex-1 px-4 py-2.5 font-medium text-sm transition-colors ${
                    activeTab === 'skills'
                      ? 'border-primary border-b-2 text-foreground'
                      : 'border-transparent border-b-2 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab('skills')}
                  type="button"
                >
                  Skills Catalog
                </button>
                <button
                  className={`flex-1 px-4 py-2.5 font-medium text-sm transition-colors ${
                    activeTab === 'packs'
                      ? 'border-primary border-b-2 text-foreground'
                      : 'border-transparent border-b-2 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab('packs')}
                  type="button"
                >
                  Starter Packs
                </button>
                <button
                  className={`flex-1 px-4 py-2.5 font-medium text-sm transition-colors ${
                    activeTab === 'automations'
                      ? 'border-primary border-b-2 text-foreground'
                      : 'border-transparent border-b-2 text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab('automations')}
                  type="button"
                >
                  Automations
                </button>
              </div>

              {/* Tab content */}
              {activeTab === 'skills' && <SkillsCatalog />}
              {activeTab === 'packs' && <StarterPacks onPromptSeed={setPrompt} />}
              {activeTab === 'automations' && <AutomationsList />}
            </Card>
          </motion.div>
        </div>
      </div>
    </>
  );
}
