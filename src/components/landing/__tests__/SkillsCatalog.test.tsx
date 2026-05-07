import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockOpenSkillsManagerForRepo = vi.fn();
const mockOpenSkillsManagerWindow = vi.fn();

vi.mock('@/lib/skills-window', () => ({
  openSkillsManagerForRepo: (...args: unknown[]) => mockOpenSkillsManagerForRepo(...args),
  openSkillsManagerWindow: (...args: unknown[]) => mockOpenSkillsManagerWindow(...args),
}));

import { CURATED_SKILL_REPOS } from '../curatedSkillRepos';
import SkillsCatalog from '../SkillsCatalog';

const findCardByName = (name: string) => {
  const heading = screen.getByText(name);
  // Walk up to the card container that holds both the name and the Open button
  let node: HTMLElement | null = heading;
  while (node && !node.classList.contains('rounded-lg')) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`Card for ${name} not found`);
  return node;
};

describe('SkillsCatalog (curated repo browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one card per curated repo by default', () => {
    render(<SkillsCatalog />);
    for (const repo of CURATED_SKILL_REPOS) {
      expect(screen.getByText(repo.name)).toBeInTheDocument();
    }
  });

  it('renders one badge per entry in each repo\u2019s categories array', () => {
    render(<SkillsCatalog />);
    const multi = CURATED_SKILL_REPOS.find((r) => r.categories.length >= 2);
    expect(multi).toBeDefined();
    if (!multi) return;

    const card = findCardByName(multi.name);
    for (const category of multi.categories) {
      expect(within(card).getByText(category)).toBeInTheDocument();
    }
  });

  it('filters by category to packs whose categories array includes the active pill', async () => {
    render(<SkillsCatalog />);
    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));

    const expected = CURATED_SKILL_REPOS.filter((r) => r.categories.includes('Sales'));
    expect(expected.length).toBeGreaterThan(0);
    for (const repo of expected) {
      expect(screen.getByText(repo.name)).toBeInTheDocument();
    }

    const excluded = CURATED_SKILL_REPOS.filter((r) => !r.categories.includes('Sales'));
    for (const repo of excluded) {
      expect(screen.queryByText(repo.name)).not.toBeInTheDocument();
    }
  });

  it('search filters by name (case-insensitive)', async () => {
    render(<SkillsCatalog />);
    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'ANTHROPICS/SKILLS');

    expect(screen.getByText('anthropics/skills')).toBeInTheDocument();
    expect(screen.queryByText('openai/skills')).not.toBeInTheDocument();
  });

  it('search filters by summary text', async () => {
    render(<SkillsCatalog />);
    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'caveman');

    expect(screen.getByText('JuliusBrussee/caveman')).toBeInTheDocument();
    expect(screen.queryByText('openai/skills')).not.toBeInTheDocument();
  });

  it('search filters by category name', async () => {
    render(<SkillsCatalog />);
    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'design');

    const designRepos = CURATED_SKILL_REPOS.filter((r) => r.categories.some((c) => c.toLowerCase().includes('design')));
    expect(designRepos.length).toBeGreaterThan(0);
    for (const repo of designRepos) {
      expect(screen.getByText(repo.name)).toBeInTheDocument();
    }
  });

  it('the "All" pill is the first pill and resets the filter', async () => {
    render(<SkillsCatalog />);
    const allPills = screen.getAllByRole('button');
    const filterPills = allPills.filter((b) => b.classList.contains('rounded-full'));
    expect(filterPills[0]).toHaveTextContent('All');

    await userEvent.click(screen.getByRole('button', { name: 'Sales' }));
    await userEvent.click(screen.getByRole('button', { name: 'All' }));

    for (const repo of CURATED_SKILL_REPOS) {
      expect(screen.getByText(repo.name)).toBeInTheDocument();
    }
  });

  it('clicking Open invokes openSkillsManagerForRepo with the url and branch', async () => {
    render(<SkillsCatalog />);
    const target = CURATED_SKILL_REPOS[0];
    const card = findCardByName(target.name);
    await userEvent.click(within(card).getByRole('button', { name: /open/i }));

    expect(mockOpenSkillsManagerForRepo).toHaveBeenCalledWith({
      url: target.url,
      branch: target.branch,
    });
  });

  it('shows the empty-state message when search yields zero matches', async () => {
    render(<SkillsCatalog />);
    const searchInput = screen.getByPlaceholderText(/search skills/i);
    await userEvent.type(searchInput, 'zzzzz-no-such-skill-xyz');

    expect(screen.getByText(/no skills match your search/i)).toBeInTheDocument();
  });

  it('the footer Skills Manager link calls openSkillsManagerWindow without a repo payload', async () => {
    render(<SkillsCatalog />);
    await userEvent.click(screen.getByRole('button', { name: /^Skills Manager$/i }));

    expect(mockOpenSkillsManagerWindow).toHaveBeenCalledTimes(1);
    expect(mockOpenSkillsManagerForRepo).not.toHaveBeenCalled();
  });
});
