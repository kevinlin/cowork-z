'use client';

import { motion, useReducedMotion } from 'framer-motion';
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

const HOME_TABS: { id: HomeTab; label: string }[] = [
  { id: 'skills', label: 'Skills Catalog' },
  { id: 'packs', label: 'Starter Packs' },
  { id: 'automations', label: 'Automations' },
];

// Time-aware greeting: same question, but it knows what time it is —
// the kind of thing a colleague would get right.
function timeAwareGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'What will you accomplish this morning?';
  if (hour >= 12 && hour < 17) return 'What will you accomplish this afternoon?';
  if (hour >= 17 && hour < 22) return 'What will you accomplish this evening?';
  return 'What will you accomplish tonight?';
}

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<SkillMeta[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<HomeTab>('skills');
  const [greeting] = useState(timeAwareGreeting);

  const { startTask, isLoading, enqueuePermissionRequest } = useTaskStore();
  const navigate = useNavigate();
  const api = getTauriAPI();
  const reduceMotion = useReducedMotion();

  // Subscribe to permission requests. Task updates are handled by the single
  // global onTaskUpdate subscription in taskStore (technical review #20).
  useEffect(() => {
    const unsubscribePermission = api.onPermissionRequest((request) => {
      enqueuePermissionRequest(request);
    });
    return () => {
      unsubscribePermission();
    };
  }, [enqueuePermissionRequest, api]);

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
      <div className="relative flex h-full items-center justify-center overflow-y-auto bg-muted p-6">
        {/* Arena entry point — top-right corner */}
        <motion.div
          animate={{ opacity: 1 }}
          className="absolute top-6 right-6 z-10"
          initial={{ opacity: 0 }}
          transition={{ ...springs.gentle, delay: 0.05 }}
        >
          <button
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
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
            className="text-balance font-light text-4xl text-foreground tracking-tight"
            data-testid="home-title"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
            transition={springs.gentle}
          >
            {greeting}
          </motion.h1>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
            transition={{ ...springs.gentle, delay: 0.1 }}
          >
            <Card className="flex max-h-[calc(100vh-3rem)] w-full flex-col gap-0 bg-card py-0 shadow-md">
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
                {HOME_TABS.map((tab) => (
                  <button
                    className={`relative flex-1 px-4 py-2.5 font-medium text-sm transition-colors ${
                      activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <motion.div
                        className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                        layoutId="home-tab-underline"
                        transition={reduceMotion ? { duration: 0 } : springs.snappy}
                      />
                    )}
                  </button>
                ))}
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
