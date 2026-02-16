import { create } from 'zustand';
import * as api from '@/lib/tauri-api';
import type {
  Artifact,
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
  Todo,
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

  // Permission handling (queue supports concurrent requests from parallel tool calls)
  permissionRequests: PermissionRequest[];
  /** Derived: first item in the queue (shown in the modal) */
  permissionRequest: PermissionRequest | null;
  /** Patterns already approved by the user this session — used to auto-approve duplicates */
  approvedPatterns: Set<string>;

  // Todos (per task)
  todos: Map<string, Todo[]>;
  setTodos: (taskId: string, todos: Todo[]) => void;

  // Artifacts (per task)
  artifacts: Map<string, Artifact[]>;
  setArtifacts: (taskId: string, artifacts: Artifact[]) => void;

  // Startup stage progress (for task initialization indicator)
  startupStage: StartupStageInfo | null;
  startupStageTaskId: string | null;

  // Settings dialog
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;

  // About dialog
  showAbout: boolean;
  setShowAbout: (show: boolean) => void;

  // OpenCode CLI missing dialog
  showCliMissing: boolean;
  setShowCliMissing: (show: boolean) => void;

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
  setStartupStage: (taskId: string | null, stage: string | null, message?: string, modelName?: string, isFirstTask?: boolean) => void;
  clearStartupStage: (taskId: string) => void;
  sendFollowUp: (message: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  interruptTask: () => Promise<void>;
  setPermissionRequest: (request: PermissionRequest | null) => void;
  enqueuePermissionRequest: (request: PermissionRequest) => void;
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

/**
 * Tool names from OpenCode that modify/create files.
 * - write: Create new files or overwrite existing ones
 * - edit: Modify existing files via string replacement
 * - patch: Apply patches to files
 * - multiedit: Multi-file edits
 */
const FILE_WRITING_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit']);

/**
 * Extract file path from a tool input object.
 * OpenCode tools use various field names for file paths.
 */
function extractFilePathFromToolInput(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  // OpenCode tools use 'file_path' or 'path' for the target file
  const path = input.file_path ?? input.filePath ?? input.path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

/**
 * Extract file paths from a bash command string by matching common
 * file-writing patterns. Returns all unique absolute paths found.
 *
 * Patterns matched:
 * - Shell redirects: > /path/to/file, >> /path/to/file
 * - Node.js: writeFileSync('/path'), writeFile('/path', ...)
 * - Variable assignments containing output paths
 * - Python: open('/path', 'w')
 * - Shell commands: tee /path, cp ... /path, mv ... /path
 */
/** Path prefix pattern: matches /, ~/, $HOME/, ${HOME}/ */
const ABS_PATH = String.raw`(?:\/[^\s"'>;|&\\]+|~\/[^\s"'>;|&\\]+|\$HOME\/[^\s"'>;|&\\]+|\$\{HOME\}\/[^\s"'>;|&\\]+)`;
/** Same but also allows shell variable chars inside the path (e.g. $ts in filename) */
const ABS_PATH_VARS = String.raw`(?:\/[^\s"'>;|&\\]+|~\/[^\s"'>;|&\\]+|\$HOME\/[^\s"'>;|\\]+|\$\{HOME\}\/[^\s"'>;|\\]+|\$\{process\.env\.HOME\}\/[^\s"'>;|\\]+)`;

function extractFilePathsFromBashCommand(command: string): string[] {
  const paths = new Set<string>();

  // Regex patterns for common file-writing operations
  const patterns: RegExp[] = [
    // Shell redirect: > /path, > ~/path, > $HOME/path, > "$HOME/path" (with optional quotes/escapes)
    new RegExp(String.raw`>>?\s+\\?["']?` + `(${ABS_PATH_VARS})` + String.raw`\\?["']?`, 'g'),
    // Node.js fs.writeFileSync or fs.writeFile with string path
    new RegExp(String.raw`writeFileSync\s*\(\s*["'\x60](` + ABS_PATH_VARS + String.raw`)["'\x60]`, 'g'),
    new RegExp(String.raw`writeFile\s*\(\s*["'\x60](` + ABS_PATH_VARS + String.raw`)["'\x60]`, 'g'),
    // Variable assignments containing output file paths
    new RegExp(
      String.raw`(?:outPath|outputPath|filePath|targetPath|savePath|destPath|dest|target|output)\s*=\s*["\x60'](` +
        ABS_PATH_VARS +
        String.raw`)["\x60']`,
      'g'
    ),
    // Python open() with write mode
    new RegExp(String.raw`open\s*\(\s*["'](` + ABS_PATH + String.raw`)["']\s*,\s*["'][wa]`, 'g'),
    // tee command
    new RegExp(String.raw`\btee\s+(?:-a\s+)?\\?["']?(` + ABS_PATH_VARS + String.raw`)\\?["']?`, 'g'),
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      const rawPath = match[1];
      if (rawPath) {
        paths.add(rawPath);
      }
    }
  }

  return Array.from(paths);
}

/**
 * Try to resolve shell variables in a bash-extracted path.
 *
 * - Replaces `$HOME/` and `${HOME}/` with `~/`
 * - For remaining `$var` references (e.g. `$ts`), attempts to find the
 *   resolved filename from the tool's output text or other messages
 *   by matching the known directory and extension.
 */
function resolveShellPath(rawPath: string, toolOutput?: string, allMessages?: TaskMessage[]): string {
  // Normalize $HOME / ${HOME} → ~
  const path = rawPath.replace(/^\$HOME\//, '~/').replace(/^\$\{HOME\}\//, '~/');

  // If no remaining shell variables, we're done
  if (!path.includes('$')) return path;

  // Build a regex from the path template: replace each $varname with (.+)
  // to match against output text and assistant messages
  const dir = path.substring(0, path.lastIndexOf('/') + 1); // e.g. "~/Downloads/"
  const ext = path.includes('.') ? path.substring(path.lastIndexOf('.')) : '';

  // Look for a resolved absolute path in toolOutput or assistant messages
  const candidates: string[] = [];
  if (toolOutput) candidates.push(toolOutput);
  if (allMessages) {
    for (const m of allMessages) {
      if (m.type === 'assistant' && m.content) candidates.push(m.content);
    }
  }

  // Normalize $HOME in dir for matching
  const dirForMatch = dir.replace(/^\$HOME\//, '~/').replace(/^\$\{HOME\}\//, '~/');

  for (const text of candidates) {
    // Match paths like ~/Downloads/20260210-021248-previous-response.md
    // that share the same directory prefix and extension
    const escaped = dirForMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped + String.raw`([^\s"'\x60:,)]+` + ext.replace('.', '\\.') + ')');
    const match = pattern.exec(text);
    if (match) {
      return dirForMatch + match[1];
    }
  }

  return path;
}

/**
 * Create an artifact entry from a file path string.
 */
function createArtifact(id: string, filePath: string, timestamp: string): Artifact {
  const fileName = filePath.split('/').pop() || filePath;
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  return { id, filePath, fileName, fileExt: ext, timestamp, operation: 'write' };
}

/**
 * Extract artifacts from task messages by filtering file-writing tool calls
 * and parsing their file paths. Deduplicates multiple writes to the same file.
 *
 * Tracks:
 * - write, edit, patch, multiedit tools from the OpenCode SDK (direct file path extraction)
 * - bash tool calls that contain file-writing patterns in their commands
 */
function extractArtifactsFromMessages(messages: TaskMessage[]): Artifact[] {
  const artifactMap = new Map<string, Artifact>(); // dedupe by path

  for (const m of messages) {
    if (m.type !== 'tool' || !m.toolName) continue;

    try {
      // Direct file-writing tools (write, edit, patch, multiedit)
      if (FILE_WRITING_TOOLS.has(m.toolName)) {
        const path = extractFilePathFromToolInput(m.toolInput);
        if (path) {
          artifactMap.set(path, createArtifact(m.id, path, m.timestamp));
        }
        continue;
      }

      // Bash tool: parse command string for file-writing patterns
      if (m.toolName === 'bash' && m.toolInput && typeof m.toolInput === 'object') {
        const input = m.toolInput as Record<string, unknown>;
        const command = typeof input.command === 'string' ? input.command : '';
        if (command) {
          const bashPaths = extractFilePathsFromBashCommand(command);
          for (const rawPath of bashPaths) {
            const resolved = resolveShellPath(rawPath, m.toolOutput, messages);
            artifactMap.set(resolved, createArtifact(m.id, resolved, m.timestamp));
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse artifact:', e);
    }
  }

  // Sort by timestamp descending (newest first)
  return Array.from(artifactMap.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
  permissionRequests: [],
  permissionRequest: null,
  approvedPatterns: new Set<string>(),
  todos: new Map<string, Todo[]>(),

  setTodos: (taskId: string, todos: Todo[]) => {
    set((state) => {
      const newTodos = new Map(state.todos);
      newTodos.set(taskId, todos);
      return { todos: newTodos };
    });
  },

  artifacts: new Map<string, Artifact[]>(),

  setArtifacts: (taskId: string, artifacts: Artifact[]) => {
    set((state) => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.set(taskId, artifacts);
      return { artifacts: newArtifacts };
    });
  },

  startupStage: null,
  startupStageTaskId: null,
  showSettings: false,
  setShowSettings: (show: boolean) => set({ showSettings: show }),
  showAbout: false,
  setShowAbout: (show: boolean) => set({ showAbout: show }),
  showCliMissing: false,
  setShowCliMissing: (show: boolean) => set({ showCliMissing: show }),
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
      // Pre-flight: verify OpenCode CLI is available
      const cliStatus = await api.checkOpencodeCli();
      if (!cliStatus.installed) {
        set({ showCliMissing: true, isLoading: false });
        return null;
      }

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
    // (startTask has its own CLI pre-flight check)
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
      // Pre-flight: verify OpenCode CLI is available before resuming
      const cliStatus = await api.checkOpencodeCli();
      if (!cliStatus.installed) {
        set({ showCliMissing: true, isLoading: false });
        return;
      }

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
    if (request === null) {
      // Clear the front of the queue (used after responding)
      const { permissionRequests } = get();
      const remaining = permissionRequests.slice(1);
      set({ permissionRequests: remaining, permissionRequest: remaining[0] ?? null });
    } else {
      // Legacy path: direct set (prefer enqueuePermissionRequest for new code)
      set({ permissionRequests: [request], permissionRequest: request });
    }
  },

  enqueuePermissionRequest: (request) => {
    const { approvedPatterns, permissionRequests } = get();

    // Auto-approve if ALL patterns in this request have already been approved
    const requestPatterns = request.patterns ?? [];
    const allPatternsApproved = requestPatterns.length > 0 && requestPatterns.every((p) => approvedPatterns.has(p));

    if (allPatternsApproved) {
      // Fire-and-forget auto-approval
      void api.respondToPermission({
        requestId: request.id,
        taskId: request.taskId,
        decision: 'allow',
        patterns: request.patterns,
      });
      return;
    }

    // Enqueue — show in modal if it's the first in the queue
    const updated = [...permissionRequests, request];
    set({ permissionRequests: updated, permissionRequest: updated[0] });
  },

  respondToPermission: async (response: PermissionResponse) => {
    const { permissionRequests, approvedPatterns, folderPermissions } = get();
    const current = permissionRequests[0];
    if (!current) return;

    // Attach patterns from the current permission request so Rust can persist adhoc grants
    const responseWithPatterns: PermissionResponse = {
      ...response,
      patterns: current.patterns,
    };

    void api.logEvent({
      level: 'info',
      message: 'UI permission response',
      context: { ...responseWithPatterns },
    });
    await api.respondToPermission(responseWithPatterns);

    // Track approved patterns for auto-approval of future duplicates
    if (response.decision === 'allow' && current.patterns) {
      const newApproved = new Set(approvedPatterns);
      for (const p of current.patterns) {
        newApproved.add(p);
      }
      set({ approvedPatterns: newApproved });
    }

    // When user allows a permission, add the target folder(s) to local state as adhoc grants.
    // For external_directory permissions, patterns are directory paths — use them directly.
    // For edit/file permissions, patterns are file paths — use the parent directory.
    if (response.decision === 'allow' && current.patterns) {
      const isDirectoryPermission = current.toolName === 'external_directory';
      for (const pattern of current.patterns) {
        let targetFolder: string;
        if (isDirectoryPermission) {
          targetFolder = pattern;
        } else {
          const lastSlash = pattern.lastIndexOf('/');
          if (lastSlash <= 0) continue;
          targetFolder = pattern.substring(0, lastSlash);
        }
        // Only add if not already in the list
        if (!folderPermissions.some((fp) => fp.folderPath === targetFolder)) {
          const newPerms: FolderPermission[] = [
            ...folderPermissions,
            { folderPath: targetFolder, accessLevel: 'read-write', source: 'adhoc' },
          ];
          set({ folderPermissions: newPerms });
        }
      }
    }

    // Pop the responded request from the queue
    const remaining = permissionRequests.slice(1);

    // Auto-approve any remaining requests whose patterns are now all approved
    const { approvedPatterns: latestApproved } = get();
    const stillPending: PermissionRequest[] = [];
    for (const req of remaining) {
      const reqPatterns = req.patterns ?? [];
      const allApproved = reqPatterns.length > 0 && reqPatterns.every((p) => latestApproved.has(p));
      if (allApproved) {
        void api.respondToPermission({
          requestId: req.id,
          taskId: req.taskId,
          decision: 'allow',
          patterns: req.patterns,
        });
      } else {
        stillPending.push(req);
      }
    }

    set({ permissionRequests: stillPending, permissionRequest: stillPending[0] ?? null });
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

    // For message events, include the message ID in the key so different messages
    // (and updates to the same message like pending→running→completed tool calls)
    // are not incorrectly deduplicated
    if (event.type === 'message' && event.message) {
      eventKey = `${event.taskId}:message:${event.message.id}`;
      // Include toolInput hash and toolOutput presence to allow updates to same
      // message (e.g. tool transitioning from pending to completed with output)
      const toolInputStr = event.message.toolInput ? JSON.stringify(event.message.toolInput) : '';
      const hasOutput = event.message.toolOutput ? `out:${event.message.toolOutput.length}` : 'no-out';
      normalizedContent = `${event.message.id}:${toolInputStr.length}:${hasOutput}`;
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

    // Extract artifacts after state update (only for message events)
    if (event.type === 'message' && get().currentTask?.id === event.taskId) {
      const currentTask = get().currentTask;
      if (currentTask) {
        const artifacts = extractArtifactsFromMessages(currentTask.messages);
        get().setArtifacts(currentTask.id, artifacts);
      }
    }
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

    // Extract artifacts from task messages
    if (task) {
      const artifacts = extractArtifactsFromMessages(task.messages);
      get().setArtifacts(task.id, artifacts);
    }
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
      permissionRequests: [],
      permissionRequest: null,
      approvedPatterns: new Set<string>(),
      startupStage: null,
      startupStageTaskId: null,
      showSettings: false,
      showAbout: false,
      showCliMissing: false,
      isLauncherOpen: false,
      folderPermissions: [],
      todos: new Map<string, Todo[]>(),
      artifacts: new Map<string, Artifact[]>(),
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
  });

  // Clear startup stage when task completes or errors
  void api.onTaskUpdate((event) => {
    const updateEvent = event as TaskUpdateEvent;
    if (updateEvent.type === 'complete' || updateEvent.type === 'error') {
      useTaskStore.getState().clearStartupStage(updateEvent.taskId);
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

  // Subscribe to todo updates
  void api.onTodoUpdated((event) => {
    useTaskStore.getState().setTodos(event.taskId, event.todos);
  });
}
