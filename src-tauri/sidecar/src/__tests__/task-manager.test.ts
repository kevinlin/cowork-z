import { TaskManager } from '../task-manager';
import type { CompleteMessageUpdate, PartialMessageUpdate, TaskCallbacks, TaskConfig, TaskProgress, TaskResult } from '../types';

// Mock the adapter module
jest.mock('../adapter', () => {
  const EventEmitter = require('events');

  class MockOpenCodeAdapter extends EventEmitter {
    private taskId: string | null = null;
    private sessionId: string | null = null;
    private disposed = false;

    constructor(taskId?: string) {
      super();
      this.taskId = taskId || null;
    }

    async startTask(config: any): Promise<void> {
      this.taskId = config.taskId;
      // Use provided sessionId or generate a mock one
      this.sessionId = config.sessionId || 'mock-session-id';
      // Simulate async start
      await Promise.resolve();
    }

    async cancelTask(): Promise<void> {
      await Promise.resolve();
    }

    async interruptTask(): Promise<void> {
      await Promise.resolve();
    }

    async sendResponse(response: string): Promise<void> {
      await Promise.resolve();
    }

    getSessionId(): string | null {
      return this.sessionId;
    }

    getTaskId(): string | null {
      return this.taskId;
    }

    isAdapterDisposed(): boolean {
      return this.disposed;
    }

    dispose(): void {
      this.disposed = true;
      this.removeAllListeners();
    }

    // Helper for tests to simulate events
    simulatePartialMessage(update: PartialMessageUpdate): void {
      this.emit('message-partial', update);
    }

    simulateCompleteMessage(update: CompleteMessageUpdate): void {
      this.emit('message-complete', update);
    }

    simulateProgress(progress: TaskProgress): void {
      this.emit('progress', progress);
    }

    simulateComplete(result: TaskResult): void {
      this.emit('complete', result);
    }

    simulateError(error: Error): void {
      this.emit('error', error);
    }
  }

  return {
    OpenCodeAdapter: MockOpenCodeAdapter,
    createAdapter: (taskId?: string) => new MockOpenCodeAdapter(taskId),
  };
});

