import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri-api', () => ({}));

import KeyboardShortcutsDialog from '../KeyboardShortcutsDialog';

describe('KeyboardShortcutsDialog', () => {
  it('renders all categories and shortcut descriptions when open', () => {
    render(<KeyboardShortcutsDialog onOpenChange={vi.fn()} open={true} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('App')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByText('Task Launcher')).toBeInTheDocument();
    expect(screen.getByText('Shortcuts Help')).toBeInTheDocument();

    expect(screen.getByText('Send Message')).toBeInTheDocument();
    expect(screen.getByText('New Line')).toBeInTheDocument();
    expect(screen.getByText('Cancel Task')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<KeyboardShortcutsDialog onOpenChange={vi.fn()} open={false} />);

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('displays kbd elements for keys', () => {
    render(<KeyboardShortcutsDialog onOpenChange={vi.fn()} open={true} />);

    const kbdElements = document.querySelectorAll('kbd');
    expect(kbdElements.length).toBeGreaterThan(0);

    expect(screen.getByText('Esc')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getAllByText('Enter').length).toBeGreaterThanOrEqual(1);
  });
});
