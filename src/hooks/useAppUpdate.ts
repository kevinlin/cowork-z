import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkForUpdate, installUpdate, type UpdateInfo } from '@/lib/tauri-api';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'error' | 'up-to-date';

interface AppUpdateState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  /** True when the dialog should be visible */
  showDialog: boolean;
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({
    status: 'idle',
    updateInfo: null,
    error: null,
    showDialog: false,
  });
  const hasAutoChecked = useRef(false);

  const doCheck = useCallback(async (showDialogOnNoUpdate: boolean) => {
    setState((prev) => ({ ...prev, status: 'checking', error: null, showDialog: true }));
    try {
      const info = await checkForUpdate();
      if (info) {
        setState({ status: 'available', updateInfo: info, error: null, showDialog: true });
      } else {
        setState({
          status: 'up-to-date',
          updateInfo: null,
          error: null,
          showDialog: showDialogOnNoUpdate,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', updateInfo: null, error: message, showDialog: showDialogOnNoUpdate });
    }
  }, []);

  const doInstall = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'downloading' }));
    try {
      await installUpdate();
      // App will restart after install, so this line is unlikely to be reached
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    }
  }, []);

  const setShowDialog = useCallback((show: boolean) => {
    setState((prev) => ({ ...prev, showDialog: show }));
  }, []);

  // Auto-check on startup (once, silently — only show dialog if update found)
  useEffect(() => {
    if (hasAutoChecked.current) return;
    hasAutoChecked.current = true;

    const autoCheck = async () => {
      try {
        const info = await checkForUpdate();
        if (info) {
          setState({ status: 'available', updateInfo: info, error: null, showDialog: true });
        }
        // If no update, stay silent (no dialog)
      } catch {
        // Silent failure on auto-check
      }
    };

    // Delay auto-check by 3s to let the app finish loading
    const timer = setTimeout(autoCheck, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Listen for "Check for Updates" menu event from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('check-for-updates', () => {
      doCheck(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [doCheck]);

  return {
    ...state,
    checkForUpdate: () => doCheck(true),
    installUpdate: doInstall,
    setShowDialog,
  };
}
