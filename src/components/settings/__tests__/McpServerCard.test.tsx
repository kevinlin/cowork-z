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

const disabledRuntime: McpServerRuntime = {
  status: 'disabled',
  tools: ['cachedTool'],
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

  it('renders server name, type, and letter avatar', () => {
    render(<McpServerCard {...defaultProps} />);
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    // Letter avatar shows first letter uppercased
    expect(screen.getByText('F')).toBeInTheDocument();
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

  it('auto-expands tools for connected servers', () => {
    render(<McpServerCard {...defaultProps} />);
    // Tools should be visible immediately for connected servers
    expect(screen.getByText('readFile')).toBeInTheDocument();
    expect(screen.getByText('writeFile')).toBeInTheDocument();
    // "Show less" link visible
    expect(screen.getByText('Show less')).toBeInTheDocument();
  });

  it('can collapse auto-expanded tools', async () => {
    const user = userEvent.setup();
    render(<McpServerCard {...defaultProps} />);

    await user.click(screen.getByText('Show less'));

    expect(screen.queryByText('readFile')).not.toBeInTheDocument();
    expect(screen.getByText('Show 2 tools')).toBeInTheDocument();
  });

  it('tools collapsed by default for non-connected servers with tools', () => {
    render(<McpServerCard {...defaultProps} runtime={disabledRuntime} />);
    // Should show "Show 1 tool" link, not the tool itself
    expect(screen.getByText('Show 1 tool')).toBeInTheDocument();
    expect(screen.queryByText('cachedTool')).not.toBeInTheDocument();
  });

  it('does not show tools section when no tools', () => {
    render(<McpServerCard {...defaultProps} runtime={unknownRuntime} />);
    expect(screen.queryByText(/tool/)).not.toBeInTheDocument();
  });

  it('calls onToggle when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<McpServerCard {...defaultProps} onToggle={onToggle} />);

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
