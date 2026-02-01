/**
 * TaskManager - Manages multiple concurrent OpenCode CLI task executions
 *
 * Each task gets its own OpenCodeAdapter instance with isolated PTY process,
 * state, and event handling.
 */

import { OpenCodeAdapter, AdapterConfig } from './adapter';
import type {
  TaskConfig,
  TaskResult,
  TaskProgress,
  OpenCodeMessage,
  PermissionRequest,
  TaskCallbacks,
  ApiKeys,
} from './types';

/**
 * Internal representation of a managed task
 */
interface ManagedTask {
  taskId: string;
  adapter: OpenCodeAdapter;
  callbacks: TaskCallbacks;
  cleanup: () => void;
  createdAt: Date;
}

/**
 * Default maximum number of concurrent tasks
 */
const DEFAULT_MAX_CONCURRENT_TASKS = 10;

/**
 * TaskManager manages OpenCode CLI task executions with parallel execution
 */
export class TaskManager {
  private activeTasks: Map<string, ManagedTask> = new Map();
  private maxConcurrentTasks: number;

  constructor(options?: { maxConcurrentTasks?: number }) {
    this.maxConcurrentTasks = options?.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS;
  }

  /**
   * Start a new task
   */
  async startTask(config: TaskConfig & { apiKeys?: ApiKeys }, callbacks: TaskCallbacks): Promise<void> {
    const taskId = config.taskId;

    if (this.activeTasks.has(taskId)) {
      throw new Error(`Task ${taskId} is already running`);
    }

    if (this.activeTasks.size >= this.maxConcurrentTasks) {
      throw new Error(`Maximum concurrent tasks (${this.maxConcurrentTasks}) reached`);
    }

    // Create a new adapter instance
    const adapter = new OpenCodeAdapter(taskId);

    // Wire up event listeners
    const onMessage = (message: OpenCodeMessage) => {
      callbacks.onMessage(message);
    };

    const onProgress = (progress: TaskProgress) => {
      callbacks.onProgress(progress);
    };

    const onPermissionRequest = (request: PermissionRequest) => {
      callbacks.onPermissionRequest(request);
    };

    const onComplete = (result: TaskResult) => {
      callbacks.onComplete(result);
      this.cleanupTask(taskId);
    };

    const onError = (error: Error) => {
      callbacks.onError(error.message);
      this.cleanupTask(taskId);
    };

    // Attach listeners
    adapter.on('message', onMessage);
    adapter.on('progress', onProgress);
    adapter.on('permission-request', onPermissionRequest);
    adapter.on('complete', onComplete);
    adapter.on('error', onError);

    // Create cleanup function
    const cleanup = () => {
      adapter.off('message', onMessage);
      adapter.off('progress', onProgress);
      adapter.off('permission-request', onPermissionRequest);
      adapter.off('complete', onComplete);
      adapter.off('error', onError);
      adapter.dispose();
    };

    // Register the managed task
    const managedTask: ManagedTask = {
      taskId,
      adapter,
      callbacks,
      cleanup,
      createdAt: new Date(),
    };
    this.activeTasks.set(taskId, managedTask);

    // Start the adapter
    const adapterConfig: AdapterConfig = {
      ...config,
      apiKeys: config.apiKeys,
    };

    try {
      await adapter.startTask(adapterConfig);
    } catch (error) {
      this.cleanupTask(taskId);
      throw error;
    }
  }

  /**
   * Cancel a specific task
   */
  async cancelTask(taskId: string): Promise<void> {
    const managedTask = this.activeTasks.get(taskId);
    if (!managedTask) {
      return;
    }

    try {
      await managedTask.adapter.cancelTask();
    } finally {
      this.cleanupTask(taskId);
    }
  }

  /**
   * Interrupt a running task (graceful Ctrl+C)
   */
  async interruptTask(taskId: string): Promise<void> {
    const managedTask = this.activeTasks.get(taskId);
    if (!managedTask) {
      return;
    }

    await managedTask.adapter.interruptTask();
  }

  /**
   * Send a response to a specific task's PTY
   */
  async sendResponse(taskId: string, response: string): Promise<void> {
    const managedTask = this.activeTasks.get(taskId);
    if (!managedTask) {
      throw new Error(`Task ${taskId} not found or not active`);
    }

    await managedTask.adapter.sendResponse(response);
  }

  /**
   * Get the session ID for a specific task
   */
  getSessionId(taskId: string): string | null {
    const managedTask = this.activeTasks.get(taskId);
    return managedTask?.adapter.getSessionId() ?? null;
  }

  /**
   * Check if a task is active
   */
  hasActiveTask(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }

  /**
   * Get the number of active tasks
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Get all active task IDs
   */
  getActiveTaskIds(): string[] {
    return Array.from(this.activeTasks.keys());
  }

  /**
   * Cleanup a specific task
   */
  private cleanupTask(taskId: string): void {
    const managedTask = this.activeTasks.get(taskId);
    if (managedTask) {
      managedTask.cleanup();
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * Dispose all tasks and cleanup resources
   */
  dispose(): void {
    for (const [taskId, managedTask] of this.activeTasks) {
      try {
        managedTask.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.activeTasks.clear();
  }
}

// Singleton instance
let taskManagerInstance: TaskManager | null = null;

/**
 * Get the global TaskManager instance
 */
export function getTaskManager(): TaskManager {
  if (!taskManagerInstance) {
    taskManagerInstance = new TaskManager();
  }
  return taskManagerInstance;
}

/**
 * Dispose the global TaskManager instance
 */
export function disposeTaskManager(): void {
  if (taskManagerInstance) {
    taskManagerInstance.dispose();
    taskManagerInstance = null;
  }
}
