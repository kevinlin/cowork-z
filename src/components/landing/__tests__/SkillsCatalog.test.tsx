import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillWithStatus } from '@/lib/tauri-api';

// Mock tauri-api-interface at module level
const mockListSkillsWithStatus = vi.fn();
const mockInstallSkill = vi.fn();

vi.mock('@/lib/tauri-api-interface', () => ({
  getTauriAPI: vi.fn(() => ({
    listSkillsWithStatus: mockListSkillsWithStatus,
    installSkill: mockInstallSkill,
  })),
}));

import SkillsCatalog from '../SkillsCatalog';

const makeSkill = (id: string, category: string, installed = false, needs_update = false): SkillWithStatus => ({
  meta: { id, name: id, description: `desc for ${id}`, category },
  status: { installed, needs_update },
});

describe('SkillsCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallSkill.mockResolvedValue(undefined);
  });

  it('shows loading state initially', () => {
    mockListSkillsWithStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SkillsCatalog />);
    expect(screen.getByText(/loading skills/i)).toBeInTheDocument();
  });

  it('renders skill cards after loading', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('competitor-alternatives', 'General'),
      makeSkill('marketing-brand-voice', 'Marketing'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText('competitor-alternatives')).toBeInTheDocument();
      expect(screen.getByText('marketing-brand-voice')).toBeInTheDocument();
    });
  });

  it('shows "Failed to load skills" on error', async () => {
    mockListSkillsWithStatus.mockRejectedValue(new Error('network error'));
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load skills/i)).toBeInTheDocument();
    });
  });

  it('filters by category tab', async () => {
    mockListSkillsWithStatus.mockResolvedValue([
      makeSkill('competitor-alternatives', 'General'),
      makeSkill('marketing-brand-voice', 'Marketing'),
    ]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByRole('button', { name: 'Marketing' }));

    await userEvent.click(screen.getByRole('button', { name: 'Marketing' }));
    expect(screen.getByText('marketing-brand-voice')).toBeInTheDocument();
    expect(screen.queryByText('competitor-alternatives')).not.toBeInTheDocument();
  });

  it('filters by search query', async () => {
    mockListSkillsWithStatus.mockResolvedValue([makeSkill('competitor-alternatives', 'General'), makeSkill('copywriting', 'General')]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByText('competitor-alternatives'));

    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'copy');
    expect(screen.getByText('copywriting')).toBeInTheDocument();
    expect(screen.queryByText('competitor-alternatives')).not.toBeInTheDocument();
  });

  it('calls installSkill when Install button clicked', async () => {
    mockListSkillsWithStatus.mockResolvedValue([makeSkill('brainstorming', 'General')]);
    render(<SkillsCatalog />);
    await waitFor(() => screen.getByText('brainstorming'));

    await userEvent.click(screen.getByRole('button', { name: /^install$/i }));
    expect(mockInstallSkill).toHaveBeenCalledWith('brainstorming');
  });

  it('shows Installed badge for installed up-to-date skill', async () => {
    mockListSkillsWithStatus.mockResolvedValue([makeSkill('brainstorming', 'General', true, false)]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/installed/i)).toBeInTheDocument();
    });
  });

  it('shows Re-install button for outdated skill', async () => {
    mockListSkillsWithStatus.mockResolvedValue([makeSkill('brainstorming', 'General', true, true)]);
    render(<SkillsCatalog />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /re-install/i })).toBeInTheDocument();
    });
  });
});
