import { create } from 'zustand';

import { isPathSafe } from '@/lib/file-utils';
import type { DirectoryEntry } from '@/shared/types/workspace';

interface FilePreviewState {
  /** Open preview tabs, in tab-strip order */
  tabs: DirectoryEntry[];
  /** Path of the active preview tab; null means the right rail's Files tab */
  activePath: string | null;
  /** Bumped on every successful open, including re-opening the active file.
   * App un-hides the rail and RightRail widens it when this changes. */
  openSeq: number;
  /** Open a file as a tab (or activate its existing tab) */
  openPreview: (file: DirectoryEntry) => void;
  /**
   * Open preview from a file path string (e.g. from MediaGallery).
   * Constructs a minimal DirectoryEntry from the path.
   */
  openPreviewByPath: (path: string) => void;
  /** Close one tab; if it was active, activate the tab to its right, else left, else Files */
  closeTab: (path: string) => void;
  /** Switch tabs; null shows the Files tab */
  setActive: (path: string | null) => void;
  /** Close every preview tab */
  closePreview: () => void;
}

/** The active tab's entry, or null while the Files tab is showing */
export const selectActiveFile = (state: Pick<FilePreviewState, 'tabs' | 'activePath'>): DirectoryEntry | null =>
  state.activePath === null ? null : (state.tabs.find((t) => t.path === state.activePath) ?? null);

export const useFilePreviewStore = create<FilePreviewState>((set, get) => ({
  tabs: [],
  activePath: null,
  openSeq: 0,

  openPreview: (file) =>
    set((state) => ({
      tabs: state.tabs.some((t) => t.path === file.path) ? state.tabs : [...state.tabs, file],
      activePath: file.path,
      openSeq: state.openSeq + 1,
    })),

  openPreviewByPath: (path) => {
    // Agent-supplied paths (markdown links, media thumbnails, tool cards)
    // must pass the same gate as chat links — no traversal segments or
    // sensitive system paths (2026-06-12 review #10).
    if (!isPathSafe(path)) return;

    const segments = path.replace(/\\/g, '/').split('/');
    const name = segments[segments.length - 1] || path;
    const lastDot = name.lastIndexOf('.');
    const extension = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : undefined;

    get().openPreview({ name, path, isDirectory: false, isSymlink: false, extension });
  },

  closeTab: (path) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.path === path);
      if (index === -1) return {};
      const tabs = state.tabs.filter((t) => t.path !== path);
      if (state.activePath !== path) return { tabs };
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activePath: next?.path ?? null };
    }),

  setActive: (path) => set({ activePath: path }),

  closePreview: () => set({ tabs: [], activePath: null }),
}));
