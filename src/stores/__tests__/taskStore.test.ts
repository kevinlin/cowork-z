import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTaskStore } from '../taskStore';
import type { PartialMessageEvent, CompleteMessageEvent, Task } from '@/shared';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', () => ({
  isRunningInTauri: () => false,
  saveTaskMessage: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn().mockResolvedValue(undefined),
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
