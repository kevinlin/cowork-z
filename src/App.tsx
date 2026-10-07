'use client';

import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Loader2, PanelRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Toaster } from 'sonner';
import AboutDialog from './components/layout/AboutDialog';
import KeyboardShortcutsDialog from './components/layout/KeyboardShortcutsDialog';
import OpenCodeCliMissingDialog from './components/layout/OpenCodeCliMissingDialog';
import RightRail from './components/layout/RightRail';
import SettingsDialog from './components/layout/SettingsDialog';
// Components
import Sidebar from './components/layout/Sidebar';
import UpdateDialog from './components/layout/UpdateDialog';
import { TaskLauncher } from './components/TaskLauncher';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { analytics } from './lib/analytics';
import { springs, variants } from './lib/animations';
import { isRunningInTauri, setOnboardingComplete, toSyncUnlisten } from './lib/tauri-api';
import { getThemeById } from './lib/themes';
import ArenaPage from './pages/Arena';
import ExecutionPage from './pages/Execution';
// Pages
import HomePage from './pages/Home';
import SkillsManagerPage from './pages/SkillsManager';
import { useFilePreviewStore } from './stores/filePreviewStore';
import { useTaskStore } from './stores/taskStore';

type AppStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Get store actions
  const {
    openLauncher,
    showSettings,
    setShowSettings,
    showAbout,
    setShowAbout,
    showKeyboardShortcuts,
    setShowKeyboardShortcuts,
    showCliMissing,
    setShowCliMissing,
  } = useTaskStore();

  // Right rail visibility (4.7.1). Not persisted. Any preview open un-hides it,
  // so a file link clicked in chat always lands somewhere visible.
  const [railHidden, setRailHidden] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const openSeq = useFilePreviewStore((s) => s.openSeq);
  useEffect(() => {
    if (openSeq > 0) {
      setRailHidden(false);
    }
  }, [openSeq]);

  // Theme — load persisted theme, detect OS dark-mode on first launch
  const { themeId, switchTheme } = useTheme();

  // App updates — auto-check on startup, listen for menu event
  const appUpdate = useAppUpdate();

  // Listen for native "show-about" menu event from Rust
  useEffect(
    () =>
      toSyncUnlisten(
        listen('show-about', () => {
          setShowAbout(true);
        })
      ),
    [setShowAbout]
  );

  // Listen for native "show-keyboard-shortcuts" menu event from Rust
  useEffect(
    () =>
      toSyncUnlisten(
        listen('show-keyboard-shortcuts', () => {
          setShowKeyboardShortcuts(true);
        })
      ),
    [setShowKeyboardShortcuts]
  );

  // Track page views on route changes
  useEffect(() => {
    analytics.trackPageView(location.pathname);
  }, [location.pathname]);

  // App-level keyboard shortcuts: Cmd+, (settings), Cmd+N (new task), Cmd+K (launcher)
  const handleOpenSettings = useCallback(() => {
    analytics.trackOpenSettings();
    setShowSettings(true);
  }, [setShowSettings]);

  const handleNewTask = useCallback(() => {
    analytics.trackNewTask();
    navigate('/');
  }, [navigate]);

  const handleOpenKeyboardShortcuts = useCallback(() => {
    setShowKeyboardShortcuts(true);
  }, [setShowKeyboardShortcuts]);

  useKeyboardShortcuts({
    openSettings: handleOpenSettings,
    newTask: handleNewTask,
    openLauncher,
    openKeyboardShortcuts: handleOpenKeyboardShortcuts,
  });

  useEffect(() => {
    const checkStatus = async () => {
      // Check if running in Tauri
      if (!isRunningInTauri()) {
        setErrorMessage('This application must be run inside the Cowork-Z desktop app.');
        setStatus('error');
        return;
      }

      try {
        // Mark onboarding as complete (no welcome screen needed)
        await setOnboardingComplete(true);
        setStatus('ready');
      } catch (error) {
        console.error('Failed to initialize app:', error);
        // Still allow app to run even if setting fails
        setStatus('ready');
      }
    };

    checkStatus();
  }, []);

  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <h1 className="mb-2 font-semibold text-foreground text-xl">Unable to Start</h1>
          <p className="text-muted-foreground">{errorMessage}</p>
        </div>
      </div>
    );
  }

  // Skills Manager window — standalone layout, no sidebar
  if (location.pathname === '/skills') {
    return <SkillsManagerPage />;
  }

  // Ready - render the app with sidebar
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Invisible drag region for window dragging (macOS hiddenInset titlebar) */}
      <div className="drag-region pointer-events-none fixed top-0 right-0 left-0 z-50 h-10" />
      <Sidebar />
      <div className="flex min-w-0 flex-1 overflow-hidden" ref={contentRef}>
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <Routes key={location.pathname} location={location}>
              <Route
                element={
                  <motion.div
                    animate="animate"
                    className="h-full"
                    exit="exit"
                    initial="initial"
                    transition={springs.gentle}
                    variants={variants.fadeUp}
                  >
                    <HomePage />
                  </motion.div>
                }
                path="/"
              />
              <Route
                element={
                  <motion.div
                    animate="animate"
                    className="h-full"
                    exit="exit"
                    initial="initial"
                    transition={springs.gentle}
                    variants={variants.fadeUp}
                  >
                    <ExecutionPage />
                  </motion.div>
                }
                path="/execution/:id"
              />
              <Route
                element={
                  <motion.div
                    animate="animate"
                    className="h-full"
                    exit="exit"
                    initial="initial"
                    transition={springs.gentle}
                    variants={variants.fadeUp}
                  >
                    <ArenaPage />
                  </motion.div>
                }
                path="/arena/:arenaId"
              />
              <Route element={<Navigate replace to="/" />} path="*" />
            </Routes>
          </AnimatePresence>
          <button
            aria-controls="right-rail"
            aria-expanded={!railHidden}
            aria-label={railHidden ? 'Show side panel' : 'Hide side panel'}
            className="no-drag absolute top-3 right-3 z-20 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setRailHidden((h) => !h)}
            title={railHidden ? 'Show side panel' : 'Hide side panel'}
            type="button"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </main>
        <RightRail contentRef={contentRef} hidden={railHidden} />
      </div>
      <TaskLauncher />
      <Toaster position="bottom-right" theme={getThemeById(themeId).isDark ? 'dark' : 'light'} />
      <SettingsDialog onOpenChange={setShowSettings} onSwitchTheme={switchTheme} open={showSettings} themeId={themeId} />
      <AboutDialog onOpenChange={setShowAbout} open={showAbout} />
      <KeyboardShortcutsDialog onOpenChange={setShowKeyboardShortcuts} open={showKeyboardShortcuts} />
      <OpenCodeCliMissingDialog onOpenChange={setShowCliMissing} open={showCliMissing} />
      <UpdateDialog
        error={appUpdate.error}
        onInstall={appUpdate.installUpdate}
        onOpenChange={appUpdate.setShowDialog}
        onRetry={appUpdate.checkForUpdate}
        open={appUpdate.showDialog}
        status={appUpdate.status}
        updateInfo={appUpdate.updateInfo}
      />
    </div>
  );
}
