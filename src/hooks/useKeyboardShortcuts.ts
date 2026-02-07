import { useEffect, useMemo } from 'react';

interface ShortcutActions {
  openSettings: () => void;
  newTask: () => void;
  openLauncher: () => void;
}

/**
 * Centralized hook for app-level keyboard shortcuts.
 *
 * Shortcuts:
 * - Cmd+, / Ctrl+, — Open settings
 * - Cmd+N / Ctrl+N — New task
 * - Cmd+K / Ctrl+K — Open task launcher
 *
 * Platform modifier is handled automatically (metaKey on macOS, ctrlKey on Windows/Linux).
 */
export function useKeyboardShortcuts(actions: ShortcutActions) {
  // Stabilize actions reference to avoid re-attaching listener on every render
  const stableActions = useMemo(
    () => actions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions.openSettings, actions.newTask, actions.openLauncher]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      switch (e.key) {
        case ',':
          e.preventDefault();
          stableActions.openSettings();
          break;
        case 'n':
          e.preventDefault();
          stableActions.newTask();
          break;
        case 'k':
          e.preventDefault();
          stableActions.openLauncher();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stableActions]);
}
