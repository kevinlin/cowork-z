'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
// Components
import Sidebar from './components/layout/Sidebar';
import { TaskLauncher } from './components/TaskLauncher';
import { analytics } from './lib/analytics';
import { springs, variants } from './lib/animations';
import { isRunningInTauri, setOnboardingComplete } from './lib/tauri-api';
import ExecutionPage from './pages/Execution';
// Pages
import HomePage from './pages/Home';
import { useTaskStore } from './stores/taskStore';

type AppStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const location = useLocation();

  // Get launcher actions
  const { openLauncher } = useTaskStore();

  // Track page views on route changes
  useEffect(() => {
    analytics.trackPageView(location.pathname);
  }, [location.pathname]);

  // Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openLauncher();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openLauncher]);

  useEffect(() => {
    const checkStatus = async () => {
      // Check if running in Tauri
      if (!isRunningInTauri()) {
        setErrorMessage('This application must be run inside the Cowork Z desktop app.');
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
      <TaskLauncher />
    </div>
  );
}
