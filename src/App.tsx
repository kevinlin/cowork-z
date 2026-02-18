'use client';

import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { FilePreviewPanel } from './components/file-preview';
import AboutDialog from './components/layout/AboutDialog';
import OpenCodeCliMissingDialog from './components/layout/OpenCodeCliMissingDialog';
import SettingsDialog from './components/layout/SettingsDialog';
// Components
import Sidebar from './components/layout/Sidebar';
import UpdateDialog from './components/layout/UpdateDialog';
import { TaskLauncher } from './components/TaskLauncher';
import { Toaster } from 'sonner';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { analytics } from './lib/analytics';
import { getThemeById } from './lib/themes';
import { springs, variants } from './lib/animations';
import { formatPathForChat } from './lib/file-utils';
import { isRunningInTauri, setOnboardingComplete } from './lib/tauri-api';
import ExecutionPage from './pages/Execution';
// Pages
import HomePage from './pages/Home';
import { useFilePreviewStore } from './stores/filePreviewStore';
import { useTaskStore } from './stores/taskStore';

type AppStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Get store actions
  const { openLauncher, showSettings, setShowSettings, showAbout, setShowAbout, showCliMissing, setShowCliMissing } = useTaskStore();

  // File preview state
  const { selectedFile, isPreviewOpen, closePreview } = useFilePreviewStore();

  const handleAddFileToChat = useCallback((file: { path: string }) => {
    const formatted = formatPathForChat(file.path);
    if (formatted) {
      window.dispatchEvent(new CustomEvent('add-to-chat', { detail: { text: formatted } }));
    }
  }, []);

  // ── Resizable preview panel ───────────────────────────────────────
  const PREVIEW_MIN_WIDTH = 280;
  const PREVIEW_MAX_WIDTH = 700;
  const PREVIEW_DEFAULT_WIDTH = 400;
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_DEFAULT_WIDTH);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = previewWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startX - ev.clientX;
        const newWidth = Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, startWidth + delta));
        setPreviewWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [previewWidth]
  );

  // Theme — load persisted theme, detect OS dark-mode on first launch
  const { themeId, switchTheme } = useTheme();

  // App updates — auto-check on startup, listen for menu event
  const appUpdate = useAppUpdate();

  // Listen for native "show-about" menu event from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('show-about', () => {
      setShowAbout(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [setShowAbout]);

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

  useKeyboardShortcuts({
    openSettings: handleOpenSettings,
    newTask: handleNewTask,
    openLauncher,
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

  // Ready - render the app with sidebar
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Invisible drag region for window dragging (macOS hiddenInset titlebar) */}
      <div className="drag-region pointer-events-none fixed top-0 right-0 left-0 z-50 h-10" />
      <Sidebar />
      <main className="flex-1 overflow-hidden">
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
            <Route element={<Navigate replace to="/" />} path="*" />
          </Routes>
        </AnimatePresence>
      </main>
      {isPreviewOpen && selectedFile && (
        <>
          {/* Drag handle for resizing the preview panel */}
          <div
            aria-label="Resize file preview"
            aria-valuemax={PREVIEW_MAX_WIDTH}
            aria-valuemin={PREVIEW_MIN_WIDTH}
            aria-valuenow={previewWidth}
            className="group relative w-0 shrink-0 cursor-col-resize"
            onMouseDown={handleResizeStart}
            role="separator"
            tabIndex={0}
          >
            <div className="absolute top-0 bottom-0 -left-1 z-10 w-2 transition-colors group-hover:bg-primary/20 group-active:bg-primary/30" />
          </div>
          <div className="shrink-0" style={{ width: previewWidth }}>
            <FilePreviewPanel file={selectedFile} onAddToChat={handleAddFileToChat} onClose={closePreview} />
          </div>
        </>
      )}
      <TaskLauncher />
      <Toaster position="bottom-right" theme={getThemeById(themeId).isDark ? 'dark' : 'light'} />
      <SettingsDialog onOpenChange={setShowSettings} onSwitchTheme={switchTheme} open={showSettings} themeId={themeId} />
      <AboutDialog onOpenChange={setShowAbout} open={showAbout} />
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
