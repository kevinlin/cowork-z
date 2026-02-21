import { create } from 'zustand';
import type { InstalledSkill, RepoSkill, SkillRepo } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';

type TargetFolder = 'opencode' | 'claude' | 'agents';

interface SkillsManagerState {
  repos: SkillRepo[];
  reposLoading: boolean;
  repoSkills: RepoSkill[];
  repoSkillsLoading: boolean;
  installedSkills: InstalledSkill[];
  installedLoading: boolean;
  targetFolder: TargetFolder;
  selectedRepoId: string | null;
  searchQuery: string;
  activeCategory: string;

  fetchRepos: () => Promise<void>;
  fetchRepoSkills: () => Promise<void>;
  fetchInstalledSkills: () => Promise<void>;
  setTargetFolder: (folder: TargetFolder) => void;
  setSelectedRepoId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string) => void;
  refreshAll: () => Promise<void>;
}

export const useSkillsManagerStore = create<SkillsManagerState>((set, get) => ({
  repos: [],
  reposLoading: false,
  repoSkills: [],
  repoSkillsLoading: false,
  installedSkills: [],
  installedLoading: false,
  targetFolder: 'opencode',
  selectedRepoId: null,
  searchQuery: '',
  activeCategory: 'All',

  fetchRepos: async () => {
    set({ reposLoading: true });
    try {
      const api = getTauriAPI();
      const repos = await api.skillReposList();
      set({ repos, reposLoading: false });
    } catch {
      set({ reposLoading: false });
    }
  },

  fetchRepoSkills: async () => {
    set({ repoSkillsLoading: true });
    try {
      const api = getTauriAPI();
      const { selectedRepoId, targetFolder } = get();
      const skills = await api.skillReposSkills(selectedRepoId ?? undefined, targetFolder);
      set({ repoSkills: skills, repoSkillsLoading: false });
    } catch {
      set({ repoSkillsLoading: false });
    }
  },

  fetchInstalledSkills: async () => {
    set({ installedLoading: true });
    try {
      const api = getTauriAPI();
      const { targetFolder } = get();
      const skills = await api.skillsListInstalled(targetFolder);
      set({ installedSkills: skills, installedLoading: false });
    } catch {
      set({ installedLoading: false });
    }
  },

  setTargetFolder: (folder) => {
    set({ targetFolder: folder });
    const { fetchRepoSkills, fetchInstalledSkills } = get();
    fetchRepoSkills();
    fetchInstalledSkills();
  },

  setSelectedRepoId: (id) => {
    set({ selectedRepoId: id, activeCategory: 'All' });
    get().fetchRepoSkills();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setActiveCategory: (category) => set({ activeCategory: category }),

  refreshAll: async () => {
    const { fetchRepos, fetchRepoSkills, fetchInstalledSkills } = get();
    await Promise.all([fetchRepos(), fetchRepoSkills(), fetchInstalledSkills()]);
  },
}));
