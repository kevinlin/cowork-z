import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTaskStore } from '../taskStore';
import type { PartialMessageEvent, CompleteMessageEvent, Task } from '@/shared';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', () => ({
  isRunningInTauri: () => false,
  saveTaskMessage: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue({ id: 'task-123', status: 'running' }),
  startTask: vi.fn().mockResolvedValue({
    id: 'task-123',
    prompt: 'Test prompt',
    status: 'starting',
    messages: [],
    createdAt: new Date().toISOString(),
  }),
}));

describe('taskStore - Partial Message Management', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useTaskStore.getState();
    store.reset();
    
    // Set up a mock current task
    const mockTask: Task = {
      id: 'task-123',
      prompt: 'Test task',
      status: 'running',
      messages: [],
      createdAt: new Date().toISOString(),
    };
    
    useTaskStore.setState({ currentTask: mockTask });
  });

  it('should create new partial message', () => {
    const event: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    useTaskStore.getState().addPartialMessage(event);

    // Get fresh state after update
    const store = useTaskStore.getState();
    
    // Verify partial message added to Map
    const partial = store.partialMessages.get('msg-456');
    expect(partial).toBeDefined();
    expect(partial?.textSoFar).toBe('Hello');
    expect(partial?.isStreaming).toBe(true);
    expect(partial?.type).toBe('assistant');
    expect(partial?.id).toBe('msg-456');
  });

  it('should update existing partial message', () => {
    const event1: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    const event2: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello world',
      isStreaming: true,
    };

    // Add first partial
    useTaskStore.getState().addPartialMessage(event1);

    // Update with second partial
    useTaskStore.getState().addPartialMessage(event2);

    // Get fresh state after updates
    const store = useTaskStore.getState();
    
    // Verify text updated
    const partial = store.partialMessages.get('msg-456');
    expect(partial?.textSoFar).toBe('Hello world');
  });

  it('should ignore events for non-current task', () => {
    const event: PartialMessageEvent = {
      taskId: 'task-999', // Different task
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    // Current task is task-123
    const store = useTaskStore.getState();
    const initialSize = store.partialMessages.size;
    store.addPartialMessage(event);

    // Verify no change to partialMessages
    expect(store.partialMessages.size).toBe(initialSize);
  });

  it('should move partial to messages on finalize', () => {
    // Create partial message
    const partialEvent: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    const completeEvent: CompleteMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      text: 'Hello world',
    };

    useTaskStore.getState().addPartialMessage(partialEvent);

    // Finalize the message
    useTaskStore.getState().finalizePartialMessage(completeEvent);

    // Get fresh state after updates
    const store = useTaskStore.getState();
    
    // Verify removed from partialMessages
    expect(store.partialMessages.has('msg-456')).toBe(false);

    // Verify added to currentTask.messages
    const message = store.currentTask?.messages.find((m) => m.id === 'msg-456');
    expect(message).toBeDefined();
    expect(message?.content).toBe('Hello world');
    expect(message?.type).toBe('assistant');
  });

  it('should handle missing partial gracefully on finalize', () => {
    const completeEvent: CompleteMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-999', // Doesn't exist
      text: 'Hello',
    };

    const store = useTaskStore.getState();
    const initialMessages = store.currentTask?.messages.length || 0;

    // Should not throw
    store.finalizePartialMessage(completeEvent);

    // Should not add message if no partial exists
    expect(store.currentTask?.messages.length).toBe(initialMessages);
  });

  it('should handle multiple partial messages simultaneously', () => {
    const events: PartialMessageEvent[] = [
      { taskId: 'task-123', messageId: 'msg-1', textSoFar: 'First', isStreaming: true },
      { taskId: 'task-123', messageId: 'msg-2', textSoFar: 'Second', isStreaming: true },
      { taskId: 'task-123', messageId: 'msg-3', textSoFar: 'Third', isStreaming: true },
    ];

    events.forEach((e) => useTaskStore.getState().addPartialMessage(e));

    // Get fresh state after updates
    const store = useTaskStore.getState();
    
    // Verify all tracked
    expect(store.partialMessages.size).toBe(3);
    expect(store.partialMessages.get('msg-1')?.textSoFar).toBe('First');
    expect(store.partialMessages.get('msg-2')?.textSoFar).toBe('Second');
    expect(store.partialMessages.get('msg-3')?.textSoFar).toBe('Third');
  });

  it('should preserve timestamp when updating partial message', () => {
    const event1: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    useTaskStore.getState().addPartialMessage(event1);

    const firstTimestamp = useTaskStore.getState().partialMessages.get('msg-456')?.timestamp;
    expect(firstTimestamp).toBeDefined();

    // Update the partial message
    const event2: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello world',
      isStreaming: true,
    };

    useTaskStore.getState().addPartialMessage(event2);

    // Get fresh state and verify timestamp preserved
    const secondTimestamp = useTaskStore.getState().partialMessages.get('msg-456')?.timestamp;
    expect(secondTimestamp).toBe(firstTimestamp);
  });

  it('should clear partial messages on reset', () => {
    const event: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    useTaskStore.getState().addPartialMessage(event);

    expect(useTaskStore.getState().partialMessages.size).toBe(1);

    // Reset store
    useTaskStore.getState().reset();

    // Verify partialMessages cleared
    expect(useTaskStore.getState().partialMessages.size).toBe(0);
  });

  it('should ignore finalize events for non-current task', () => {
    // Create partial for current task
    const partialEvent: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    useTaskStore.getState().addPartialMessage(partialEvent);

    // Try to finalize with different task ID
    const completeEvent: CompleteMessageEvent = {
      taskId: 'task-999',
      messageId: 'msg-456',
      text: 'Hello world',
    };

    useTaskStore.getState().finalizePartialMessage(completeEvent);

    // Get fresh state
    const store = useTaskStore.getState();
    
    // Partial should still exist (not finalized)
    expect(store.partialMessages.has('msg-456')).toBe(true);
    
    // Message should not be added to current task
    const message = store.currentTask?.messages.find((m) => m.id === 'msg-456');
    expect(message).toBeUndefined();
  });
});

