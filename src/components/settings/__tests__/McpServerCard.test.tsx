import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { McpServerConfig, McpServerRuntime } from '@/shared';
import { McpServerCard } from '../McpServerCard';

const baseConfig: McpServerConfig = {
  type: 'local',
  command: ['npx', '-y', '@mcp/server-filesystem', '/tmp'],
  enabled: true,
};

const connectedRuntime: McpServerRuntime = {
  status: 'connected',
  tools: ['readFile', 'writeFile'],
};

const failedRuntime: McpServerRuntime = {
  status: 'failed',
  error: 'Connection refused',
  tools: [],
};

const unknownRuntime: McpServerRuntime = {
  status: 'unknown',
  tools: [],
};

describe('McpServerCard', () => {
  const defaultProps = {
    name: 'filesystem',
    config: baseConfig,
    runtime: connectedRuntime,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };

  it('renders server name and type', () => {
    render(<McpServerCard {...defaultProps} />);
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
  });

  it('shows command as subtitle for local servers', () => {
    render(<McpServerCard {...defaultProps} />);
    expect(screen.getByText('npx -y @mcp/server-filesystem /tmp')).toBeInTheDocument();
  });

  it('shows URL as subtitle for remote servers', () => {
    const remoteConfig: McpServerConfig = { type: 'remote', url: 'https://mcp.example.com', enabled: true };
    render(<McpServerCard {...defaultProps} config={remoteConfig} />);
    expect(screen.getByText('https://mcp.example.com')).toBeInTheDocument();
    expect(screen.getByText('remote')).toBeInTheDocument();
  });

  it('shows Connected status label', () => {
    render(<McpServerCard {...defaultProps} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows error message when status is failed', () => {
    render(<McpServerCard {...defaultProps} runtime={failedRuntime} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('does not show status label when unknown', () => {
    render(<McpServerCard {...defaultProps} runtime={unknownRuntime} />);
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('shows tool count and can expand tools', async () => {
    const user = userEvent.setup();
    render(<McpServerCard {...defaultProps} />);

    const showBtn = screen.getByText('Show 2 tools');
    expect(showBtn).toBeInTheDocument();

    await user.click(showBtn);

    expect(screen.getByText('readFile')).toBeInTheDocument();
    expect(screen.getByText('writeFile')).toBeInTheDocument();
    expect(screen.getByText('Hide 2 tools')).toBeInTheDocument();
  });

  it('does not show tools section when no tools', () => {
    render(<McpServerCard {...defaultProps} runtime={unknownRuntime} />);
    expect(screen.queryByText(/tool/)).not.toBeInTheDocument();
  });

  it('calls onToggle when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<McpServerCard {...defaultProps} onToggle={onToggle} />);

    // The toggle button is the last button in the actions area
    const buttons = screen.getAllByRole('button');
    const toggleButton = buttons[buttons.length - 1];
    await user.click(toggleButton);

    expect(onToggle).toHaveBeenCalledWith('filesystem', false);
  });

  it('calls onEdit when edit button is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<McpServerCard {...defaultProps} onEdit={onEdit} />);

    await user.click(screen.getByTitle('Edit server'));
    expect(onEdit).toHaveBeenCalledWith('filesystem');
  });

  it('calls onRemove when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<McpServerCard {...defaultProps} onRemove={onRemove} />);

    await user.click(screen.getByTitle('Remove server'));
    expect(onRemove).toHaveBeenCalledWith('filesystem');
  });
});
