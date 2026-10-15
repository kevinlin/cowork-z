import { toast } from 'sonner';
import { create } from 'zustand';
import * as api from '@/lib/tauri-api';
import type { Automation, AutomationRun, CreateAutomationInput, UpdateAutomationInput } from '@/shared';
import { useTaskStore } from '@/stores/taskStore';

export type RunsFilter = 'unread' | 'all';

interface AutomationState {
  automations: Automation[];
  runs: AutomationRun[];
  unreadCount: number;
  isLoading: boolean;
  nextRuns: Record<string, string | null>;
  runsFilter: RunsFilter;

  loadAutomations: (workspaceId: string) => Promise<void>;
  loadRuns: (workspaceId: string, unreadOnly?: boolean) => Promise<void>;
  loadUnreadCount: (workspaceId: string) => Promise<void>;
  loadNextRuns: (automationIds?: string[]) => Promise<void>;
  createAutomation: (input: CreateAutomationInput) => Promise<Automation>;
  updateAutomation: (input: UpdateAutomationInput) => Promise<void>;
  deleteAutomation: (id: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  setRunsFilter: (filter: RunsFilter) => void;
  runNow: (automationId: string) => Promise<string | null>;
  markRunRead: (runId: string) => Promise<void>;
  markAllRead: (workspaceId: string) => Promise<void>;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  automations: [],
  runs: [],
  unreadCount: 0,
  isLoading: false,
  nextRuns: {},
  runsFilter: 'unread',

  loadAutomations: async (workspaceId: string) => {
    set({ isLoading: true });
    const automations = await api.listAutomations(workspaceId);
    set({ automations, isLoading: false });

    const ids = automations.filter((a) => a.enabled).map((a) => a.id);
    if (ids.length > 0) {
      const nextRuns = await api.getAutomationNextRuns(ids);
      set({ nextRuns });
    } else {
      set({ nextRuns: {} });
    }
  },

  loadRuns: async (workspaceId: string, unreadOnly = false) => {
    const runs = await api.listAutomationRuns(workspaceId, unreadOnly);
    set({ runs });
  },

  loadUnreadCount: async (workspaceId: string) => {
    const unreadCount = await api.getAutomationUnreadCount(workspaceId);
    set({ unreadCount });
  },

  loadNextRuns: async (automationIds?: string[]) => {
    const ids =
      automationIds ??
      get()
        .automations.filter((a) => a.enabled)
        .map((a) => a.id);
    if (ids.length === 0) {
      set({ nextRuns: {} });
      return;
    }
    const nextRuns = await api.getAutomationNextRuns(ids);
    set({ nextRuns });
  },

  createAutomation: async (input: CreateAutomationInput) => {
    const automation = await api.createAutomation(input);
    set((state) => ({ automations: [automation, ...state.automations] }));
    get().loadNextRuns();
    return automation;
  },

  updateAutomation: async (input: UpdateAutomationInput) => {
    await api.updateAutomation(input);
    set((state) => ({
      automations: state.automations.map((a) => (a.id === input.id ? { ...a, ...input, updatedAt: new Date().toISOString() } : a)),
    }));
    get().loadNextRuns();
  },

  deleteAutomation: async (id: string) => {
    await api.deleteAutomation(id);
    set((state) => ({
      automations: state.automations.filter((a) => a.id !== id),
    }));
    get().loadNextRuns();
  },

  toggleEnabled: async (id: string, enabled: boolean) => {
    await api.toggleAutomationEnabled(id, enabled);
    set((state) => ({
      automations: state.automations.map((a) => (a.id === id ? { ...a, enabled } : a)),
    }));
    get().loadNextRuns();
  },

  setRunsFilter: (filter: RunsFilter) => set({ runsFilter: filter }),

  // Starts a manual run and reveals it in the sidebar. A fresh run has no
  // findings yet, so the "unread" filter would hide it; switch to "all".
  // Returns the run's task id so the caller can open it, or null on failure.
  runNow: async (automationId: string) => {
    try {
      const taskId = await api.runAutomationNow(automationId);
      set({ runsFilter: 'all' });
      useTaskStore.getState().setSidebarTab('automations');
      return taskId;
    } catch (e) {
      // e.g. "An automation run is already in progress" — slot busy
      toast.error(typeof e === 'string' ? e : 'Failed to start automation run');
      return null;
    }
  },

  markRunRead: async (runId: string) => {
    await api.markRunRead(runId);
    set((state) => ({
      runs: state.runs.map((r) => (r.id === runId ? { ...r, isRead: true } : r)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllRead: async (workspaceId: string) => {
    await api.markAllRunsRead(workspaceId);
    set((state) => ({
      runs: state.runs.map((r) => ({ ...r, isRead: true })),
      unreadCount: 0,
    }));
  },
}));
