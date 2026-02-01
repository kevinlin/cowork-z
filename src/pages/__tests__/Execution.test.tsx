import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Task, TaskMessage, PartialMessage } from '@/shared';
import ExecutionPage from '../Execution';

// Mock the tauri-api module
vi.mock('@/lib/tauri-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri-api')>();
  return {
    ...actual,
    isRunningInTauri: () => false,
    getTask: vi.fn().mockResolvedValue(null),
    listProviders: vi.fn().mockResolvedValue([]),
    onTaskUpdate: vi.fn().mockResolvedValue(() => {}),
    onTaskUpdateBatch: vi.fn().mockResolvedValue(() => {}),
    onTaskProgress: vi.fn().mockResolvedValue(() => {}),
    onPermissionRequest: vi.fn().mockResolvedValue(() => {}),
    onTaskSummary: vi.fn().mockResolvedValue(() => {}),
    onTaskMessagePartial: vi.fn().mockResolvedValue(() => {}),
    onTaskMessageComplete: vi.fn().mockResolvedValue(() => {}),
    onDebugModeChange: vi.fn().mockResolvedValue(() => {}),
    onTaskStatusChange: vi.fn().mockResolvedValue(() => {}),
    onDebugLog: vi.fn().mockResolvedValue(() => {}),
    getDebugMode: vi.fn().mockResolvedValue(false),
    logEvent: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock the accomplish module
vi.mock('@/lib/accomplish', () => ({
  getAccomplish: vi.fn(() => ({
    openUrl: vi.fn(),
    copyToClipboard: vi.fn(),
  })),
}));

// Mock the taskStore
const mockTaskStore = {
  currentTask: null as Task | null,
  partialMessages: new Map<string, PartialMessage>(),
  isLoading: false,
  error: null,
  permissionRequest: null,
  setupProgress: null,
  startupStage: null,
  loadTaskById: vi.fn(),
  sendFollowUp: vi.fn(),
  cancelTask: vi.fn(),
  respondToPermission: vi.fn(),
  reset: vi.fn(),
};

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (selector?: (state: typeof mockTaskStore) => unknown) => {
    if (selector) {
      return selector(mockTaskStore);
    }
    return mockTaskStore;
  },
}));

// Mock hasAnyReadyProvider
vi.mock('@/shared', async () => {
  const actual = await vi.importActual('@/shared');
  return {
    ...actual,
    hasAnyReadyProvider: vi.fn().mockReturnValue(true),
  };
});

describe('Execution - Partial Message Rendering', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockTaskStore.currentTask = null;
    mockTaskStore.partialMessages = new Map();
  });

  const renderWithRouter = (taskId: string = 'task-123') => {
    return render(
      <MemoryRouter initialEntries={[`/execution/${taskId}`]}>
        <Routes>
          <Route path="/execution/:id" element={<ExecutionPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('should render completed messages only when no partials', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [
        { id: 'msg-1', type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
      ],
      status: 'completed',
      createdAt: '2024-01-01T00:00:00Z',
    };

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = new Map();

    renderWithRouter();

    // Verify both messages are rendered
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('should render partial messages with completed messages', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [
        { id: 'msg-1', type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ],
      status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const partialMessages = new Map<string, PartialMessage>([
      [
        'msg-2',
        {
          id: 'msg-2',
          type: 'assistant',
          textSoFar: 'Hello world',
          isStreaming: true,
          timestamp: '2024-01-01T00:00:01Z',
        },
      ],
    ]);

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = partialMessages;

    renderWithRouter();

    // Verify both messages are rendered
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('should sort messages by timestamp (completed + partial)', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [
        { id: 'msg-1', type: 'assistant', content: 'First', timestamp: '2024-01-01T00:00:02Z' },
        { id: 'msg-3', type: 'assistant', content: 'Third', timestamp: '2024-01-01T00:00:04Z' },
      ],
      status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const partialMessages = new Map<string, PartialMessage>([
      [
        'msg-2',
        {
          id: 'msg-2',
          type: 'assistant',
          textSoFar: 'Second',
          isStreaming: true,
          timestamp: '2024-01-01T00:00:03Z',
        },
      ],
      [
        'msg-4',
        {
          id: 'msg-4',
          type: 'assistant',
          textSoFar: 'Fourth',
          isStreaming: true,
          timestamp: '2024-01-01T00:00:05Z',
        },
      ],
    ]);

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = partialMessages;

    renderWithRouter();

    // Get all message bubbles
    const messages = screen.getAllByText(/First|Second|Third|Fourth/);
    
    // Verify order
    expect(messages[0].textContent).toContain('First');
    expect(messages[1].textContent).toContain('Second');
    expect(messages[2].textContent).toContain('Third');
    expect(messages[3].textContent).toContain('Fourth');
  });

  it('should filter out completed messages that have corresponding partials', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [
        { id: 'msg-1', type: 'assistant', content: 'Old version', timestamp: '2024-01-01T00:00:01Z' },
      ],
      status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
    };

    // Partial with same ID as completed message
    const partialMessages = new Map<string, PartialMessage>([
      [
        'msg-1',
        {
          id: 'msg-1',
          type: 'assistant',
          textSoFar: 'New streaming version',
          isStreaming: true,
          timestamp: '2024-01-01T00:00:01Z',
        },
      ],
    ]);

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = partialMessages;

    renderWithRouter();

    // Should only show the partial version, not the completed one
    expect(screen.getByText('New streaming version')).toBeInTheDocument();
    expect(screen.queryByText('Old version')).not.toBeInTheDocument();
  });

  it('should handle empty messages array', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [],
      status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
    };

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = new Map();

    renderWithRouter();

    // Should render without errors
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });

  it('should handle task with only partial messages', () => {
    const task: Task = {
      id: 'task-123',
      prompt: 'Test task',
      messages: [],
      status: 'running',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const partialMessages = new Map<string, PartialMessage>([
      [
        'msg-1',
        {
          id: 'msg-1',
          type: 'assistant',
          textSoFar: 'Streaming only',
          isStreaming: true,
          timestamp: '2024-01-01T00:00:01Z',
        },
      ],
    ]);

    mockTaskStore.currentTask = task;
    mockTaskStore.partialMessages = partialMessages;

    renderWithRouter();

    expect(screen.getByText('Streaming only')).toBeInTheDocument();
  });
});
