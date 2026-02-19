import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SkillAutocompletePopover } from '../skill-autocomplete-popover';

const skills = [
  { id: 'skill-a', name: 'Skill A', description: 'First skill', category: 'General' },
  { id: 'skill-b', name: 'Skill B', description: 'Second skill', category: 'Marketing' },
];

describe('SkillAutocompletePopover', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <SkillAutocompletePopover highlightedIndex={0} isOpen={false} onHighlightChange={() => {}} onSelect={() => {}} skills={skills} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders skill items when open', () => {
    render(
      <SkillAutocompletePopover highlightedIndex={0} isOpen={true} onHighlightChange={() => {}} onSelect={() => {}} skills={skills} />
    );
    expect(screen.getByText('Skill A')).toBeInTheDocument();
    expect(screen.getByText('Skill B')).toBeInTheDocument();
    expect(screen.getByText('First skill')).toBeInTheDocument();
  });

  it('shows empty state when no skills match', () => {
    render(<SkillAutocompletePopover highlightedIndex={0} isOpen={true} onHighlightChange={() => {}} onSelect={() => {}} skills={[]} />);
    expect(screen.getByText('No skills match')).toBeInTheDocument();
  });

  it('calls onSelect when a skill is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SkillAutocompletePopover highlightedIndex={0} isOpen={true} onHighlightChange={() => {}} onSelect={onSelect} skills={skills} />
    );
    await user.click(screen.getByText('Skill B'));
    expect(onSelect).toHaveBeenCalledWith(skills[1]);
  });

  it('calls onHighlightChange on mouse enter', async () => {
    const user = userEvent.setup();
    const onHighlightChange = vi.fn();
    render(
      <SkillAutocompletePopover
        highlightedIndex={0}
        isOpen={true}
        onHighlightChange={onHighlightChange}
        onSelect={() => {}}
        skills={skills}
      />
    );
    await user.hover(screen.getByText('Second skill'));
    expect(onHighlightChange).toHaveBeenCalledWith(1);
  });
});
