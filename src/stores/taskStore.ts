import { create } from 'zustand';
import * as api from '@/lib/tauri-api';
import type {
  CompleteMessageEvent,
  FolderPermission,
  PartialMessage,
  PartialMessageEvent,
  PermissionRequest,
  PermissionResponse,
  Task,
  TaskConfig,
  TaskMessage,
  TaskStatus,
  TaskUpdateEvent,
} from '@/shared';

// Batch update event type for performance optimization
interface TaskUpdateBatchEvent {
  taskId: string;
  messages: TaskMessage[];
}

// Setup progress event type
interface SetupProgressEvent {
  taskId: string;
  stage: string;
  message?: string;
  isFirstTask?: boolean;
  modelName?: string;
}

// Startup stage info for the progress indicator
export interface StartupStageInfo {
  stage: string;
  message: string;
  modelName?: string;
  isFirstTask: boolean;
  startTime: number;
}

interface TaskState {
  // Current task
  currentTask: Task | null;
  isLoading: boolean;
  error: string | null;

  // Task history
  tasks: Task[];

  // Partial messages (streaming)
  partialMessages: Map<string, PartialMessage>;

  // Permission handling
  permissionRequest: PermissionRequest | null;

  // Setup progress (e.g., browser download)
  setupProgress: string | null;
  setupProgressTaskId: string | null;
  setupDownloadStep: number; // 1=Chromium, 2=FFMPEG, 3=Headless Shell

  // Startup stage progress (for task initialization indicator)
  startupStage: StartupStageInfo | null;
  startupStageTaskId: string | null;

  // Task launcher
  isLauncherOpen: boolean;
  openLauncher: () => void;
  closeLauncher: () => void;

  // Working folder permissions (per-conversation, persisted in DB)
  folderPermissions: FolderPermission[];
  addFolderPermission: (path: string, accessLevel: string) => void;
  removeFolderPermission: (path: string) => void;
  loadFolderPermissions: (taskId: string) => Promise<void>;

