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

type OnTextChange = (text: string, cursor?: number) => void;

describe('useSkillAutocomplete', () => {
  let onTextChange: OnTextChange;
  let onTextChangeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onTextChangeMock = vi.fn();
    onTextChange = onTextChangeMock as unknown as OnTextChange;
  });

  it('opens popover when text starts with /', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(true);
    expect(result.current.filteredSkills).toHaveLength(3);
  });

  it('does not open popover for normal text', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'hello', cursorPosition: 5, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('filters skills by query after /', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/social', cursorPosition: 7, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(true);
    expect(result.current.filteredSkills).toHaveLength(1);
    expect(result.current.filteredSkills[0].id).toBe('marketing-social');
  });

  it('filters case-insensitively', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/SALES', cursorPosition: 6, onTextChange }));
    expect(result.current.filteredSkills).toHaveLength(1);
    expect(result.current.filteredSkills[0].id).toBe('sales-outreach');
  });

  it('opens popover when / follows whitespace mid-text', () => {
    const text = 'hello /mar';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(true);
    expect(result.current.filteredSkills).toHaveLength(1);
    expect(result.current.filteredSkills[0].id).toBe('marketing-social');
  });

  it('does not open for URL-like pattern http://', () => {
    const text = 'http://';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('does not open for @path/with-slash', () => {
    const text = '@src/foo';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('closes when whitespace appears between / and cursor', () => {
    const text = '/foo ';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('selectSkill appends skill and removes only the /query token', () => {
    const text = '/soc';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.selectedSkills).toEqual([mockSkills[0]]);
    expect(onTextChangeMock).toHaveBeenCalledWith('', 0);
  });

  it('selecting skill preserves prose before and after /query', () => {
    const text = 'Please /mar and polish';
    // cursor positioned right after '/mar' (index 11)
    const cursor = 11;
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: cursor, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(onTextChangeMock).toHaveBeenCalledWith('Please  and polish', 7);
    expect(result.current.selectedSkills).toEqual([mockSkills[0]]);
  });

  it('supports multiple skills', () => {
    const { result, rerender } = renderHook(
      ({ text, cursor }: { text: string; cursor: number }) => useSkillAutocomplete({ text, cursorPosition: cursor, onTextChange }),
      { initialProps: { text: '/mar', cursor: 4 } }
    );
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    // Simulate the parent clearing the /query token; re-render with updated text
    rerender({ text: '/sal', cursor: 4 });
    act(() => {
      result.current.selectSkill(mockSkills[1]);
    });
    expect(result.current.selectedSkills).toEqual([mockSkills[0], mockSkills[1]]);
    expect(result.current.hasSkills).toBe(true);
  });

  it('dedupes on repeat selection', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/mar', cursorPosition: 4, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.selectedSkills).toHaveLength(1);
  });

  it('removeSkill removes only the named skill', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', cursorPosition: 0, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
      result.current.selectSkill(mockSkills[1]);
      result.current.selectSkill(mockSkills[2]);
    });
    expect(result.current.selectedSkills).toHaveLength(3);
    act(() => {
      result.current.removeSkill('sales-outreach');
    });
    expect(result.current.selectedSkills.map((s) => s.id)).toEqual(['marketing-social', 'dev-estimation']);
  });

  it('clearAllSkills empties selectedSkills', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', cursorPosition: 0, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
      result.current.selectSkill(mockSkills[1]);
    });
    expect(result.current.selectedSkills).toHaveLength(2);
    act(() => {
      result.current.clearAllSkills();
    });
    expect(result.current.selectedSkills).toHaveLength(0);
    expect(result.current.hasSkills).toBe(false);
  });

  it('composePrompt concatenates multiple skills in order', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'hi', cursorPosition: 2, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
      result.current.selectSkill(mockSkills[1]);
    });
    expect(result.current.composePrompt()).toBe('/marketing-social /sales-outreach hi');
  });

  it('composePrompt with empty text returns only prefix', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', cursorPosition: 0, onTextChange }));
    act(() => {
      result.current.selectSkill(mockSkills[0]);
    });
    expect(result.current.composePrompt()).toBe('/marketing-social');
  });

  it('composePrompt returns plain text when no skill selected', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: 'hello world', cursorPosition: 11, onTextChange }));
    expect(result.current.composePrompt()).toBe('hello world');
  });

  it('handleKeyDown selects skill on Tab', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange }));
    const event = { key: 'Tab', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.selectedSkills).toEqual([mockSkills[0]]);
  });

  it('handleKeyDown selects skill on Enter', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange }));
    const event = { key: 'Enter', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.selectedSkills).toEqual([mockSkills[0]]);
  });

  it('Escape clears only the /query token, not whole textarea', () => {
    const text = 'hello /mar';
    const { result } = renderHook(() => useSkillAutocomplete({ text, cursorPosition: text.length, onTextChange }));
    const event = { key: 'Escape', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onTextChangeMock).toHaveBeenCalledWith('hello ', 6);
  });

  it('handleKeyDown navigates with ArrowDown', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange }));
    expect(result.current.highlightedIndex).toBe(0);
    const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
    });
    expect(result.current.highlightedIndex).toBe(1);
  });

  it('handleKeyDown wraps ArrowDown at end of list', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange }));
    const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
    act(() => {
      result.current.handleKeyDown(event);
      result.current.handleKeyDown(event);
      result.current.handleKeyDown(event);
    });
    expect(result.current.highlightedIndex).toBe(0);
  });

  it('does not open popover when disabled', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '/', cursorPosition: 1, onTextChange, disabled: true }));
    expect(result.current.isPopoverOpen).toBe(false);
  });

  it('hasSkills reflects selection state', () => {
    const { result } = renderHook(() => useSkillAutocomplete({ text: '', cursorPosition: 0, onTextChange }));
    expect(result.current.hasSkills).toBe(false);
    act(() => {
      result.current.selectSkill(mockSkills[1]);
    });
    expect(result.current.hasSkills).toBe(true);
  });
});
