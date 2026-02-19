import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSkillAutocomplete } from '../useSkillAutocomplete';

const mockSkills = [
  { id: 'marketing-social', name: 'Social Content', description: 'Create social media posts', category: 'Marketing' },
  { id: 'sales-outreach', name: 'Sales Outreach', description: 'Draft outreach emails', category: 'Sales' },
  { id: 'dev-estimation', name: 'Dev Estimation', description: 'Estimate development tasks', category: 'Development' },
];

vi.mock('@/stores/skillsStore', () => ({
  useSkillsStore: () => ({
    installedSkills: mockSkills,
    isLoaded: true,
    fetchInstalledSkills: vi.fn(),
  }),
}));

describe('useSkillAutocomplete', () => {
  let onTextChange: (text: string) => void;
  let onTextChangeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onTextChangeMock = vi.fn();
    onTextChange = onTextChangeMock as (text: string) => void;
  });

  it('opens popover when text starts with /', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange }));
    expect(result.current.isPopoverOpen).toBe(true);
    expect(result.current.filteredSkills).toHaveLength(3);
  });

  it('does not open popover for normal text', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'hello', onTextChange }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('filters skills by query after /', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/social', onTextChange }));
    expect(result.current.isPopoverOpen).toBe(true);
    expect(result.current.filteredSkills).toHaveLength(1);
    expect(result.current.filteredSkills[0].id).toBe('marketing-social');
  });

  it('filters case-insensitively', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/SALES', onTextChange }));
    expect(result.current.filteredSkills).toHaveLength(1);
    expect(result.current.filteredSkills[0].id).toBe('sales-outreach');
  });

  it('selectSkill sets selectedSkill and clears text', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/soc', onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.selectedSkill).toEqual(mockSkills[0]);
    expect(onTextChangeMock).toHaveBeenCalledWith('');
  });

  it('closes popover when a skill is selected', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('clearSkill removes the selected skill', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.selectedSkill).not.toBeNull();
    act(() => {
      result.current.clearSkill();
    });
    expect(result.current.selectedSkill).toBeNull();
  });

  it('composePrompt returns prefixed prompt when skill is selected', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'write a blog post', onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.composePrompt()).toBe('/marketing-social write a blog post');
  });

  it('composePrompt returns plain text when no skill selected', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'hello world', onTextChange }));
    expect(result.current.composePrompt()).toBe('hello world');
  });

  it('handleKeyDown selects skill on Tab', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange }));
    const event = { key: 'Tab', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.selectedSkill).toEqual(mockSkills[0]);
  });

  it('handleKeyDown selects skill on Enter', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange }));
    const event = { key: 'Enter', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.selectedSkill).toEqual(mockSkills[0]);
  });

  it('handleKeyDown dismisses popover on Escape', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/soc', onTextChange }));
    const event = { key: 'Escape', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onTextChangeMock).toHaveBeenCalledWith('');
  });

  it('handleKeyDown navigates with ArrowDown', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange }));
    expect(result.current.highlightedIndex).toBe(0);
    const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(result.current.highlightedIndex).toBe(1);
  });

  it('handleKeyDown wraps ArrowDown at end of list', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange }));
    const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
      result.current.handleKeyDown(event);
      result.current.handleKeyDown(event);
    });
    expect(result.current.highlightedIndex).toBe(0);
  });

  it('does not open popover when disabled', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', onTextChange, disabled: true }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('hasSkill reflects selection state', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', onTextChange }));
    expect(result.current.hasSkill).toBe(false);
    act(() => {
      result.current.selectSkill(mockSkills[1]);
    });
    expect(result.current.hasSkill).toBe(true);
  });
});
