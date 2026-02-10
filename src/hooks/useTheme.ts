/**
 * useTheme — load persisted theme on mount, apply it, expose switch function.
 *
 * On first launch (no persisted theme), detect OS dark-mode preference
 * and default to classic-dark or classic-light accordingly.
 */

import { useCallback, useEffect, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { applyTheme, getThemeById, THEMES, type ThemeId } from '@/lib/themes';

interface UseThemeReturn {
  /** Currently active theme ID */
  themeId: ThemeId;
  /** Switch to a different theme (immediately applies + persists) */
  switchTheme: (id: ThemeId) => void;
  /** All available theme definitions */
  themes: typeof THEMES;
  /** True once the persisted theme has been loaded and applied */
  loaded: boolean;
}

export function useTheme(): UseThemeReturn {
  const [themeId, setThemeId] = useState<ThemeId>('classic-light');
  const [loaded, setLoaded] = useState(false);

  // Load persisted theme on mount
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const api = getTauriAPI();
        const persisted = await api.getTheme();

        if (cancelled) return;

        let resolvedId: ThemeId;

        if (persisted) {
          resolvedId = persisted as ThemeId;
        } else {
          // First launch — detect OS preference
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          resolvedId = prefersDark ? 'classic-dark' : 'classic-light';
          // Persist the auto-detected default
          api.setTheme(resolvedId).catch(() => {});
        }

        const theme = getThemeById(resolvedId);
        applyTheme(theme);
        setThemeId(resolvedId);
      } catch {
        // Fallback: apply classic-light if Tauri API unavailable
        applyTheme(getThemeById('classic-light'));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTheme = useCallback((id: ThemeId) => {
    const theme = getThemeById(id);
    applyTheme(theme);
    setThemeId(id);

    // Persist in background
    try {
      const api = getTauriAPI();
      api.setTheme(id).catch(() => {});
    } catch {
      // Ignore — theme is already applied visually
    }
  }, []);

  return { themeId, switchTheme, themes: THEMES, loaded };
}
