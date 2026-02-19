'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { FolderTree, MessageSquare, MessageSquarePlus, Search, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FileTreePanel from '@/components/sidebar/FileTreePanel';
import FoldersPanel from '@/components/sidebar/FoldersPanel';
import { TodoPanel } from '@/components/sidebar/TodoPanel';
import WorkspaceSwitcher from '@/components/sidebar/WorkspaceSwitcher';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { analytics } from '@/lib/analytics';
import { staggerContainer } from '@/lib/animations';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { Todo } from '@/shared';
import { useTaskStore } from '@/stores/taskStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import logoImage from '/assets/logo-1.png';
import CollapsibleSection from '../sidebar/CollapsibleSection';
import ConversationListItem from './ConversationListItem';
import FeedbackButton from './FeedbackButton';

// Stable empty array to avoid creating new references in selectors
const EMPTY_TODOS: Todo[] = [];

// Resize constraints
const MIN_WIDTH = 200; // pixels
const MAX_WIDTH_PERCENT = 0.5; // 50% of window
const DEFAULT_WIDTH = 260;

type SidebarTab = 'sessions' | 'files';

export default function Sidebar() {
  const navigate = useNavigate();
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate, openLauncher, setShowSettings } = useTaskStore();
  const api = getTauriAPI();
  const currentTaskTodos = useTaskStore((s) => s.todos.get(s.currentTask?.id ?? '') ?? EMPTY_TODOS);
  const hasTodos = currentTaskTodos.length > 0;

  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions');

  // Controlled open state for Tasks section — auto-expand when todos arrive
  const [tasksOpen, setTasksOpen] = useState(hasTodos);
  useEffect(() => {
    if (hasTodos) {
      setTasksOpen(true);
    }
  }, [hasTodos]);

  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle mouse move during resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT;
      const newWidth = Math.min(Math.max(e.clientX, MIN_WIDTH), maxWidth);
      setSidebarWidth(newWidth);
    },
    [isResizing]
  );

  // Handle mouse up to stop resizing
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove document listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Handle window resize to enforce max width constraint
  useEffect(() => {
    const handleWindowResize = () => {
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT;
      if (sidebarWidth > maxWidth) {
        setSidebarWidth(maxWidth);
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [sidebarWidth]);

  // Start resizing
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Initialize workspace and load tasks on mount
  useEffect(() => {
    useWorkspaceStore.getState().initialize();
    loadTasks();
  }, [loadTasks]);

  // When the active workspace changes: reset the current task, navigate to
  // the home screen, and reload the workspace-scoped task list.
  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      const currentId = state.activeWorkspace?.id;
      const prevId = prevState.activeWorkspace?.id;
      if (currentId && currentId !== prevId) {
        useTaskStore.getState().reset();
        navigate('/');
        loadTasks();
      }
    });
    return unsubscribe;
  }, [loadTasks, navigate]);

  // Subscribe to task status changes and task updates
  useEffect(() => {
    const unsubscribeStatusChange = api.onTaskStatusChange?.((data) => {
      updateTaskStatus(data.taskId, data.status);
    });

    const unsubscribeTaskUpdate = api.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    return () => {
      unsubscribeStatusChange?.();
      unsubscribeTaskUpdate();
    };
  }, [updateTaskStatus, addTaskUpdate, api]);

  const handleNewConversation = () => {
    analytics.trackNewTask();
    navigate('/');
  };

  return (
    <>
      <div className="relative flex h-screen flex-col border-border border-r bg-card pt-3" ref={sidebarRef} style={{ width: sidebarWidth }}>
        {/* Resize Handle */}
        <div className={`sidebar-resize-handle ${isResizing ? 'active' : ''}`} onMouseDown={handleResizeStart} />

        {/* Workspace Switcher */}
        <div className="border-border border-b px-2 py-1.5">
          <WorkspaceSwitcher />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 border-border border-b px-3 py-3">
          <Button
            className="flex-1 justify-center gap-2"
            data-testid="sidebar-new-task-button"
            onClick={handleNewConversation}
            size="sm"
            title="New Task"
            variant="default"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Task
          </Button>
          <Button className="px-2" onClick={openLauncher} size="sm" title="Search Tasks (⌘K)" variant="outline">
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-border border-b">
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-medium text-xs transition-colors ${
              activeTab === 'sessions' ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('sessions')}
            type="button"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Sessions
          </button>
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 font-medium text-xs transition-colors ${
              activeTab === 'files' ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('files')}
            type="button"
          >
            <FolderTree className="h-3.5 w-3.5" />
            Files
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'sessions' ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-2">
              <AnimatePresence mode="wait">
                {tasks.length === 0 ? (
                  <motion.div
                    animate={{ opacity: 1 }}
                    className="px-3 py-8 text-center text-muted-foreground text-sm"
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="empty"
                  >
                    No conversations yet
                  </motion.div>
                ) : (
                  <motion.div animate="animate" className="space-y-1" initial="initial" key="task-list" variants={staggerContainer}>
                    {tasks.map((task) => (
                      <ConversationListItem key={task.id} task={task} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileTreePanel />
          </div>
        )}

        {/* Pinned Panels - Always visible, never scroll out of view */}
        <div className="shrink-0 border-border border-t">
          {/* External Folders Panel */}
          <FoldersPanel />

          {/* Tasks Panel - Shows current task's todos, auto-expands when todos appear */}
          <CollapsibleSection onOpenChange={setTasksOpen} open={tasksOpen} title="Tasks">
            {hasTodos ? (
              <TodoPanel todos={currentTaskTodos} />
            ) : (
              <div className="px-2 py-3 text-center text-muted-foreground text-xs">No active tasks</div>
            )}
          </CollapsibleSection>
        </div>

        {/* Bottom Section - Logo and Settings */}
        <div className="flex items-center justify-between border-border border-t px-3 py-4">
          {/* Logo - Bottom Left */}
          <div className="flex items-center">
            <img alt="Openwork" src={logoImage} style={{ height: '20px', paddingLeft: '6px' }} />
          </div>

          {/* Feedback & Settings - Bottom Right */}
          <div className="flex items-center gap-1">
            <FeedbackButton />
            <Button
              data-testid="sidebar-settings-button"
              onClick={() => {
                analytics.trackOpenSettings();
                setShowSettings(true);
              }}
              size="icon"
              title="Settings"
              variant="ghost"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
