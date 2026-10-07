import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '@/shared';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import RightRail from '../RightRail';

vi.mock('@/components/sidebar/FileTreePanel', () => ({ default: () => <div data-testid="file-tree" /> }));
vi.mock('@/components/sidebar/FoldersPanel', () => ({ default: () => <div data-testid="folders-panel" /> }));
vi.mock('@/components/file-preview', () => ({
  FilePreviewPanel: ({ file }: { file: { path: string } }) => <div data-testid="preview">{file.path}</div>,
}));
// The active task's todos, mutable per test; rerender to deliver a change.
const mockTask = vi.hoisted(() => ({ todos: [] as Todo[] }));
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector: (state: { todos: Map<string, Todo[]>; currentTask: { id: string } }) => unknown) =>
    selector({ todos: new Map([['task-1', mockTask.todos]]), currentTask: { id: 'task-1' } }),
}));

// jsdom has no layout: the main content wrapper is a stub with a settable width,
// and the ResizeObserver hands its callback to the test to fire.
const content = { clientWidth: 1000 };
const contentRef = { current: content } as unknown as RefObject<HTMLDivElement | null>;
let fireContentResize: () => void = () => {};
class CapturingResizeObserver {
  constructor(callback: () => void) {
    fireContentResize = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', CapturingResizeObserver);

const todo = (id: string): Todo => ({ id, content: `todo ${id}`, status: 'pending', priority: 'medium' });

const rail = () => document.getElementById('right-rail') as HTMLElement;
const handle = () => screen.getByRole('separator', { name: 'Resize side panel' });
const open = (path: string) =>
  act(() => {
    useFilePreviewStore.getState().openPreviewByPath(path);
  });
const renderRail = (hidden = false) => render(<RightRail contentRef={contentRef} hidden={hidden} />);

beforeEach(() => {
  useFilePreviewStore.setState({ tabs: [], activePath: null, openSeq: 0 });
  content.clientWidth = 1000;
  mockTask.todos = [];
});

describe('RightRail', () => {
  it('starts at 300px on the Files tab, which has no close button', () => {
    renderRail();
    expect(rail().style.width).toBe('300px');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Close Files' })).toBeNull();
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByTestId('folders-panel')).toBeInTheDocument();
  });

  it('opens Todos when the task gets its first todos, and leaves a manual collapse alone', () => {
    const { rerender } = renderRail();
    const todosHeader = () => screen.getByRole('button', { name: /Todos/ });
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');

    mockTask.todos = [todo('1')];
    rerender(<RightRail contentRef={contentRef} hidden={false} />);
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(todosHeader());
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');

    mockTask.todos = [todo('1'), todo('2')];
    rerender(<RightRail contentRef={contentRef} hidden={false} />);
    expect(todosHeader()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a preview as the active tab and keeps the Files body mounted but hidden', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    expect(screen.getByRole('tab', { name: 'notes.md' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('preview')).toHaveTextContent('/Users/me/ws/notes.md');
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Files', hidden: true })).toHaveClass('hidden');
  });

  it('closes a preview tab from its X and returns to Files', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    fireEvent.click(screen.getByRole('button', { name: 'Close notes.md' }));
    expect(screen.queryByRole('tab', { name: 'notes.md' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus to the newly active tab after closing one', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    open('/Users/me/ws/b.md');
    fireEvent.click(screen.getByRole('button', { name: 'Close b.md' }));
    expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveFocus();
  });

  it('switches back to Files from the Files tab without closing the preview', () => {
    renderRail();
    open('/Users/me/ws/notes.md');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('tab', { name: 'notes.md' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Files' })).not.toHaveClass('hidden');
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('hides with the hidden class instead of unmounting', () => {
    renderRail(true);
    expect(rail()).toHaveClass('hidden');
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
  });

  it('widens to half the main content on open and restores when the last tab closes', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    expect(rail().style.width).toBe('500px');
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(rail().style.width).toBe('300px');
  });

  it('restores the width when a workspace switch clears the tabs', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    open('/Users/me/ws/b.md');
    expect(rail().style.width).toBe('500px');
    act(() => {
      useFilePreviewStore.getState().closePreview();
    });
    expect(rail().style.width).toBe('300px');
  });

  it('keeps a dragged width when the last tab closes', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    fireEvent.mouseDown(handle(), { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 480 });
    fireEvent.mouseUp(document);
    expect(rail().style.width).toBe('520px');
    fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(rail().style.width).toBe('520px');
  });

  it('resizes from the keyboard in 16px steps', () => {
    renderRail();
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(rail().style.width).toBe('316px');
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(rail().style.width).toBe('300px');
  });

  it('widens again when the active file is re-opened after the rail was narrowed', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    }
    expect(rail().style.width).toBe('436px');
    open('/Users/me/ws/a.md');
    expect(rail().style.width).toBe('500px');
  });

  it('re-clamps when the main content narrows (window resize or left-sidebar drag)', () => {
    renderRail();
    open('/Users/me/ws/a.md');
    content.clientWidth = 700;
    act(() => {
      fireContentResize();
    });
    expect(rail().style.width).toBe('340px');
  });
});
