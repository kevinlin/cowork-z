import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SkillPill } from '../skill-pill';

const mockSkill = { id: 'test-skill', name: 'Test Skill', description: 'A test skill', category: 'General' };

describe('SkillPill', () => {
  it('renders the skill name', () => {
    render(<SkillPill onRemove={() => {}} skill={mockSkill} />);
    expect(screen.getByText('Test Skill')).toBeInTheDocument();
  });

  it('calls onRemove when X button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<SkillPill onRemove={onRemove} skill={mockSkill} />);
    await user.click(screen.getByRole('button', { name: /remove test skill/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
