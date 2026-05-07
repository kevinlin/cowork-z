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
  /** URL to pre-fill in the Add Repo dialog when it opens (consumed once). */
  prefillAddRepoUrl: string | null;
  /** Controls the Add Repo dialog from outside the toolbar. */
  addRepoDialogOpen: boolean;

  fetchRepos: () => Promise<void>;
  fetchRepoSkills: () => Promise<void>;
  fetchInstalledSkills: () => Promise<void>;
  setTargetFolder: (folder: TargetFolder) => void;
  setSelectedRepoId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string) => void;
  setPrefillAddRepoUrl: (url: string | null) => void;
  setAddRepoDialogOpen: (open: boolean) => void;
  addRepo: (input: { url: string; branch?: string; authToken?: string }) => Promise<SkillRepo>;
  removeRepo: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
}

type SkillsManagerData = Omit<
  SkillsManagerState,
  | 'fetchRepos'
  | 'fetchRepoSkills'
  | 'fetchInstalledSkills'
  | 'setTargetFolder'
  | 'setSelectedRepoId'
  | 'setSearchQuery'
  | 'setActiveCategory'
  | 'setPrefillAddRepoUrl'
  | 'setAddRepoDialogOpen'
  | 'addRepo'
  | 'removeRepo'
  | 'refreshAll'
>;

export const INITIAL_SKILLS_MANAGER_STATE: SkillsManagerData = {
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
  prefillAddRepoUrl: null,
  addRepoDialogOpen: false,
};

export const useSkillsManagerStore = create<SkillsManagerState>((set, get) => ({
  ...INITIAL_SKILLS_MANAGER_STATE,

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
  setPrefillAddRepoUrl: (url) => set({ prefillAddRepoUrl: url }),
  setAddRepoDialogOpen: (open) => set({ addRepoDialogOpen: open }),

  addRepo: async ({ url, branch, authToken }) => {
    const api = getTauriAPI();
    const repo = await api.skillReposAdd(url, branch, authToken);
    await get().refreshAll();
    return repo;
  },

  removeRepo: async (id: string) => {
    const api = getTauriAPI();
    await api.skillReposRemove(id);
    set({ selectedRepoId: null });
    await get().refreshAll();
  },

  refreshAll: async () => {
    const { fetchRepos, fetchRepoSkills, fetchInstalledSkills } = get();
    await Promise.all([fetchRepos(), fetchRepoSkills(), fetchInstalledSkills()]);
  },
}));
