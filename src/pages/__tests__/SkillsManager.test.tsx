import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_FOCUS_REPO_KEY } from '@/lib/skills-window';
import { makeRepo } from '@/stores/__tests__/skillsManagerTestUtils';
import { INITIAL_SKILLS_MANAGER_STATE, useSkillsManagerStore } from '@/stores/skillsManagerStore';

const mockSkillReposList = vi.fn();
const mockSkillReposAdd = vi.fn();
const mockSkillReposSkills = vi.fn();
const mockSkillsListInstalled = vi.fn();
const mockOnSkillsChanged = vi.fn(() => () => {});
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/lib/tauri-api-interface', () => ({
  getTauriAPI: vi.fn(() => ({
    skillReposList: mockSkillReposList,
    skillReposAdd: mockSkillReposAdd,
    skillReposSkills: mockSkillReposSkills,
    skillsListInstalled: mockSkillsListInstalled,
    onSkillsChanged: mockOnSkillsChanged,
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => undefined }));

vi.mock('@/components/file-preview', () => ({ FilePreviewPanel: () => null }));
vi.mock('@/components/skills-manager/RepoSkillsGrid', () => ({ RepoSkillsGrid: () => null }));
vi.mock('@/components/skills-manager/RepoToolbar', () => ({ RepoToolbar: () => null }));
vi.mock('@/components/skills-manager/SkillsSidebar', () => ({ SkillsSidebar: () => null }));
vi.mock('@/components/skills-manager/SkillsStatusBar', () => ({ SkillsStatusBar: () => null }));

import SkillsManagerPage from '../SkillsManager';

describe('SkillsManagerPage — pending-focus repo handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSkillsManagerStore.setState(INITIAL_SKILLS_MANAGER_STATE);
    mockSkillReposList.mockResolvedValue([]);
    mockSkillReposSkills.mockResolvedValue([]);
    mockSkillsListInstalled.mockResolvedValue([]);
  });

  it('selects an existing repo when the URL matches one already in the store', async () => {
    const existing = makeRepo('r1', 'https://github.com/x/y.git');
    mockSkillReposList.mockResolvedValue([existing]);

    localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ url: 'https://github.com/x/y.git' }));

    render(<SkillsManagerPage />);

    await waitFor(() => {
      expect(useSkillsManagerStore.getState().selectedRepoId).toBe('r1');
    });
    expect(mockSkillReposAdd).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_FOCUS_REPO_KEY)).toBeNull();
  });

  it('calls addRepo and selects the new repo when the URL is not yet registered', async () => {
    const newRepo = makeRepo('r-new', 'https://github.com/new/repo.git');
    // Both the initial refreshAll and processPending's pre-check see an empty list;
    // every subsequent fetch (after addRepo's refreshAll) returns the new repo.
    mockSkillReposList.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([newRepo]);
    mockSkillReposAdd.mockResolvedValue(newRepo);

    localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ url: 'https://github.com/new/repo.git', branch: 'develop' }));

    render(<SkillsManagerPage />);

    await waitFor(() => {
      expect(mockSkillReposAdd).toHaveBeenCalledWith('https://github.com/new/repo.git', 'develop', undefined);
    });
    await waitFor(() => {
      expect(useSkillsManagerStore.getState().selectedRepoId).toBe('r-new');
    });
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it('opens the AddRepoDialog with the URL prefilled when the add fails', async () => {
    mockSkillReposList.mockResolvedValue([]);
    mockSkillReposAdd.mockRejectedValue(new Error('clone failed'));

    localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ url: 'https://github.com/private/repo.git' }));

    render(<SkillsManagerPage />);

    await waitFor(() => {
      expect(mockSkillReposAdd).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(useSkillsManagerStore.getState().addRepoDialogOpen).toBe(true);
    });
    expect(useSkillsManagerStore.getState().prefillAddRepoUrl).toBe('https://github.com/private/repo.git');
    expect(mockToastError).toHaveBeenCalled();
  });

  it('responds to live storage events fired after mount', async () => {
    const newRepo = makeRepo('r-live', 'https://github.com/live/repo.git');
    // Initial mount fetch + storage-event fetchRepos both return [] so we route
    // through addRepo; after addRepo's refreshAll, subsequent fetches return the repo.
    mockSkillReposList.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([newRepo]);
    mockSkillReposAdd.mockResolvedValue(newRepo);

    render(<SkillsManagerPage />);

    // Wait for initial mount — no pending key yet, so addRepo not called
    await waitFor(() => {
      expect(mockSkillReposList).toHaveBeenCalled();
    });
    expect(mockSkillReposAdd).not.toHaveBeenCalled();

    // Fire a live storage event with a new pending repo
    localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ url: 'https://github.com/live/repo.git' }));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PENDING_FOCUS_REPO_KEY,
          newValue: JSON.stringify({ url: 'https://github.com/live/repo.git' }),
        })
      );
    });

    await waitFor(() => {
      expect(mockSkillReposAdd).toHaveBeenCalledWith('https://github.com/live/repo.git', undefined, undefined);
    });
  });
});
