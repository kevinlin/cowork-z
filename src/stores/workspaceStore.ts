import { create } from 'zustand';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { Workspace } from '@/shared';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  addWorkspace: (folderPath: string) => Promise<Workspace>;
  removeWorkspace: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspace: null,
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      const api = getTauriAPI();
      set({ isLoading: true, error: null });
      const [workspace, workspaces] = await Promise.all([api.initializeWorkspace(), api.listWorkspaces()]);
      set({ activeWorkspace: workspace, workspaces, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  switchWorkspace: async (id) => {
    try {
      const api = getTauriAPI();
      const workspace = await api.switchWorkspace(id);
      const workspaces = await api.listWorkspaces();
      set({ activeWorkspace: workspace, workspaces, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addWorkspace: async (folderPath) => {
    const api = getTauriAPI();
    const workspace = await api.addWorkspace(folderPath);
    const workspaces = await api.listWorkspaces();
    set({ workspaces });
    return workspace;
  },

  removeWorkspace: async (id) => {
    const api = getTauriAPI();
    await api.removeWorkspace(id);
    const workspaces = await api.listWorkspaces();
    set({ workspaces });
  },
}));