  // Actions
  startTask: (config: TaskConfig) => Promise<Task | null>;
  setSetupProgress: (taskId: string | null, message: string | null) => void;
  setStartupStage: (taskId: string | null, stage: string | null, message?: string, modelName?: string, isFirstTask?: boolean) => void;
  clearStartupStage: (taskId: string) => void;
  sendFollowUp: (message: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  interruptTask: () => Promise<void>;
  setPermissionRequest: (request: PermissionRequest | null) => void;
  respondToPermission: (response: PermissionResponse) => Promise<void>;
  addTaskUpdate: (event: TaskUpdateEvent) => void;
  addTaskUpdateBatch: (event: TaskUpdateBatchEvent) => void;
  addPartialMessage: (event: PartialMessageEvent) => void;
  finalizePartialMessage: (event: CompleteMessageEvent) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  setTaskSummary: (taskId: string, summary: string) => void;
  loadTasks: () => Promise<void>;
  loadTaskById: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  reset: () => void;
}

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Module-level cache to track last logged events for deduplication
const lastLoggedEvents = new Map<
  string,
  {
    type: string;
    normalizedContent: string;
  }
>();

/**
 * Normalizes progress messages by removing timestamp variations
 * to enable content-based deduplication.
 * Example: "INFO 2026-02-01T06:20:03 +7ms service=bus" -> "INFO 2026-02-01T06:20:03 +Xms service=bus"
 */
function normalizeProgressMessage(message: string): string {
  // Remove timestamp patterns like "+7ms", "+10ms", etc.
  return message.replace(/\+\d+ms/g, '+Xms');
}

export const useTaskStore = create<TaskState>((set, get) => ({
  currentTask: null,
  isLoading: false,
  error: null,
  tasks: [],
  partialMessages: new Map<string, PartialMessage>(),
  permissionRequest: null,
  setupProgress: null,
  setupProgressTaskId: null,
  setupDownloadStep: 1,
  startupStage: null,
  startupStageTaskId: null,
  isLauncherOpen: false,
  folderPermissions: [],

  addFolderPermission: (path: string, accessLevel: string) => {
    const { folderPermissions, currentTask } = get();
    // Avoid duplicates
    if (folderPermissions.some((fp) => fp.folderPath === path)) {
      return;
    }
    const newPerms = [...folderPermissions, { folderPath: path, accessLevel: accessLevel as FolderPermission['accessLevel'] }];
    set({ folderPermissions: newPerms });

    // Persist to database if there's an active task
    if (currentTask) {
      api.saveFolderPermission(currentTask.id, path, accessLevel).catch((err) => {
        console.error('Failed to persist folder permission:', err);
      });
    }
  },

  removeFolderPermission: (path: string) => {
    const { folderPermissions, currentTask } = get();
    const newPerms = folderPermissions.filter((fp) => fp.folderPath !== path);
    set({ folderPermissions: newPerms });

    // Remove from database if there's an active task
    if (currentTask) {
      api.removeFolderPermission(currentTask.id, path).catch((err) => {
        console.error('Failed to remove folder permission:', err);
      });
    }
  },

  loadFolderPermissions: async (taskId: string) => {
    try {
      const perms = await api.getFolderPermissions(taskId);
      set({ folderPermissions: perms });
    } catch (err) {
      console.error('Failed to load folder permissions:', err);
    }
  },

  setSetupProgress: (taskId: string | null, message: string | null) => {
    // Detect which package is being downloaded from the message
    let step = useTaskStore.getState().setupDownloadStep;
    if (message) {
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('downloading chromium headless')) {
        step = 3;
      } else if (lowerMsg.includes('downloading ffmpeg')) {
        step = 2;
      } else if (lowerMsg.includes('downloading chromium')) {
        step = 1;
      }
    }
    set({
      setupProgress: message,
      setupProgressTaskId: taskId,
      setupDownloadStep: step,
    });
  },

  setStartupStage: (taskId: string | null, stage: string | null, message?: string, modelName?: string, isFirstTask?: boolean) => {
    if (!(taskId && stage)) {
      set({ startupStage: null, startupStageTaskId: null });
      return;
    }

    const currentState = get();
    // Preserve startTime if this is the same task, otherwise start fresh
    const startTime =
      currentState.startupStageTaskId === taskId && currentState.startupStage ? currentState.startupStage.startTime : Date.now();

    set({
      startupStage: {
        stage,
        message: message || stage,
        modelName,
        isFirstTask: isFirstTask ?? false,
        startTime,
      },
      startupStageTaskId: taskId,
    });
  },

  clearStartupStage: (taskId: string) => {
    const currentState = get();
    if (currentState.startupStageTaskId === taskId) {
      set({ startupStage: null, startupStageTaskId: null });
    }
  },

  startTask: async (config: TaskConfig) => {
    set({ isLoading: true, error: null });
    try {
      void api.logEvent({
        level: 'info',
        message: 'UI start task',
        context: { prompt: config.prompt, taskId: config.taskId },
      });
      const task = await api.startTask(config);

      // Create initial user message for the prompt
      const initialUserMessage: TaskMessage = {
        id: createMessageId(),
        type: 'user',
        content: config.prompt,
        timestamp: task.createdAt,
      };

      // Persist initial user message to database (fire-and-forget for performance)
      api.saveTaskMessage(task.id, initialUserMessage).catch((err) => {
        console.error('Failed to save initial user message:', err);
        void api.logEvent({
          level: 'error',
          message: 'Failed to persist initial user message',
          context: {
            taskId: task.id,
            messageId: initialUserMessage.id,
            error: String(err),
          },
        });
      });

      // Task might be 'running' or 'queued' depending on if another task is running
      // Also add to tasks list so sidebar updates immediately
      const currentTasks = get().tasks;
      set({
        currentTask: {
          ...task,
          messages: [initialUserMessage], // Add initial message to task
        },
        tasks: [task, ...currentTasks.filter((t) => t.id !== task.id)],
        // Keep loading state if queued (waiting for queue)
        isLoading: task.status === 'queued',
      });
      void api.logEvent({
        level: 'info',
        message: task.status === 'queued' ? 'UI task queued' : 'UI task started',
        context: { taskId: task.id, status: task.status },
      });
      return task;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to start task',
        isLoading: false,
      });
      void api.logEvent({
        level: 'error',
        message: 'UI task start failed',
        context: { error: err instanceof Error ? err.message : String(err) },
      });
      return null;
    }
  },