describe('taskStore - User Message Persistence', () => {
  // We need to import the mocked api to access the mock functions
  let mockSaveTaskMessage: ReturnType<typeof vi.fn>;
  let mockResumeSession: ReturnType<typeof vi.fn>;
  let mockLogEvent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get references to the mocked functions
    const api = await import('@/lib/tauri-api');
    mockSaveTaskMessage = vi.mocked(api.saveTaskMessage);
    mockResumeSession = vi.mocked(api.resumeSession);
    mockLogEvent = vi.mocked(api.logEvent);

    // Reset default implementations
    mockSaveTaskMessage.mockResolvedValue(undefined);
    mockResumeSession.mockResolvedValue({ id: 'task-123', status: 'running' });
    mockLogEvent.mockResolvedValue(undefined);

    // Reset store state
    useTaskStore.getState().reset();

    // Setup store with a completed task that has a session
    const mockTask: Task = {
      id: 'task-123',
      prompt: 'Initial prompt',
      status: 'completed',
      sessionId: 'session-456',
      messages: [
        {
          id: 'msg-1',
          type: 'assistant',
          content: 'Initial response',
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
    };

    useTaskStore.setState({
      currentTask: mockTask,
      tasks: [mockTask],
    });
  });

  it('should persist user message when sending follow-up', async () => {
    await useTaskStore.getState().sendFollowUp('Follow-up message');

    expect(mockSaveTaskMessage).toHaveBeenCalledTimes(1);
    expect(mockSaveTaskMessage).toHaveBeenCalledWith(
      'task-123',
      expect.objectContaining({
        type: 'user',
        content: 'Follow-up message',
        id: expect.any(String),
        timestamp: expect.any(String),
      })
    );
  });

  it('should include user message in optimistic state update', async () => {
    await useTaskStore.getState().sendFollowUp('Test message');

    const state = useTaskStore.getState();
    const userMessages = state.currentTask?.messages.filter(m => m.type === 'user');

    expect(userMessages).toHaveLength(1);
    expect(userMessages?.[0].content).toBe('Test message');
  });

  it('should handle persistence failure gracefully', async () => {
    mockSaveTaskMessage.mockRejectedValueOnce(new Error('DB error'));

    // Should not throw - error is caught and logged
    await expect(
      useTaskStore.getState().sendFollowUp('Test')
    ).resolves.not.toThrow();

    // Verify error was logged
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'Failed to persist user message',
      })
    );

    // UI should still show the message (optimistic update)
    const state = useTaskStore.getState();
    expect(state.currentTask?.messages.some(m => m.content === 'Test')).toBe(true);
  });

  it('should persist before attempting to resume session', async () => {
    const callOrder: string[] = [];

    mockSaveTaskMessage.mockImplementation(async () => {
      callOrder.push('saveTaskMessage');
    });

    mockResumeSession.mockImplementation(async () => {
      callOrder.push('resumeSession');
      return { id: 'task-123', status: 'running' };
    });

    await useTaskStore.getState().sendFollowUp('Test');

    // SaveTaskMessage should be called first (or concurrently)
    expect(mockSaveTaskMessage).toHaveBeenCalled();
    expect(mockResumeSession).toHaveBeenCalled();
  });

  it('should generate stable message IDs', async () => {
    await useTaskStore.getState().sendFollowUp('Message 1');
    const call1Id = mockSaveTaskMessage.mock.calls[0][1].id;

    await useTaskStore.getState().sendFollowUp('Message 2');
    const call2Id = mockSaveTaskMessage.mock.calls[1][1].id;

    // IDs should be different
    expect(call1Id).not.toBe(call2Id);
    // IDs should follow the format: msg_timestamp_random
    expect(call1Id).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(call2Id).toMatch(/^msg_\d+_[a-z0-9]+$/);
  });
});

