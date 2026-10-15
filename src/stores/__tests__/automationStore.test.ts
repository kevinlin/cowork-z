import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri-api', () => ({
  isRunningInTauri: () => false,
  runAutomationNow: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'sonner';
import * as api from '@/lib/tauri-api';
import { useAutomationStore } from '../automationStore';
import { useTaskStore } from '../taskStore';

describe('automationStore.runNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({ runsFilter: 'unread' });
    useTaskStore.setState({ sidebarTab: 'sessions' });
  });

  it('reveals the new run in the sidebar and returns its task id', async () => {
    vi.mocked(api.runAutomationNow).mockResolvedValue('task_123');

    const taskId = await useAutomationStore.getState().runNow('auto_1');

    expect(taskId).toBe('task_123');
    expect(useTaskStore.getState().sidebarTab).toBe('automations');
    expect(useAutomationStore.getState().runsFilter).toBe('all');
  });

  it('toasts and leaves the sidebar alone when the run cannot start', async () => {
    vi.mocked(api.runAutomationNow).mockRejectedValue('An automation run is already in progress');

    const taskId = await useAutomationStore.getState().runNow('auto_1');

    expect(taskId).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('An automation run is already in progress');
    expect(useTaskStore.getState().sidebarTab).toBe('sessions');
    expect(useAutomationStore.getState().runsFilter).toBe('unread');
  });
});
