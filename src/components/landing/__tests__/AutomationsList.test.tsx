import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@/shared';

vi.mock('@/lib/tauri-api', () => ({
  isRunningInTauri: () => false,
  listAutomations: vi.fn(),
  getAutomationNextRuns: vi.fn().mockResolvedValue({}),
  runAutomationNow: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// The real card hides Run Now inside a Radix dropdown; only the callback matters here.
vi.mock('../AutomationCard', () => ({
  default: ({ automation, onRunNow }: { automation: Automation; onRunNow: (id: string) => void }) => (
    <button onClick={() => onRunNow(automation.id)} type="button">
      Run {automation.name}
    </button>
  ),
}));

import * as api from '@/lib/tauri-api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import AutomationsList from '../AutomationsList';

const automation: Automation = {
  id: 'auto_1',
  workspaceId: 'ws_1',
  name: 'Daily review',
  prompt: 'review',
  scheduleCron: '0 9 * * *',
  scheduleDisplay: 'Daily at 9:00 AM',
  providerId: 'anthropic',
  modelId: 'anthropic/claude',
  enabled: true,
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
};

function renderList() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AutomationsList />} path="/" />
        <Route element={<div>execution page</div>} path="/execution/:id" />
      </Routes>
    </MemoryRouter>
  );
}

describe('AutomationsList Run Now', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAutomations).mockResolvedValue([automation]);
    useWorkspaceStore.setState({
      activeWorkspace: { id: 'ws_1', folderPath: '/tmp/ws', displayName: 'ws', createdAt: 0, lastOpenedAt: 0 },
    });
  });

  it('opens the new run in the main view', async () => {
    vi.mocked(api.runAutomationNow).mockResolvedValue('task_123');
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Run Daily review' }));

    expect(await screen.findByText('execution page')).toBeInTheDocument();
  });

  it('stays on the list when the run cannot start', async () => {
    vi.mocked(api.runAutomationNow).mockRejectedValue('An automation run is already in progress');
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'Run Daily review' }));

    expect(api.runAutomationNow).toHaveBeenCalledWith('auto_1');
    expect(screen.queryByText('execution page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Daily review' })).toBeInTheDocument();
  });
});