  sendFollowUp: async (message: string) => {
    const { currentTask, startTask } = get();
    if (!currentTask) {
      set({ error: 'No active task to continue' });
      void api.logEvent({
        level: 'warn',
        message: 'UI follow-up failed: no active task',
      });
      return;
    }

    const sessionId = currentTask.result?.sessionId || currentTask.sessionId;

    // If no session but task was interrupted, start a fresh task with the new message
    if (!sessionId && currentTask.status === 'interrupted') {
      void api.logEvent({
        level: 'info',
        message: 'UI follow-up: starting fresh task (no session from interrupted task)',
        context: { taskId: currentTask.id },
      });
      await startTask({ prompt: message });
      return;
    }

    if (!sessionId) {
      set({ error: 'No session to continue - please start a new task' });
      void api.logEvent({
        level: 'warn',
        message: 'UI follow-up failed: missing session',
        context: { taskId: currentTask.id },
      });
      return;
    }

    const userMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };

    // Optimistically add user message and set status to running
    const taskId = currentTask.id;
    set((state) => ({
      isLoading: true,
      error: null,
      currentTask: state.currentTask
        ? {
            ...state.currentTask,
            status: 'running',
            result: undefined,
            messages: [...state.currentTask.messages, userMessage],
          }
        : null,
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: 'running' as TaskStatus } : t)),
    }));

    // Persist user message to database (fire-and-forget for performance)
    api.saveTaskMessage(taskId, userMessage).catch((err) => {
      console.error('Failed to save user message:', err);
      void api.logEvent({
        level: 'error',
        message: 'Failed to persist user message',
        context: { taskId, messageId: userMessage.id, error: String(err) },
      });
    });

    try {
      void api.logEvent({
        level: 'info',
        message: 'UI follow-up sent',
        context: { taskId: currentTask.id, message },
      });
      // Folder permissions are loaded from DB on the Rust side during resume
      const task = await api.resumeSession(sessionId, message, currentTask.id);

      // Update status based on response (could be 'running' or 'queued')
      set((state) => ({
        currentTask: state.currentTask ? { ...state.currentTask, status: task.status } : null,
        isLoading: task.status === 'queued',
        tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)),
      }));
    } catch (err) {
      set((state) => ({
        error: err instanceof Error ? err.message : 'Failed to send message',
        isLoading: false,
        currentTask: state.currentTask ? { ...state.currentTask, status: 'failed' } : null,
        tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: 'failed' as TaskStatus } : t)),
      }));
      void api.logEvent({
        level: 'error',
        message: 'UI follow-up failed',
        context: {
          taskId: currentTask.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  cancelTask: async () => {
    const { currentTask } = get();
    if (currentTask) {
      void api.logEvent({
        level: 'info',
        message: 'UI cancel task',
        context: { taskId: currentTask.id },
      });
      await api.cancelTask(currentTask.id);
      set((state) => ({
        currentTask: state.currentTask ? { ...state.currentTask, status: 'cancelled' } : null,
        tasks: state.tasks.map((t) => (t.id === currentTask.id ? { ...t, status: 'cancelled' as TaskStatus } : t)),
      }));
    }
  },

  interruptTask: async () => {
    const { currentTask } = get();
    if (currentTask && currentTask.status === 'running') {
      const sessionId = currentTask.sessionId || currentTask.result?.sessionId;
      void api.logEvent({
        level: 'info',
        message: 'UI interrupt task',
        context: { taskId: currentTask.id, sessionId },
      });
      if (sessionId) {
        await api.abortSession(currentTask.id, sessionId);
      } else {
        await api.cancelTask(currentTask.id);
      }
    }
  },

  setPermissionRequest: (request) => {
    set({ permissionRequest: request });
  },

  respondToPermission: async (response: PermissionResponse) => {
    void api.logEvent({
      level: 'info',
      message: 'UI permission response',
      context: { ...response },
    });
    await api.respondToPermission(response);
    set({ permissionRequest: null });
  },

  addTaskUpdate: (event: TaskUpdateEvent) => {
    // Determine the eventKey and normalizedContent based on event type
    let eventKey = `${event.taskId}:${event.type}`;
    let normalizedContent = event.type as string;

    // For progress events, include stage and normalize message content
    if (event.type === 'progress' && event.progress?.message) {
      eventKey = `${event.taskId}:${event.progress.stage}`;
      normalizedContent = normalizeProgressMessage(event.progress.message);
    }

    // Check for duplicate AFTER determining the correct key
    const lastLogged = lastLoggedEvents.get(eventKey);
    if (lastLogged?.normalizedContent === normalizedContent) {
      return; // Skip duplicate event
    }
    lastLoggedEvents.set(eventKey, {
      type: event.type as string,
      normalizedContent,
    });

    // Log the event
    void api.logEvent({
      level: 'debug',
      message: `taskUpdateEvent: ${JSON.stringify(event)}`,
      context: { ...event },
    });

    // Persist message to database
    if (event.type === 'message' && event.message) {
      api.saveTaskMessage(event.taskId, event.message).catch((err) => {
        console.error('Failed to save task message:', err);
      });
    }

    // Persist complete event to database
    if (event.type === 'complete' && event.result) {
      const status = event.result.status === 'success' ? 'completed' : event.result.status === 'interrupted' ? 'interrupted' : 'failed';
      api.completeTask(event.taskId, status, event.result.sessionId).catch((err) => {
        console.error('Failed to save task completion:', err);
      });
    }

    // Persist error status and sessionId to database
    if (event.type === 'error') {
      api.completeTask(event.taskId, 'failed', event.sessionId).catch((err) => {
        console.error('Failed to save task error status:', err);
      });
    }

    // Clean up cache entries when tasks complete or error (prevent memory leaks)
    if (event.type === 'complete' || event.type === 'error') {
      const keysToDelete: string[] = [];
      lastLoggedEvents.forEach((_, key) => {
        if (key.startsWith(`${event.taskId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach((key) => lastLoggedEvents.delete(key));
    }

    set((state) => {
      // Determine if this event is for the currently viewed task
      const isCurrentTask = state.currentTask?.id === event.taskId;

      // Start with current state
      let updatedCurrentTask = state.currentTask;
      let updatedTasks = state.tasks;
      let newStatus: TaskStatus | null = null;

      // Handle message events - only if viewing this task
      if (event.type === 'message' && event.message && isCurrentTask && state.currentTask) {
        const existingIndex = state.currentTask.messages.findIndex((m) => m.id === event.message!.id);
        const nextMessages =
          existingIndex === -1
            ? [...state.currentTask.messages, event.message]
            : state.currentTask.messages.map((m, idx) => (idx === existingIndex ? event.message! : m));
        updatedCurrentTask = {
          ...state.currentTask,
          messages: nextMessages,
        };
      }

      // Handle complete events
      if (event.type === 'complete' && event.result) {
        // Map result status to task status
        if (event.result.status === 'success') {
          newStatus = 'completed';
        } else if (event.result.status === 'interrupted') {
          newStatus = 'interrupted';
        } else {
          newStatus = 'failed';
        }

        // Update currentTask if viewing this task
        if (isCurrentTask && state.currentTask) {
          updatedCurrentTask = {
            ...state.currentTask,
            status: newStatus,
            result: event.result,
            // Don't set completedAt for interrupted tasks - they can continue
            completedAt: newStatus === 'interrupted' ? undefined : new Date().toISOString(),
            sessionId: event.result.sessionId || state.currentTask.sessionId,
          };
        }
      }

      // Handle error events
      if (event.type === 'error') {
        newStatus = 'failed';

        // Update currentTask if viewing this task
        if (isCurrentTask && state.currentTask) {
          // Preserve sessionId from event OR existing task (robust fallback)
          const preservedSessionId = event.sessionId || state.currentTask.sessionId || state.currentTask.result?.sessionId;
          updatedCurrentTask = {
            ...state.currentTask,
            status: newStatus,
            result: {
              status: 'error',
              error: event.error,
              sessionId: preservedSessionId,
            },
            sessionId: preservedSessionId,
          };
        }
      }

      // Always update sidebar tasks list if status changed
      if (newStatus) {
        const finalStatus = newStatus;
        updatedTasks = state.tasks.map((t) => (t.id === event.taskId ? { ...t, status: finalStatus } : t));
      }

      return {
        currentTask: updatedCurrentTask,
        tasks: updatedTasks,
        isLoading: false,
      };
    });
  },

  // Batch update handler for performance - processes multiple messages in single state update
  addTaskUpdateBatch: (event: TaskUpdateBatchEvent) => {
    void api.logEvent({
      level: 'debug',
      message: 'UI task batch update received',
      context: { taskId: event.taskId, messageCount: event.messages.length },
    });
    set((state) => {
      if (!state.currentTask || state.currentTask.id !== event.taskId) {
        return state;
      }

      // Add all messages in a single state update, de-duplicating by id
      const existingById = new Map(state.currentTask.messages.map((msg) => [msg.id, msg]));
      event.messages.forEach((message) => {
        existingById.set(message.id, message);
      });
      const mergedMessages = Array.from(existingById.values());
      const updatedTask = {
        ...state.currentTask,
        messages: mergedMessages,
      };

      return { currentTask: updatedTask, isLoading: false };
    });
  },

  // Add or update a partial message (streaming)
  addPartialMessage: (event: PartialMessageEvent) => {
    set((state) => {
      // Only process if this is for the current task
      if (!state.currentTask || state.currentTask.id !== event.taskId) {
        return state;
      }

      // Create new Map to trigger re-render
      const newPartialMessages = new Map(state.partialMessages);

      // Get existing partial or create new one
      const existing = newPartialMessages.get(event.messageId);
      const partial: PartialMessage = {
        id: event.messageId,
        type: 'assistant',
        textSoFar: event.textSoFar,
        isStreaming: event.isStreaming,
        timestamp: existing?.timestamp || new Date().toISOString(),
      };

      newPartialMessages.set(event.messageId, partial);

      return { partialMessages: newPartialMessages };
    });
  },

  // Finalize a partial message (convert to complete message)
  finalizePartialMessage: (event: CompleteMessageEvent) => {
    set((state) => {
      // Only process if this is for the current task
      if (!state.currentTask || state.currentTask.id !== event.taskId) {
        return state;
      }

      // Get the partial message
      const partial = state.partialMessages.get(event.messageId);

      // Create new Map without this partial
      const newPartialMessages = new Map(state.partialMessages);
      newPartialMessages.delete(event.messageId);

      // If no partial existed, just clean up
      if (!partial) {
        return { partialMessages: newPartialMessages };
      }

      // Convert partial to complete message
      const completeMessage: TaskMessage = {
        id: event.messageId,
        type: 'assistant',
        content: event.text,
        timestamp: partial.timestamp,
      };

      // Check if message already exists in messages array
      const existingIndex = state.currentTask.messages.findIndex((m) => m.id === event.messageId);
      const updatedMessages =
        existingIndex === -1
          ? [...state.currentTask.messages, completeMessage]
          : state.currentTask.messages.map((m, idx) => (idx === existingIndex ? completeMessage : m));

      // Persist to database
      api.saveTaskMessage(event.taskId, completeMessage).catch((err) => {
        console.error('Failed to save finalized message:', err);
      });

      return {
        partialMessages: newPartialMessages,
        currentTask: {
          ...state.currentTask,
          messages: updatedMessages,
        },
      };
    });
  },

  // Update task status (e.g., queued -> running)
  updateTaskStatus: (taskId: string, status: TaskStatus) => {
    // Persist status to database
    api.saveTaskStatus(taskId, status).catch((err) => {
      console.error('Failed to save task status:', err);
    });

    set((state) => {
      // Update in tasks list
      const updatedTasks = state.tasks.map((task) =>
        task.id === taskId ? { ...task, status, updatedAt: new Date().toISOString() } : task
      );

      // Update currentTask if it matches
      const updatedCurrentTask =
        state.currentTask?.id === taskId
          ? {
              ...state.currentTask,
              status,
              updatedAt: new Date().toISOString(),
            }
          : state.currentTask;

      return {
        tasks: updatedTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  // Update task summary (AI-generated)
  setTaskSummary: (taskId: string, summary: string) => {
    // Persist summary to database
    api.saveTaskSummary(taskId, summary).catch((err) => {
      console.error('Failed to save task summary:', err);
    });

    set((state) => {
      // Update in tasks list
      const updatedTasks = state.tasks.map((task) => (task.id === taskId ? { ...task, summary } : task));

      // Update currentTask if it matches
      const updatedCurrentTask = state.currentTask?.id === taskId ? { ...state.currentTask, summary } : state.currentTask;

      return {
        tasks: updatedTasks,
        currentTask: updatedCurrentTask,
      };
    });
  },

  loadTasks: async () => {
    const tasks = await api.listTasks();
    set({ tasks });
  },

  loadTaskById: async (taskId: string) => {
    const task = await api.getTask(taskId);
    set({ currentTask: task, error: task ? null : 'Task not found' });
  },

  deleteTask: async (taskId: string) => {
    await api.deleteTask(taskId);
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      // Clear currentTask if it's the one being deleted
      currentTask: state.currentTask?.id === taskId ? null : state.currentTask,
    }));
  },

  clearHistory: async () => {
    await api.clearTaskHistory();
    set({ tasks: [] });
  },

  reset: () => {
    set({
      currentTask: null,
      isLoading: false,
      error: null,
      partialMessages: new Map<string, PartialMessage>(),
      permissionRequest: null,
      setupProgress: null,
      setupProgressTaskId: null,
      setupDownloadStep: 1,
      startupStage: null,
      startupStageTaskId: null,
      isLauncherOpen: false,
      folderPermissions: [],
    });
  },

  openLauncher: () => set({ isLauncherOpen: true }),
  closeLauncher: () => set({ isLauncherOpen: false }),
}));

// Startup stages that should be tracked (before first tool runs)
const STARTUP_STAGES = ['starting', 'browser', 'environment', 'loading', 'connecting', 'waiting'];

// Global subscription to setup progress events (browser download, startup stages, etc.)
// This runs when the module is loaded to catch early progress events
if (typeof window !== 'undefined' && api.isRunningInTauri()) {
  // Set up Tauri event listeners
  void api.onTaskProgress((progress) => {
    const event = progress as SetupProgressEvent;
    const state = useTaskStore.getState();

    // Handle startup stages
    if (STARTUP_STAGES.includes(event.stage)) {
      state.setStartupStage(event.taskId, event.stage, event.message, event.modelName, event.isFirstTask);
      return;
    }

    // Handle tool-use stage - clear startup stage since first tool has arrived
    if (event.stage === 'tool-use') {
      state.clearStartupStage(event.taskId);
      return;
    }

    // Handle browser download progress (setup stage)
    if (event.stage === 'setup' && event.message) {
      // Clear progress if installation completed
      if (event.message.toLowerCase().includes('installed successfully')) {
        state.setSetupProgress(null, null);
      } else {
        state.setSetupProgress(event.taskId, event.message);
      }
      return;
    }

    // Legacy fallback for other messages
    if (event.message) {
      if (event.message.toLowerCase().includes('installed successfully')) {
        state.setSetupProgress(null, null);
      } else if (event.message.toLowerCase().includes('download')) {
        state.setSetupProgress(event.taskId, event.message);
      }
    }
  });

  // Clear progress when task completes or errors
  void api.onTaskUpdate((event) => {
    const updateEvent = event as TaskUpdateEvent;
    if (updateEvent.type === 'complete' || updateEvent.type === 'error') {
      const state = useTaskStore.getState();
      if (state.setupProgressTaskId === updateEvent.taskId) {
        state.setSetupProgress(null, null);
      }
      state.clearStartupStage(updateEvent.taskId);
    }
  });

  // Subscribe to task summary updates
  void api.onTaskSummary((data) => {
    useTaskStore.getState().setTaskSummary(data.taskId, data.summary);
  });

  // Subscribe to partial message updates (streaming)
  void api.onTaskMessagePartial((event) => {
    console.log('[streaming] received partial:', event.messageId, 'textLength:', event.textSoFar.length);
    void api.logEvent({
      level: 'debug',
      message: `[streaming] partial received: messageId=${event.messageId}, textLength=${event.textSoFar.length}`,
    });
    useTaskStore.getState().addPartialMessage(event);
  });

  // Subscribe to complete message updates (streaming finalized)
  void api.onTaskMessageComplete((event) => {
    console.log('[streaming] received complete:', event.messageId, 'textLength:', event.text.length);
    void api.logEvent({
      level: 'debug',
      message: `[streaming] complete received: messageId=${event.messageId}, textLength=${event.text.length}, text="${event.text}"`,
    });
    useTaskStore.getState().finalizePartialMessage(event);
  });
}