describe('TaskManager - Partial Message Handling', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
  });

  afterEach(() => {
    taskManager.dispose();
  });

  test('should forward message_partial events via callbacks', async () => {
    const partialEvent: PartialMessageUpdate = {
      messageId: 'msg-123',
      textSoFar: 'Hello world',
      isStreaming: true,
    };

    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onMessagePartial: jest.fn(),
      onMessageComplete: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const config: TaskConfig = {
      taskId: 'task-123',
      prompt: 'Test task',
    };

    await taskManager.startTask(config, callbacks);

    // Get the adapter and simulate partial message
    const adapter = (taskManager as any).activeTasks.get('task-123')?.adapter;
    expect(adapter).toBeDefined();

    adapter.simulatePartialMessage(partialEvent);

    // Verify callback was called
    expect(callbacks.onMessagePartial).toHaveBeenCalledWith(partialEvent);
  });

  test('should forward message_complete events via callbacks', async () => {
    const completeEvent: CompleteMessageUpdate = {
      messageId: 'msg-123',
      text: 'Complete message',
    };

    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onMessagePartial: jest.fn(),
      onMessageComplete: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const config: TaskConfig = {
      taskId: 'task-123',
      prompt: 'Test task',
    };

    await taskManager.startTask(config, callbacks);

    // Get the adapter and simulate complete message
    const adapter = (taskManager as any).activeTasks.get('task-123')?.adapter;
    adapter.simulateCompleteMessage(completeEvent);

    // Verify callback was called
    expect(callbacks.onMessageComplete).toHaveBeenCalledWith(completeEvent);
  });

  test('should track partial messages per task', async () => {
    const callbacks1: TaskCallbacks = {
      onMessage: jest.fn(),
      onMessagePartial: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const callbacks2: TaskCallbacks = {
      onMessage: jest.fn(),
      onMessagePartial: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    // Start two tasks
    await taskManager.startTask({ taskId: 'task-1', prompt: 'Task 1' }, callbacks1);
    await taskManager.startTask({ taskId: 'task-2', prompt: 'Task 2' }, callbacks2);

    // Simulate partial for task 1
    const adapter1 = (taskManager as any).activeTasks.get('task-1')?.adapter;
    adapter1.simulatePartialMessage({
      messageId: 'msg-1',
      textSoFar: 'Task 1 text',
      isStreaming: true,
    });

    // Simulate partial for task 2
    const adapter2 = (taskManager as any).activeTasks.get('task-2')?.adapter;
    adapter2.simulatePartialMessage({
      messageId: 'msg-2',
      textSoFar: 'Task 2 text',
      isStreaming: true,
    });

    // Verify both callbacks were called with correct data
    expect(callbacks1.onMessagePartial).toHaveBeenCalledWith({
      messageId: 'msg-1',
      textSoFar: 'Task 1 text',
      isStreaming: true,
    });

    expect(callbacks2.onMessagePartial).toHaveBeenCalledWith({
      messageId: 'msg-2',
      textSoFar: 'Task 2 text',
      isStreaming: true,
    });
  });

  test('should clean up task on completion', async () => {
    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const config: TaskConfig = {
      taskId: 'task-123',
      prompt: 'Test task',
    };

    await taskManager.startTask(config, callbacks);

    // Verify task is active
    expect(taskManager.hasActiveTask('task-123')).toBe(true);
    expect(taskManager.getActiveTaskCount()).toBe(1);

    // Simulate completion
    const adapter = (taskManager as any).activeTasks.get('task-123')?.adapter;
    adapter.simulateComplete({ status: 'success' });

    // Verify task was cleaned up
    expect(taskManager.hasActiveTask('task-123')).toBe(false);
    expect(taskManager.getActiveTaskCount()).toBe(0);
  });

  test('should handle multiple concurrent tasks', async () => {
    const callbacks1: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const callbacks2: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const callbacks3: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    // Start 3 tasks
    await taskManager.startTask({ taskId: 'task-1', prompt: 'Task 1' }, callbacks1);
    await taskManager.startTask({ taskId: 'task-2', prompt: 'Task 2' }, callbacks2);
    await taskManager.startTask({ taskId: 'task-3', prompt: 'Task 3' }, callbacks3);

    // Verify all tasks are active
    expect(taskManager.getActiveTaskCount()).toBe(3);
    expect(taskManager.hasActiveTask('task-1')).toBe(true);
    expect(taskManager.hasActiveTask('task-2')).toBe(true);
    expect(taskManager.hasActiveTask('task-3')).toBe(true);

    // Complete task 2
    const adapter2 = (taskManager as any).activeTasks.get('task-2')?.adapter;
    adapter2.simulateComplete({ status: 'success' });

    // Verify task 2 is cleaned up, others remain
    expect(taskManager.getActiveTaskCount()).toBe(2);
    expect(taskManager.hasActiveTask('task-1')).toBe(true);
    expect(taskManager.hasActiveTask('task-2')).toBe(false);
    expect(taskManager.hasActiveTask('task-3')).toBe(true);
  });

  test('should prevent duplicate task IDs', async () => {
    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    const config: TaskConfig = {
      taskId: 'task-123',
      prompt: 'Test task',
    };

    await taskManager.startTask(config, callbacks);

    // Try to start same task ID again
    await expect(taskManager.startTask(config, callbacks)).rejects.toThrow('Task task-123 is already running');
  });

  test('should respect max concurrent tasks limit', async () => {
    const limitedManager = new TaskManager({ maxConcurrentTasks: 2 });

    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    // Start 2 tasks (at limit)
    await limitedManager.startTask({ taskId: 'task-1', prompt: 'Task 1' }, callbacks);
    await limitedManager.startTask({ taskId: 'task-2', prompt: 'Task 2' }, callbacks);

    // Try to start a third task
    await expect(limitedManager.startTask({ taskId: 'task-3', prompt: 'Task 3' }, callbacks)).rejects.toThrow(
      'Maximum concurrent tasks (2) reached'
    );

    limitedManager.dispose();
  });

  test('should get session ID for active task', async () => {
    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    await taskManager.startTask({ taskId: 'task-123', prompt: 'Test', sessionId: 'session-456' }, callbacks);

    const sessionId = taskManager.getSessionId('task-123');
    // Mock adapter returns the sessionId from config if provided
    expect(sessionId).toBe('session-456');
  });

  test('should return null for non-existent task session ID', () => {
    const sessionId = taskManager.getSessionId('non-existent');
    expect(sessionId).toBeNull();
  });

  test('should cancel task', async () => {
    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    await taskManager.startTask({ taskId: 'task-123', prompt: 'Test' }, callbacks);

    expect(taskManager.hasActiveTask('task-123')).toBe(true);

    await taskManager.cancelTask('task-123');

    expect(taskManager.hasActiveTask('task-123')).toBe(false);
  });

  test('should handle cancel for non-existent task gracefully', async () => {
    await expect(taskManager.cancelTask('non-existent')).resolves.not.toThrow();
  });

  test('should dispose all tasks', async () => {
    const callbacks: TaskCallbacks = {
      onMessage: jest.fn(),
      onProgress: jest.fn(),
      onPermissionRequest: jest.fn(),
      onComplete: jest.fn(),
      onError: jest.fn(),
    };

    // Start multiple tasks
    await taskManager.startTask({ taskId: 'task-1', prompt: 'Task 1' }, callbacks);
    await taskManager.startTask({ taskId: 'task-2', prompt: 'Task 2' }, callbacks);
    await taskManager.startTask({ taskId: 'task-3', prompt: 'Task 3' }, callbacks);

    expect(taskManager.getActiveTaskCount()).toBe(3);

    // Dispose all
    taskManager.dispose();

    expect(taskManager.getActiveTaskCount()).toBe(0);
  });
});
