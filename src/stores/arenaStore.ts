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
  QuestionRequest,
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

/**
 * Buffered events that arrived before columns were populated with taskIds.
 * Replayed once columnsFromArena assigns taskIds.
 */
type BufferedEvent =
  | { kind: 'taskUpdate'; event: TaskUpdateEvent }
  | { kind: 'taskUpdateBatch'; taskId: string; messages: TaskMessage[] }
  | { kind: 'partialMessage'; event: PartialMessageEvent }
  | { kind: 'partialMessageComplete'; event: CompleteMessageEvent }
  | { kind: 'statusChange'; taskId: string; status: TaskStatus };

interface ArenaState {
  arenaId: string | null;
  prompt: string;
  columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState];

  /** Permission request queue (supports parallel tool calls) */
  permissionRequests: PermissionRequest[];
  /** Derived: first item in the queue (shown in modal) */
  permissionRequest: PermissionRequest | null;

  /** Active question request (shown in dialog) */
  questionRequest: QuestionRequest | null;

  /** Arena list for sidebar */
  arenas: ArenaListItem[];

  /**
   * Task IDs that belong to the current arena but haven't been mapped to
   * columns yet (populated before the async startArena call returns).
   * Events for these IDs are buffered and replayed once columns are set.
   */
  pendingTaskIds: Set<string>;
  eventBuffer: BufferedEvent[];

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
  handleQuestionRequest: (request: QuestionRequest) => void;
  respondToQuestion: (answers: Array<{ labels: string[]; customText?: string }>) => Promise<void>;
  cancelQuestion: () => void;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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

