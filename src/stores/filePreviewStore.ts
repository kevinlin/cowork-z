import { create } from 'zustand';

import { isPathSafe } from '@/lib/file-utils';
import type { DirectoryEntry } from '@/shared/types/workspace';

interface FilePreviewState {
  /** The file currently being previewed */
  selectedFile: DirectoryEntry | null;
  /** Whether the preview panel is visible */
  isPreviewOpen: boolean;
  /** Open the preview panel for a given file */
  openPreview: (file: DirectoryEntry) => void;
  /** Close the preview panel */
  closePreview: () => void;
  /**
   * Open preview from a file path string (e.g. from MediaGallery).
   * Constructs a minimal DirectoryEntry from the path.
   */
  openPreviewByPath: (path: string) => void;
}

export const useFilePreviewStore = create<FilePreviewState>((set) => ({
  selectedFile: null,
  isPreviewOpen: false,

  openPreview: (file) => set({ selectedFile: file, isPreviewOpen: true }),

  closePreview: () => set({ selectedFile: null, isPreviewOpen: false }),

  openPreviewByPath: (path) => {
    // Agent-supplied paths (markdown links, media thumbnails, tool cards)
    // must pass the same gate as chat links — no traversal segments or
    // sensitive system paths (2026-06-12 review #10).
    if (!isPathSafe(path)) return;

    const segments = path.replace(/\\/g, '/').split('/');
    const name = segments[segments.length - 1] || path;
    const lastDot = name.lastIndexOf('.');
    const extension = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : undefined;

    set({
      selectedFile: {
        name,
        path,
        isDirectory: false,
        isSymlink: false,
        extension,
      },
      isPreviewOpen: true,
    });
  },
}));
