'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquarePlus, Search, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TodoPanel } from '@/components/execution/TodoPanel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getAccomplish } from '@/lib/accomplish';
import { analytics } from '@/lib/analytics';
import { staggerContainer } from '@/lib/animations';
import { useTaskStore } from '@/stores/taskStore';
import logoImage from '/assets/logo-1.png';
import CollapsibleSection from './CollapsibleSection';
import ConversationListItem from './ConversationListItem';
import FoldersPanel from './FoldersPanel';
import SettingsDialog from './SettingsDialog';

// Resize constraints
const MIN_WIDTH = 200; // pixels
const MAX_WIDTH_PERCENT = 0.5; // 50% of window
const DEFAULT_WIDTH = 260;

export default function Sidebar() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate, openLauncher } = useTaskStore();
  const accomplish = getAccomplish();
  const currentTaskTodos = useTaskStore((s) => s.todos.get(s.currentTask?.id ?? '') ?? []);
  const hasTodos = currentTaskTodos.length > 0;

  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle mouse move during resize
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT;
    const newWidth = Math.min(Math.max(e.clientX, MIN_WIDTH), maxWidth);
    setSidebarWidth(newWidth);
  }, [isResizing]);

  // Handle mouse up to stop resizing
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove document listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection while resizing
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

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Subscribe to task status changes (queued -> running) and task updates (complete/error)
  // This ensures sidebar always reflects current task status
  useEffect(() => {
    const unsubscribeStatusChange = accomplish.onTaskStatusChange?.((data) => {
      updateTaskStatus(data.taskId, data.status);
    });

    const unsubscribeTaskUpdate = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    return () => {
      unsubscribeStatusChange?.();
      unsubscribeTaskUpdate();
    };
  }, [updateTaskStatus, addTaskUpdate, accomplish]);

  const handleNewConversation = () => {
    analytics.trackNewTask();
    navigate('/');
  };

  return (
    <>
      <div
        ref={sidebarRef}
        className="relative flex h-screen flex-col border-border border-r bg-card pt-12"
        style={{ width: sidebarWidth }}
      >
        {/* Resize Handle */}
        <div
          className={`sidebar-resize-handle ${isResizing ? 'active' : ''}`}
          onMouseDown={handleResizeStart}
        />

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

        {/* Scrollable Content Area */}
        <ScrollArea className="flex-1">
          {/* Conversation List - Always Expanded */}
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

          {/* Folders Panel - Collapsible, Default Collapsed */}
          <FoldersPanel />

          {/* Tasks Panel - Shows current task's todos, auto-expands when todos appear */}
          <CollapsibleSection defaultOpen={hasTodos} disabled={!hasTodos} key={String(hasTodos)} title="Tasks">
            {hasTodos ? (
              <TodoPanel todos={currentTaskTodos} />
            ) : (
              <div className="px-2 py-3 text-center text-muted-foreground text-xs">
                No active tasks
              </div>
            )}
          </CollapsibleSection>
        </ScrollArea>

        {/* Bottom Section - Logo and Settings */}
        <div className="flex items-center justify-between border-border border-t px-3 py-4">
          {/* Logo - Bottom Left */}
          <div className="flex items-center">
            <img alt="Openwork" src={logoImage} style={{ height: '20px', paddingLeft: '6px' }} />
          </div>

          {/* Settings Button - Bottom Right */}
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

      <SettingsDialog onOpenChange={setShowSettings} open={showSettings} />
    </>
  );
}
