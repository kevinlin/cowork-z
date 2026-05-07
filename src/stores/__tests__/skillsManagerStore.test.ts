import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSkillReposList = vi.fn();
const mockSkillReposAdd = vi.fn();
const mockSkillReposSkills = vi.fn();
const mockSkillsListInstalled = vi.fn();
const mockSkillReposRemove = vi.fn();

vi.mock('@/lib/tauri-api-interface', () => ({
  getTauriAPI: vi.fn(() => ({
    skillReposList: mockSkillReposList,
    skillReposAdd: mockSkillReposAdd,
    skillReposSkills: mockSkillReposSkills,
    skillsListInstalled: mockSkillsListInstalled,
    skillReposRemove: mockSkillReposRemove,
  })),
}));

import { INITIAL_SKILLS_MANAGER_STATE, useSkillsManagerStore } from '../skillsManagerStore';
import { makeRepo } from './skillsManagerTestUtils';

describe('skillsManagerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillsManagerStore.setState(INITIAL_SKILLS_MANAGER_STATE);
    mockSkillReposList.mockResolvedValue([]);
    mockSkillReposSkills.mockResolvedValue([]);
    mockSkillsListInstalled.mockResolvedValue([]);
  });

  describe('addRepo', () => {
    it('calls skillReposAdd, then refreshAll, and returns the new repo', async () => {
      const newRepo = makeRepo('r1', 'https://github.com/x/y.git');
      mockSkillReposAdd.mockResolvedValue(newRepo);
      mockSkillReposList.mockResolvedValue([newRepo]);

      const result = await useSkillsManagerStore
        .getState()
        .addRepo({ url: 'https://github.com/x/y.git', branch: 'develop', authToken: 'tok' });

      expect(mockSkillReposAdd).toHaveBeenCalledWith('https://github.com/x/y.git', 'develop', 'tok');
      expect(mockSkillReposList).toHaveBeenCalled();
      expect(useSkillsManagerStore.getState().repos).toEqual([newRepo]);
      expect(result).toEqual(newRepo);
    });

    it('propagates errors and leaves store state intact', async () => {
      const initialRepo = makeRepo('r0', 'https://github.com/a/b.git');
      useSkillsManagerStore.setState({ repos: [initialRepo] });
      mockSkillReposAdd.mockRejectedValue(new Error('clone failed'));

      await expect(useSkillsManagerStore.getState().addRepo({ url: 'https://github.com/x/y.git' })).rejects.toThrow('clone failed');

      expect(mockSkillReposList).not.toHaveBeenCalled();
      expect(useSkillsManagerStore.getState().repos).toEqual([initialRepo]);
    });

    it('passes undefined for missing branch and authToken', async () => {
      const newRepo = makeRepo('r2', 'https://github.com/p/q.git');
      mockSkillReposAdd.mockResolvedValue(newRepo);
      mockSkillReposList.mockResolvedValue([newRepo]);

      await useSkillsManagerStore.getState().addRepo({ url: 'https://github.com/p/q.git' });

      expect(mockSkillReposAdd).toHaveBeenCalledWith('https://github.com/p/q.git', undefined, undefined);
    });
  });

  describe('setPrefillAddRepoUrl + setAddRepoDialogOpen', () => {
    it('updates prefillAddRepoUrl', () => {
      useSkillsManagerStore.getState().setPrefillAddRepoUrl('https://github.com/x/y.git');
      expect(useSkillsManagerStore.getState().prefillAddRepoUrl).toBe('https://github.com/x/y.git');

      useSkillsManagerStore.getState().setPrefillAddRepoUrl(null);
      expect(useSkillsManagerStore.getState().prefillAddRepoUrl).toBeNull();
    });

    it('updates addRepoDialogOpen', () => {
      expect(useSkillsManagerStore.getState().addRepoDialogOpen).toBe(false);

      useSkillsManagerStore.getState().setAddRepoDialogOpen(true);
      expect(useSkillsManagerStore.getState().addRepoDialogOpen).toBe(true);

      useSkillsManagerStore.getState().setAddRepoDialogOpen(false);
      expect(useSkillsManagerStore.getState().addRepoDialogOpen).toBe(false);
    });
  });
});
