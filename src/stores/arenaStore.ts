import { create } from 'zustand';
import * as api from '@/lib/tauri-api';
import type {
  Arena,
  ArenaConfig,
  ArenaListItem,
  CompleteMessageEvent,
  PartialMessage,
  PartialMessageEvent,
  PermissionRequest,
  PermissionResponse,
  Task,
  TaskMessage,
  TaskStatus,
  TaskUpdateEvent,
} from '@/shared';

export interface ArenaColumnState {
  modelId: string | null;
  modelDisplayName: string;
  taskId: string | null;
  task: Task | null;
  status: TaskStatus | 'idle';
  partialMessages: Map<string, PartialMessage>;
  error: string | null;
}

const createEmptyColumn = (): ArenaColumnState => ({
  modelId: null,
  modelDisplayName: '',
  taskId: null,
  task: null,
  status: 'idle',
  partialMessages: new Map(),
  error: null,
});

interface ArenaState {
  arenaId: string | null;
  prompt: string;
  columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState];

  /** Permission request queue (supports parallel tool calls) */
  permissionRequests: PermissionRequest[];
  /** Derived: first item in the queue (shown in modal) */
  permissionRequest: PermissionRequest | null;

  /** Arena list for sidebar */
  arenas: ArenaListItem[];

  // Actions — model configuration
  setColumnModel: (index: 0 | 1 | 2, modelId: string, displayName: string) => void;

  // Actions — arena lifecycle
  startArena: (prompt: string) => Promise<string>;
  sendFollowUp: (message: string) => Promise<void>;
  loadArena: (arenaId: string) => Promise<void>;
  loadArenas: (workspaceId?: string) => Promise<void>;
  deleteArena: (arenaId: string) => Promise<void>;
  abortAll: () => Promise<void>;
  reset: () => void;

  // Event handlers — route by taskId to the correct column
  handleTaskUpdate: (event: TaskUpdateEvent) => void;
  handleTaskUpdateBatch: (taskId: string, messages: TaskMessage[]) => void;
  handlePartialMessage: (event: PartialMessageEvent) => void;
  handlePartialMessageComplete: (event: CompleteMessageEvent) => void;
  handleStatusChange: (taskId: string, status: TaskStatus) => void;
  handlePermissionRequest: (request: PermissionRequest) => void;
  respondToPermission: (response: PermissionResponse) => Promise<void>;
}

/**
 * Find the column index that owns a given taskId.
 * Returns -1 if no column matches.
 */
function findColumnByTaskId(columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState], taskId: string): 0 | 1 | 2 | -1 {
  for (let i = 0; i < 3; i++) {
    if (columns[i].taskId === taskId) return i as 0 | 1 | 2;
  }
  return -1;
}

/**
 * Derive whether any column is currently running.
 */
function deriveIsRunning(columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState]): boolean {
  return columns.some((col) => col.status === 'running' || col.status === 'starting');
}

/**
 * Populate column state from an Arena response (loaded or just started).
 */
function columnsFromArena(
  arena: Arena,
  existing: [ArenaColumnState, ArenaColumnState, ArenaColumnState]
): [ArenaColumnState, ArenaColumnState, ArenaColumnState] {
  const next: [ArenaColumnState, ArenaColumnState, ArenaColumnState] = [
    { ...createEmptyColumn() },
    { ...createEmptyColumn() },
    { ...createEmptyColumn() },
  ];

  for (const task of arena.tasks) {
    const slot = task.arenaSlot;
    if (slot !== undefined && slot >= 0 && slot < 3) {
      const idx = slot as 0 | 1 | 2;
      next[idx] = {
        modelId: task.modelId ?? existing[idx].modelId,
        modelDisplayName: existing[idx].modelDisplayName || task.modelId?.split('/').pop() || '',
        taskId: task.id,
        task,
        status: task.status,
        partialMessages: new Map(),
        error: task.result?.error ?? null,
      };
    }
  }

  return next;
}

/** Derived selector: true if any column is running or starting */
export const selectIsRunning = (state: ArenaState) => deriveIsRunning(state.columns);