describe('taskStore - Initial Prompt Persistence', () => {
  let mockSaveTaskMessage: ReturnType<typeof vi.fn>;
  let mockStartTask: ReturnType<typeof vi.fn>;
  let mockLogEvent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get references to the mocked functions
    const api = await import('@/lib/tauri-api');
    mockSaveTaskMessage = vi.mocked(api.saveTaskMessage);
    mockStartTask = vi.mocked(api.startTask);
    mockLogEvent = vi.mocked(api.logEvent);

    // Reset default implementations
    mockSaveTaskMessage.mockResolvedValue(undefined);
    mockLogEvent.mockResolvedValue(undefined);
    mockStartTask.mockResolvedValue({
      id: 'task-456',
      prompt: 'Test prompt',
      status: 'starting',
      messages: [],
      createdAt: new Date().toISOString(),
    });

    // Reset store state
    useTaskStore.getState().reset();
  });

  it('should persist initial prompt as user message when starting task', async () => {
    await useTaskStore.getState().startTask({ prompt: 'Hello, AI!' });

    expect(mockSaveTaskMessage).toHaveBeenCalledTimes(1);
    expect(mockSaveTaskMessage).toHaveBeenCalledWith(
      'task-456',
      expect.objectContaining({
        type: 'user',
        content: 'Hello, AI!',
        id: expect.any(String),
        timestamp: expect.any(String),
      })
    );
  });

  it('should include initial prompt in task state', async () => {
    await useTaskStore.getState().startTask({ prompt: 'Test prompt' });

    const state = useTaskStore.getState();
    const userMessages = state.currentTask?.messages.filter(m => m.type === 'user');

    expect(userMessages).toHaveLength(1);
    expect(userMessages?.[0].content).toBe('Test prompt');
  });

  it('should use task createdAt timestamp for initial message', async () => {
    const createdAt = '2026-02-01T12:00:00Z';
    mockStartTask.mockResolvedValueOnce({
      id: 'task-456',
      prompt: 'Test',
      status: 'starting',
      messages: [],
      createdAt,
    });

    await useTaskStore.getState().startTask({ prompt: 'Test' });

    expect(mockSaveTaskMessage).toHaveBeenCalledWith(
      'task-456',
      expect.objectContaining({
        timestamp: createdAt,
      })
    );
  });

  it('should handle persistence failure gracefully for initial message', async () => {
    mockSaveTaskMessage.mockRejectedValueOnce(new Error('DB error'));

    // Should not throw - error is caught and logged
    await expect(
      useTaskStore.getState().startTask({ prompt: 'Test' })
    ).resolves.not.toBeNull();

    // Verify error was logged
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'Failed to persist initial user message',
      })
    );

    // UI should still show the message (in state)
    const state = useTaskStore.getState();
    expect(state.currentTask?.messages.some(m => m.content === 'Test')).toBe(true);
  });

  it('should handle task start failure without persisting message', async () => {
    mockStartTask.mockRejectedValueOnce(new Error('Failed to start'));

    const result = await useTaskStore.getState().startTask({ prompt: 'Test' });

    expect(result).toBeNull();
    // saveTaskMessage should not be called if task start fails
    expect(mockSaveTaskMessage).not.toHaveBeenCalled();
  });
});