function isArenaTask(
  columns: [ArenaColumnState, ArenaColumnState, ArenaColumnState],
  pendingTaskIds: Set<string>,
  taskId: string
): boolean {
  return findColumnByTaskId(columns, taskId) !== -1 || pendingTaskIds.has(taskId);
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
      const existingCol = existing[idx];

      // Preserve in-memory messages when taskId matches (follow-up case).
      // Use DB messages when loading a different/new arena.
      const preserveMessages = existingCol.task?.id === task.id && (existingCol.task?.messages.length ?? 0) > 0;
      const mergedMessages = preserveMessages ? existingCol.task!.messages : task.messages;

      next[idx] = {
        modelId: task.modelId ?? existingCol.modelId,
        modelDisplayName: existingCol.modelDisplayName || task.modelId?.split('/').pop() || '',
        taskId: task.id,
        task: { ...task, messages: mergedMessages },
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
  questionRequest: null,
  arenas: [],
  pendingTaskIds: new Set<string>(),
  eventBuffer: [],

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

    // Register task IDs so events arriving before set() aren't dropped
    const taskIds = new Set(arena.tasks.map((t) => t.id));
    set({ pendingTaskIds: taskIds });

    const newColumns = columnsFromArena(arena, columns);

    const timestamp = new Date().toISOString();
    for (const col of newColumns) {
      if (col.taskId && col.task) {
        const userMessage: TaskMessage = {
          id: createMessageId(),
          type: 'user',
          content: prompt,
          timestamp,
        };
        col.task = { ...col.task, messages: [userMessage, ...col.task.messages] };
        api.saveTaskMessage(col.taskId, userMessage).catch((err) => {
          console.error('Failed to save arena initial user message:', err);
        });
      }
    }

    const currentArenas = get().arenas;
    const newListItem: ArenaListItem = {
      id: arena.id,
      prompt: arena.prompt,
      workspaceId: arena.workspaceId,
      createdAt: arena.createdAt,
      completedAt: arena.completedAt,
      status: 'running',
      modelIds: arena.tasks.map((t) => t.modelId ?? null),
    };

    // Grab buffered events before clearing
    const buffered = get().eventBuffer;

    set({
      arenaId: arena.id,
      prompt: arena.prompt,
      columns: newColumns,
      arenas: [newListItem, ...currentArenas],
      pendingTaskIds: new Set<string>(),
      eventBuffer: [],
    });

    // Replay buffered events now that columns have taskIds
    for (const item of buffered) {
      switch (item.kind) {
        case 'taskUpdate':
          get().handleTaskUpdate(item.event);
          break;
        case 'taskUpdateBatch':
          get().handleTaskUpdateBatch(item.taskId, item.messages);
          break;
        case 'partialMessage':
          get().handlePartialMessage(item.event);
          break;
        case 'partialMessageComplete':
          get().handlePartialMessageComplete(item.event);
          break;
        case 'statusChange':
          get().handleStatusChange(item.taskId, item.status);
          break;
      }
    }

    return arena.id;
  },

  sendFollowUp: async (message) => {
    const { arenaId, columns } = get();
    if (!arenaId) return;

    // Create and persist user message for each active column (unique ID per column)
    const timestamp = new Date().toISOString();
    const columnsWithUserMsg = columns.map((col) => {
      const { task } = col;
      if (!task) return col;
      const userMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: message,
        timestamp,
      };
      if (col.taskId) {
        api.saveTaskMessage(col.taskId, userMessage).catch((err) => {
          console.error('Failed to save arena user message:', err);
        });
      }
      return {
        ...col,
        task: { ...task, messages: [...task.messages, userMessage] },
        status: 'running' as TaskStatus,
        error: null,
      };
    }) as [ArenaColumnState, ArenaColumnState, ArenaColumnState];

    set({ prompt: message, columns: columnsWithUserMsg });

    // Send resume command — events will deliver new messages
    await api.resumeArena(arenaId, message);
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
      questionRequest: null,
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
            questionRequest: null,
            pendingTaskIds: new Set<string>(),
            eventBuffer: [],
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
      questionRequest: null,
      pendingTaskIds: new Set<string>(),
      eventBuffer: [],
    });
  },

  // ---- Event handlers ----
  //
  // Each handler checks findColumnByTaskId first. If the taskId isn't mapped
  // to a column yet but IS in pendingTaskIds (arena started, columns not yet
  // populated), the event is buffered and replayed once columns are set.

  handleTaskUpdate: (event) => {
    const { columns, pendingTaskIds } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) {
      if (pendingTaskIds.has(event.taskId)) {
        set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'taskUpdate', event }] }));
      }
      return;
    }

    if (event.type === 'message' && event.message) {
      api.saveTaskMessage(event.taskId, event.message).catch((err) => {
        console.error('Failed to save arena task message:', err);
      });
    } else if (event.type === 'complete' && event.result) {
      const status = event.result.status === 'success' ? 'completed' : event.result.status === 'interrupted' ? 'interrupted' : 'failed';
      api.completeTask(event.taskId, status, event.result.sessionId).catch((err) => {
        console.error('Failed to save arena task completion:', err);
      });
    } else if (event.type === 'error') {
      api.completeTask(event.taskId, 'failed', event.sessionId).catch((err) => {
        console.error('Failed to save arena task error status:', err);
      });
    } else if (event.type === 'started' && event.sessionId) {
      api.saveTaskSession(event.taskId, event.sessionId).catch((err) => {
        console.error('Failed to save arena task session ID:', err);
      });
    }

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
    const { columns, pendingTaskIds } = get();
    const idx = findColumnByTaskId(columns, taskId);
    if (idx === -1) {
      if (pendingTaskIds.has(taskId)) {
        set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'taskUpdateBatch', taskId, messages }] }));
      }
      return;
    }

    for (const msg of messages) {
      api.saveTaskMessage(taskId, msg).catch((err) => {
        console.error('Failed to save arena batch message:', err);
      });
    }

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
    const { columns, pendingTaskIds } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) {
      if (pendingTaskIds.has(event.taskId)) {
        set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'partialMessage', event }] }));
      }
      return;
    }

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
    const { columns, pendingTaskIds } = get();
    const idx = findColumnByTaskId(columns, event.taskId);
    if (idx === -1) {
      if (pendingTaskIds.has(event.taskId)) {
        set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'partialMessageComplete', event }] }));
      }
      return;
    }

    const finalMessage: TaskMessage = {
      id: event.messageId,
      type: 'assistant',
      content: event.text,
      timestamp: new Date().toISOString(),
    };

    api.saveTaskMessage(event.taskId, finalMessage).catch((err) => {
      console.error('Failed to save arena finalized message:', err);
    });

    set((state) => {
      const cols = [...state.columns] as [ArenaColumnState, ArenaColumnState, ArenaColumnState];
      const col = { ...cols[idx] };
      const newPartials = new Map(col.partialMessages);
      newPartials.delete(event.messageId);
      col.partialMessages = newPartials;

      if (col.task) {
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
    const { columns, pendingTaskIds } = get();
    const idx = findColumnByTaskId(columns, taskId);
    if (idx === -1) {
      if (pendingTaskIds.has(taskId)) {
        set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'statusChange', taskId, status }] }));
      }
      return;
    }

    api.saveTaskStatus(taskId, status).catch((err) => {
      console.error('Failed to save arena task status:', err);
    });

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
    const { columns, pendingTaskIds } = get();
    if (!isArenaTask(columns, pendingTaskIds, request.taskId)) return;

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

  handleQuestionRequest: (request) => {
    const { columns, pendingTaskIds } = get();
    if (!isArenaTask(columns, pendingTaskIds, request.taskId)) return;

    set({ questionRequest: request });
  },

  respondToQuestion: async (answers) => {
    const { questionRequest } = get();
    if (!questionRequest) return;

    await api.replyToQuestion(questionRequest.taskId, questionRequest.requestId, answers);
    set({ questionRequest: null });
  },

  cancelQuestion: () => {
    set({ questionRequest: null });
  },
}));