export const useArenaStore = create<ArenaState>((set, get) => ({
  arenaId: null,
  prompt: '',
  columns: [createEmptyColumn(), createEmptyColumn(), createEmptyColumn()],
  permissionRequests: [],
  permissionRequest: null,
  arenas: [],

  // ---- Model configuration ----

  setColumnModel: (index, modelId, displayName) => {
    set((state) => {
      const columns = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      columns[index] = { ...columns[index], modelId, modelDisplayName: displayName };
      return { columns };
    });
  },

  // ---- Arena lifecycle ----

  startArena: async (prompt) => {
    const { columns } = get();

    const models = columns
      .filter((col) => col.modelId)
      .map((col) => ({
        modelId: col.modelId as string,
        displayName: col.modelDisplayName,
      }));

    if (models.length === 0) {
      throw new Error('Select at least one model before starting an arena.');
    }

    const config: ArenaConfig = { prompt, models };
    const arena = await api.startArena(config);

    const newColumns = columnsFromArena(arena, columns);
    set({
      arenaId: arena.id,
      prompt: arena.prompt,
      columns: newColumns,
    });

    return arena.id;
  },

  sendFollowUp: async (message) => {
    const { arenaId } = get();
    if (!arenaId) return;

    const arena = await api.resumeArena(arenaId, message);
    const { columns } = get();
    const newColumns = columnsFromArena(arena, columns);
    set({
      prompt: message,
      columns: newColumns,
    });
  },

  loadArena: async (arenaId) => {
    const arena = await api.getArena(arenaId);
    const { columns } = get();
    const newColumns = columnsFromArena(arena, columns);
    set({
      arenaId: arena.id,
      prompt: arena.prompt,
      columns: newColumns,
      permissionRequests: [],
      permissionRequest: null,
    });
  },

  loadArenas: async (workspaceId) => {
    const arenas = await api.listArenas(workspaceId);
    set({ arenas });
  },

  deleteArena: async (arenaId) => {
    await api.deleteArena(arenaId);
    set((state) => ({
      arenas: state.arenas.filter((a) => a.id !== arenaId),
      // If we just deleted the active arena, clear state
      ...(state.arenaId === arenaId
        ? {
            arenaId: null,
            prompt: '',
            columns: [createEmptyColumn(), createEmptyColumn(), createEmptyColumn()] as [
              ArenaColumnState,
              ArenaColumnState,
              ArenaColumnState,
            ],
            permissionRequests: [],
            permissionRequest: null,
          }
        : {}),
    }));
  },

  abortAll: async () => {
    const { arenaId } = get();
    if (!arenaId) return;
    await api.abortArena(arenaId);
    set((state) => {
      const columns = state.columns.map((col) => ({
        ...col,
        status: col.status === 'running' || col.status === 'starting' ? ('cancelled' as TaskStatus) : col.status,
      })) as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      return { columns };
    });
  },

  reset: () => {
    set({
      arenaId: null,
      prompt: '',
      columns: [createEmptyColumn(), createEmptyColumn(), createEmptyColumn()],
      permissionRequests: [],
      permissionRequest: null,
    });
  },

  // ---- Event handlers ----

  handleTaskUpdate: (event) => {
    const { columns } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) return;

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };

      if (event.type === 'message' && event.message) {
        const task = col.task;
        if (task) {
          col.task = {
            ...task,
            messages: [...task.messages, event.message],
          };
        }
      } else if (event.type === 'complete') {
        col.status = 'completed';
        if (col.task) {
          col.task = { ...col.task, status: 'completed', result: event.result };
        }
      } else if (event.type === 'error') {
        col.status = 'failed';
        col.error = event.error ?? 'Unknown error';
        if (col.task) {
          col.task = { ...col.task, status: 'failed' };
        }
      } else if (event.type === 'started') {
        col.status = 'running';
        if (col.task) {
          col.task = { ...col.task, status: 'running' };
        }
      }

      cols[idx] = col;
      return { columns: cols };
    });
  },

  handleTaskUpdateBatch: (taskId, messages) => {
    const { columns } = get();
    const idx = findColumnByTaskId(columns, taskId);
    if (idx === -1) return;

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };
      if (col.task) {
        col.task = {
          ...col.task,
          messages: [...col.task.messages, ...messages],
        };
      }
      cols[idx] = col;
      return { columns: cols };
    });
  },

  handlePartialMessage: (event) => {
    const { columns } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) return;

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };
      const newPartials = new Map(col.partialMessages);
      newPartials.set(event.messageId, {
        id: event.messageId,
        type: 'assistant',
        textSoFar: event.textSoFar,
        isStreaming: event.isStreaming,
        timestamp: new Date().toISOString(),
      });
      col.partialMessages = newPartials;
      cols[idx] = col;
      return { columns: cols };
    });
  },

  handlePartialMessageComplete: (event) => {
    const { columns } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) return;

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };
      const newPartials = new Map(col.partialMessages);
      newPartials.delete(event.messageId);
      col.partialMessages = newPartials;

      // Add the finalized message to the task
      if (col.task) {
        const finalMessage: TaskMessage = {
          id: event.messageId,
          type: 'assistant',
          content: event.text,
          timestamp: new Date().toISOString(),
        };
        col.task = {
          ...col.task,
          messages: [...col.task.messages, finalMessage],
        };
      }

      cols[idx] = col;
      return { columns: cols };
    });
  },

  handleStatusChange: (taskId, status) => {
    const { columns } = get();
    const idx = findColumnByTaskId(columns, taskId);
    if (idx === -1) return;

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };
      col.status = status;
      if (col.task) {
        col.task = { ...col.task, status };
      }
      cols[idx] = col;
      return { columns: cols };
    });
  },

  handlePermissionRequest: (request) => {
    // Only enqueue if the request belongs to one of our arena columns
    const { columns } = get();
    const idx = findColumnByTaskId(columns, request.taskId);
    if (idx === -1) return;

    set((state) => {
      const queue = [...state.permissionRequests, request];
      return {
        permissionRequests: queue,
        permissionRequest: queue[0],
      };
    });
  },

  respondToPermission: async (response) => {
    await api.respondToPermission(response);

    set((state) => {
      const queue = state.permissionRequests.filter((r) => r.id !== response.requestId);
      return {
        permissionRequests: queue,
        permissionRequest: queue[0] ?? null,
      };
    });
  },
}));
