import { create } from 'zustand';
import type { SkillMeta, SkillWithStatus } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';

interface SkillsState {
  installedSkills: SkillMeta[];
  isLoaded: boolean;
  fetchInstalledSkills: () => Promise<void>;
}

let fetching = false;

export const useSkillsStore = create<SkillsState>((set) => ({
  installedSkills: [],
  isLoaded: false,

  fetchInstalledSkills: async () => {
    if (fetching) return;
    fetching = true;
    try {
      const api = getTauriAPI();
      const all: SkillWithStatus[] = await api.listSkillsWithStatus();
      const installed = all.filter((s) => s.status.installed).map((s) => s.meta);
      set({ installedSkills: installed, isLoaded: true });
    } catch {
      set({ isLoaded: true });
    } finally {
      fetching = false;
    }
  },
}));
