'use client';

import { MessageSquare, MessageSquarePlus, Package, Search, Settings, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import AutomationRunsPanel from '@/components/sidebar/AutomationRunsPanel';
import WorkspaceSwitcher from '@/components/sidebar/WorkspaceSwitcher';
import { Button } from '@/components/ui/button';
import { analytics } from '@/lib/analytics';
import { openSkillsManagerWindow } from '@/lib/skills-window';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useArenaStore } from '@/stores/arenaStore';
import { useAutomationStore } from '@/stores/automationStore';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useTaskStore } from '@/stores/taskStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import logoImage from '/assets/logo-1.png';
import FeedbackButton from './FeedbackButton';
import SessionPanel from './SessionPanel';

// Resize constraints
const MIN_WIDTH = 200; // pixels
const MAX_WIDTH_PERCENT = 0.5; // 50% of window
const DEFAULT_WIDTH = 260;

type SidebarTab = 'sessions' | 'automations';

export default function Sidebar() {
  const navigate = useNavigate();
  const { tasks, loadTasks, openLauncher, setShowSettings } = useTaskStore();
  const api = getTauriAPI();

  const [activeTab, setActiveTab] = useState<SidebarTab>('sessions');
  const automationUnreadCount = useAutomationStore((s) => s.unreadCount);

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

  const { arenas, loadArenas } = useArenaStore();

  // Merge arenas and tasks by createdAt for interleaved sidebar display
  const mergedList = useMemo(
    () =>
      [
        ...arenas.map((a) => ({ type: 'arena' as const, item: a, createdAt: a.createdAt })),
        ...tasks.map((t) => ({ type: 'task' as const, item: t, createdAt: t.createdAt })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [arenas, tasks]
  );

  // Initialize workspace and load tasks + arenas on mount
  useEffect(() => {
    useWorkspaceStore.getState().initialize();
    loadTasks();
    loadArenas(useWorkspaceStore.getState().activeWorkspace?.id);
    const wsId = useWorkspaceStore.getState().activeWorkspace?.id;
    if (wsId) {
      useAutomationStore.getState().loadUnreadCount(wsId);
    }
  }, [loadTasks, loadArenas]);

  // When the active workspace changes: reset the current task, navigate to
  // the home screen, and reload the workspace-scoped task list.
  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe((state, prevState) => {
      const currentId = state.activeWorkspace?.id;
      const prevId = prevState.activeWorkspace?.id;
      if (currentId && currentId !== prevId) {
        useTaskStore.getState().reset();
        useArenaStore.getState().reset();
        // Preview tabs point at files in the old workspace (4.7.4 AC#5)
        useFilePreviewStore.getState().closePreview();
        navigate('/');
        loadTasks();
        loadArenas(currentId);
        useAutomationStore.getState().loadUnreadCount(currentId);
      }
    });
    return unsubscribe;
  }, [loadTasks, navigate]);

  // Subscribe to automation run events to refresh runs panel and unread badge
  useEffect(() => {
    const unsubCompleted = api.onAutomationRunCompleted?.(() => {
      const wsId = useWorkspaceStore.getState().activeWorkspace?.id;
      if (wsId) {
        useAutomationStore.getState().loadUnreadCount(wsId);
        useAutomationStore.getState().loadRuns(wsId, false);
      }
    });
    const unsubStarted = api.onAutomationRunStarted?.(() => {
      const wsId = useWorkspaceStore.getState().activeWorkspace?.id;
      if (wsId) {
        useAutomationStore.getState().loadRuns(wsId, false);
      }
    });
    return () => {
      unsubCompleted?.();
      unsubStarted?.();
    };
  }, [api]);

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
              activeTab === 'automations' ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab('automations')}
            type="button"
          >
            <Zap className="h-3.5 w-3.5" />
            Auto
            {automationUnreadCount > 0 && <span className="h-2 w-2 rounded-full bg-destructive" />}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'sessions' && <SessionPanel mergedList={mergedList} />}
        {activeTab === 'automations' && <AutomationRunsPanel />}

        {/* Bottom Section - Logo and Settings */}
        <div className="flex items-center justify-between border-border border-t px-3 py-4">
          {/* Logo - Bottom Left */}
          <div className="flex items-center">
            <img alt="Openwork" src={logoImage} style={{ height: '20px', paddingLeft: '6px' }} />
          </div>

          {/* Feedback & Settings - Bottom Right */}
          <div className="flex items-center gap-1">
            <FeedbackButton />
            <Button onClick={openSkillsManagerWindow} size="icon" title="Skills Manager" variant="ghost">
              <Package className="h-4 w-4" />
            </Button>
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
