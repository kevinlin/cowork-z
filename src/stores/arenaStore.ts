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

export type ArenaColumns = [ArenaColumnState, ArenaColumnState, ArenaColumnState];

type ArenaListStatus = 'idle' | 'running' | 'failed' | 'interrupted' | 'completed';

const createEmptyColumn = (): ArenaColumnState => ({
  modelId: null,
  modelDisplayName: '',
  taskId: null,
  task: null,
  status: 'idle',
  partialMessages: new Map(),
  error: null,
});

const createEmptyColumns = (): ArenaColumns => [createEmptyColumn(), createEmptyColumn(), createEmptyColumn()];

/**
 * Buffered events that arrived before columns were populated with taskIds.
 * Replayed once columnsFromArena assigns taskIds.
 */
type BufferedEvent =
  | { kind: 'taskUpdate'; event: TaskUpdateEvent }
  | { kind: 'partialMessage'; event: PartialMessageEvent }
  | { kind: 'partialMessageComplete'; event: CompleteMessageEvent };

interface ArenaState {
  arenaId: string | null;
  prompt: string;
  columns: ArenaColumns;

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
  handlePartialMessage: (event: PartialMessageEvent) => void;
  handlePartialMessageComplete: (event: CompleteMessageEvent) => void;
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
function findColumnByTaskId(columns: ArenaColumns, taskId: string): 0 | 1 | 2 | -1 {
  for (let i = 0; i < 3; i++) {
    if (columns[i].taskId === taskId) return i as 0 | 1 | 2;
  }
  return -1;
}

function isArenaTask(columns: ArenaColumns, pendingTaskIds: Set<string>, taskId: string): boolean {
  return findColumnByTaskId(columns, taskId) !== -1 || pendingTaskIds.has(taskId);
}

/**
 * Merge messages into a list by ID: replace in place when an ID already
 * exists (e.g. a tool call transitioning pending → completed, or an event
 * re-delivered after a buffered replay), append otherwise. Existing order is
 * preserved; new IDs are appended in arrival order. Mirrors the dedup logic
 * in taskStore (2026-06-12 review #11).
 */
function mergeMessagesById(messages: TaskMessage[], incoming: TaskMessage[]): TaskMessage[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values());
}

function deriveIsRunning(columns: ArenaColumns): boolean {
  return columns.some((col) => col.status === 'running' || col.status === 'starting');
}

function deriveArenaStatus(columns: ArenaColumns): ArenaListStatus {
  const statuses = columns.filter((col) => col.taskId).map((col) => col.status);
  if (statuses.length === 0) return 'idle';
  if (statuses.some((s) => s === 'running' || s === 'starting')) return 'running';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'interrupted' || s === 'cancelled')) return 'interrupted';
  return 'completed';
}

/**
 * Populate column state from an Arena response (loaded or just started).
 */
function columnsFromArena(arena: Arena, existing: ArenaColumns): ArenaColumns {
  const next: ArenaColumns = [createEmptyColumn(), createEmptyColumn(), createEmptyColumn()];

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

export const useArenaStore = create<ArenaState>((set, get) => {
  const syncArenaListStatus = (): void => {
    const { arenaId, columns, arenas } = get();
    if (!arenaId) return;

    const nextStatus = deriveArenaStatus(columns);
    const current = arenas.find((a) => a.id === arenaId);
    if (!current || current.status === nextStatus) return;

    const isTerminal = nextStatus !== 'idle' && nextStatus !== 'running';
    set({
      arenas: arenas.map((a) =>
        a.id === arenaId
          ? { ...a, status: nextStatus, completedAt: isTerminal ? (a.completedAt ?? new Date().toISOString()) : a.completedAt }
          : a
      ),
    });
  };

  return {
    arenaId: null,
    prompt: '',
    columns: createEmptyColumns(),
    permissionRequests: [],
    permissionRequest: null,
    questionRequest: null,
    arenas: [],
    pendingTaskIds: new Set<string>(),
    eventBuffer: [],

    // ---- Model configuration ----

    setColumnModel: (index, modelId, displayName) => {
      set((state) => {
        const columns = [...state.columns] as ArenaColumns;
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
        tasks: arena.tasks.map((t) => ({
          id: t.id,
          status: t.status,
          modelId: t.modelId,
          arenaSlot: t.arenaSlot,
          summary: t.summary,
        })),
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
          case 'partialMessage':
            get().handlePartialMessage(item.event);
            break;
          case 'partialMessageComplete':
            get().handlePartialMessageComplete(item.event);
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
      }) as ArenaColumns;

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
              columns: createEmptyColumns(),
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
        })) as ArenaColumns;
        return { columns };
      });
      syncArenaListStatus();
    },

    reset: () => {
      set({
        arenaId: null,
        prompt: '',
        columns: createEmptyColumns(),
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
    //
    // PERSISTENCE OWNERSHIP (2026-06-12 review #11): task-update events
    // (saveTaskMessage / completeTask / saveTaskSession) are persisted exactly
    // once by taskStore's module-level onTaskUpdate subscription, which covers
    // ALL task IDs including arena tasks. These handlers only update arena UI
    // state — do NOT add persistence calls here. The single exception is
    // finalized streaming messages (handlePartialMessageComplete): taskStore
    // only persists those for its currentTask, which is never an arena task.

    handleTaskUpdate: (event) => {
      const { columns, pendingTaskIds } = get();
      const idx = findColumnByTaskId(columns, event.taskId);
      if (idx === -1) {
        if (pendingTaskIds.has(event.taskId)) {
          set((s) => ({ eventBuffer: [...s.eventBuffer, { kind: 'taskUpdate', event }] }));
        }
        return;
      }

      set((state) => {
        const cols = [...state.columns] as ArenaColumns;
        const col = { ...cols[idx] };

        if (event.type === 'message' && event.message) {
          const task = col.task;
          if (task) {
            col.task = {
              ...task,
              messages: mergeMessagesById(task.messages, [event.message]),
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
      if (event.type === 'complete' || event.type === 'error' || event.type === 'started') {
        syncArenaListStatus();
      }
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
        const cols = [...state.columns] as ArenaColumns;
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

      // Sole persister for arena finalized streaming messages — taskStore's
      // finalizePartialMessage only saves for its currentTask (see ownership
      // note above).
      api.saveTaskMessage(event.taskId, finalMessage).catch((err) => {
        console.error('Failed to save arena finalized message:', err);
      });

      set((state) => {
        const cols = [...state.columns] as ArenaColumns;
        const col = { ...cols[idx] };
        const newPartials = new Map(col.partialMessages);
        newPartials.delete(event.messageId);
        col.partialMessages = newPartials;

        if (col.task) {
          col.task = {
            ...col.task,
            messages: mergeMessagesById(col.task.messages, [finalMessage]),
          };
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
  };
});
