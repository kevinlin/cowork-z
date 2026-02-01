# Streaming Chat Response Implementation Plan

## Problem Statement

Currently, chat responses in Cowork Z don't support real-time streaming:
- Messages appear all at once when OpenCode completes processing
- When switching between active tasks, partial responses aren't preserved
- The existing `StreamingText` component only animates complete messages (visual-only streaming)

## Requirements

1. **Real-time streaming**: Display text incrementally as OpenCode emits multiple `text` events
2. **Task switching support**:
   - When switching away: preserve partial response state
   - When switching back: display history + accumulated partial response + resume streaming
3. **Performance**: Throttle updates to prevent excessive re-renders

## Solution Overview

Implement a **partial message tracking system** that accumulates text chunks across multiple OpenCode text events and persists state during task switches.

### Key Insight
OpenCode CLI emits **multiple text events per response**, making true streaming possible. We'll:
- Track partial messages separately from complete messages
- Accumulate text chunks in the sidecar layer
- Emit partial updates to the frontend (throttled)
- Finalize partial messages when OpenCode sends `step_finish`
- Preserve partial state when switching tasks

### Architecture Flow

```
OpenCode CLI (multiple text events)
  ↓
stream-parser.ts (parse NDJSON)
  ↓
adapter.ts (NEW: accumulate text chunks, emit partial updates)
  ↓
task-manager.ts (NEW: track partial state per task)
  ↓
Sidecar IPC (NEW: task_message_partial events)
  ↓
Rust backend (forward partial events)
  ↓
Frontend taskStore (NEW: partialMessages Map)
  ↓
Execution.tsx (render partial + complete messages)
```

## Implementation Steps

### Phase 1: Sidecar - Message Accumulation

**File: `src-tauri/sidecar/src/adapter.ts`**

1. Add message accumulator tracking:
   ```typescript
   interface MessageAccumulator {
     messageId: string;
     sessionId: string;
     textChunks: string[];
     lastUpdate: number;
     isComplete: boolean;
   }

   private messageAccumulators: Map<string, MessageAccumulator> = new Map();
   ```

2. Modify `handleMessage()` for `text` events (line 406-411):
   - Get or create accumulator for `message.part.messageID`
   - Append `message.part.text` to accumulator
   - Emit partial update (throttled to 100ms)

3. On `step_finish` event:
   - Finalize all accumulators for the session
   - Emit complete message event
   - Clear accumulators

4. Add new event emitters:
   - `this.emit('message_partial', {...})` - for incremental updates
   - `this.emit('message_complete', {...})` - for finalized messages

**File: `src-tauri/sidecar/src/task-manager.ts`**

1. Add partial message state tracking (after line 39):
   ```typescript
   private partialMessages: Map<string, PartialMessageState> = new Map();
   ```

2. Subscribe to adapter's new events:
   - `adapter.on('message_partial', ...)` - forward via IPC
   - `adapter.on('message_complete', ...)` - forward via IPC

3. Add IPC message types:
   - `task_message_partial` - sends accumulated text
   - `task_message_complete` - sends final message

4. Implement throttling for partial updates (100ms minimum)

**File: `src-tauri/sidecar/src/types.ts`**

Add new IPC message types:
```typescript
export type SidecarOutputMessage =
  | { type: 'task_message_partial'; taskId: string; payload: PartialMessageUpdate }
  | { type: 'task_message_complete'; taskId: string; payload: CompleteMessageUpdate }
  | ... existing types;

export interface PartialMessageUpdate {
  messageId: string;
  textSoFar: string;
  isStreaming: boolean;
}

export interface CompleteMessageUpdate {
  messageId: string;
  text: string;
}
```

### Phase 2: Rust Backend - Event Forwarding

**File: `src-tauri/src/sidecar.rs`**

Add event handling in `handle_sidecar_event()` (around line 260):
```rust
"task_message_partial" => {
    app.emit("task:message:partial", payload)?;
}
"task_message_complete" => {
    app.emit("task:message:complete", payload)?;
}
```

### Phase 3: Frontend - State Management

**File: `src/shared/types/task.ts`**

Add new types:
```typescript
export interface PartialMessage {
  id: string;
  type: 'assistant';
  textSoFar: string;
  isStreaming: boolean;
  timestamp: string;
}

export interface PartialMessageEvent {
  taskId: string;
  messageId: string;
  textSoFar: string;
  isStreaming: boolean;
}

export interface CompleteMessageEvent {
  taskId: string;
  messageId: string;
  text: string;
}
```

**File: `src/lib/tauri-api.ts`**

Add event listeners (around line 640):
```typescript
export async function onTaskMessagePartial(
  callback: (event: PartialMessageEvent) => void
): Promise<UnlistenFn> {
  return listen<PartialMessageEvent>('task:message:partial', (e) => callback(e.payload));
}

export async function onTaskMessageComplete(
  callback: (event: CompleteMessageEvent) => void
): Promise<UnlistenFn> {
  return listen<CompleteMessageEvent>('task:message:complete', (e) => callback(e.payload));
}
```

**File: `src/stores/taskStore.ts`**

1. Add partial message state (around line 39):
   ```typescript
   partialMessages: Map<string, PartialMessage>;
   ```

2. Add state actions:
   ```typescript
   addPartialMessage: (event: PartialMessageEvent) => void;
   finalizePartialMessage: (event: CompleteMessageEvent) => void;
   ```

3. Implement `addPartialMessage` (around line 345):
   - Check if event is for current task
   - Update or create partial message in Map
   - DO NOT trigger database writes for partials

4. Implement `finalizePartialMessage`:
   - Convert partial message to complete TaskMessage
   - Add to `currentTask.messages` array
   - Remove from `partialMessages` Map
   - Persist to database via `api.saveTaskMessage`

5. Subscribe to events at module level:
   ```typescript
   if (typeof window !== 'undefined' && api.isRunningInTauri()) {
     void api.onTaskMessagePartial((event) => {
       useTaskStore.getState().addPartialMessage(event);
     });

     void api.onTaskMessageComplete((event) => {
       useTaskStore.getState().finalizePartialMessage(event);
       // Persist to database
     });
   }
   ```

### Phase 4: Frontend - UI Updates

**File: `src/pages/Execution.tsx`**

1. Get partial messages from store (around line 100):
   ```typescript
   const partialMessages = useTaskStore((s) => s.partialMessages);
   ```

2. Combine messages for rendering (around line 654):
   ```typescript
   const messagesToRender = useMemo(() => {
     const completed = currentTask?.messages || [];
     const partial = Array.from(partialMessages.values());

     return [...completed, ...partial].sort(
       (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
     );
   }, [currentTask?.messages, partialMessages]);
   ```

3. Update MessageBubble rendering:
   ```typescript
   {messagesToRender.map((message, index) => {
     const isPartial = 'isStreaming' in message && message.isStreaming;
     const content = isPartial ? message.textSoFar : message.content;
     const isLastMessage = index === messagesToRender.length - 1;
     const shouldStream = isPartial && isLastMessage && currentTask.status === 'running';

     return (
       <MessageBubble
         key={message.id}
         message={{ ...message, content, type: 'assistant' }}
         shouldStream={shouldStream}
         isRealStreaming={isPartial}
         // ...
       />
     );
   })}
   ```

**File: `src/components/ui/streaming-text.tsx`**

Add support for real streaming (disable animation when text is already streaming):
```typescript
interface StreamingTextProps {
  // ... existing props
  isRealStreaming?: boolean;  // NEW
}

export function StreamingText({ text, isRealStreaming = false, ... }) {
  // If real streaming, show text immediately without animation
  if (isRealStreaming) {
    return (
      <div className={className}>
        {children(text)}
        {!isComplete && <BlinkingCursor />}
      </div>
    );
  }

  // Existing animation logic for complete messages...
}
```

## Critical Files to Modify

1. **Sidecar Layer:**
   - [src-tauri/sidecar/src/adapter.ts](src-tauri/sidecar/src/adapter.ts) - Message accumulation logic
   - [src-tauri/sidecar/src/task-manager.ts](src-tauri/sidecar/src/task-manager.ts) - Partial state routing
   - [src-tauri/sidecar/src/types.ts](src-tauri/sidecar/src/types.ts) - New IPC types

2. **Rust Backend:**
   - [src-tauri/src/sidecar.rs](src-tauri/src/sidecar.rs) - Event forwarding

3. **Frontend:**
   - [src/shared/types/task.ts](src/shared/types/task.ts) - Type definitions
   - [src/lib/tauri-api.ts](src/lib/tauri-api.ts) - Event listeners
   - [src/stores/taskStore.ts](src/stores/taskStore.ts) - State management
   - [src/pages/Execution.tsx](src/pages/Execution.tsx) - UI rendering
   - [src/components/ui/streaming-text.tsx](src/components/ui/streaming-text.tsx) - Real streaming mode

## Task Switching Behavior

### When switching from Task A (streaming) to Task B:
1. Task A's partial message remains in `partialMessages` Map
2. Sidecar continues accumulating text for Task A in background
3. Frontend stops rendering Task A (no UI updates)

### When switching back to Task A:
1. `loadTaskById()` loads complete messages from database
2. Partial message from `partialMessages` Map is included in render
3. Shows accumulated `textSoFar` immediately (no animation delay)
4. Resumes live streaming if task still running

### When Task A completes:
1. Sidecar emits `message_complete` event
2. Frontend moves message from `partialMessages` → `messages`
3. Persists to database
4. Clears from Map

## Performance Optimizations

1. **Throttling:** 100ms minimum between partial updates (adapter + task-manager layers)
2. **Memory limits:** Max 100KB per partial message to prevent runaway accumulation
3. **Cleanup:** Clear partial messages on task completion
4. **Memoization:** MessageBubble already memoized, leverage React's efficient re-rendering

## Edge Cases Handled

1. **Multiple concurrent tasks:** Each task has separate accumulators keyed by messageId
2. **Rapid task switching:** Partial messages persist in Map, only current task renders
3. **Sidecar crash:** Rust detects exit, emits error, frontend finalizes partials as incomplete
4. **No text events:** Partial messages only created on first text event
5. **Late task completion:** Complete events processed when user switches back

## Unit Tests

### Sidecar Tests

**File: `src-tauri/sidecar/src/__tests__/adapter.test.ts`**

Create unit tests for message accumulation logic:

```typescript
describe('OpenCodeAdapter - Message Accumulation', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    // Initialize adapter with mock config
  });

  test('should create accumulator on first text event', () => {
    const textEvent = {
      type: 'text',
      part: {
        messageID: 'msg-123',
        sessionID: 'session-456',
        text: 'Hello ',
      },
    };

    // Emit text event
    // Verify accumulator created
    // Verify message_partial event emitted
  });

  test('should accumulate multiple text events for same messageID', () => {
    const events = [
      { type: 'text', part: { messageID: 'msg-123', text: 'Hello ' } },
      { type: 'text', part: { messageID: 'msg-123', text: 'world' } },
      { type: 'text', part: { messageID: 'msg-123', text: '!' } },
    ];

    // Emit all events
    // Verify textSoFar = 'Hello world!'
    // Verify message_partial emitted with accumulated text
  });

  test('should throttle partial updates to 100ms', async () => {
    // Emit rapid text events (10 events in 50ms)
    // Verify only 1 message_partial emitted
    // Wait 100ms
    // Emit more events
    // Verify another message_partial emitted
  });

  test('should finalize accumulator on step_finish', () => {
    const finishEvent = {
      type: 'step_finish',
      part: { sessionID: 'session-456' },
    };

    // Create accumulator with text
    // Emit step_finish
    // Verify message_complete emitted
    // Verify accumulator cleared
  });

  test('should handle multiple concurrent accumulators', () => {
    // Create 3 different message accumulators
    // Verify each tracks independently
    // Finalize one
    // Verify others remain active
  });

  test('should respect 100KB text limit per message', () => {
    const largeText = 'x'.repeat(101 * 1024); // 101KB

    // Emit text event with large text
    // Verify truncation or error handling
  });
});
```

**File: `src-tauri/sidecar/src/__tests__/task-manager.test.ts`**

Create unit tests for partial message routing:

```typescript
describe('TaskManager - Partial Message Handling', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    // Initialize task manager
  });

  test('should forward message_partial events via IPC', () => {
    const partialEvent = {
      messageId: 'msg-123',
      sessionId: 'session-456',
      textSoFar: 'Hello world',
      isStreaming: true,
    };

    // Mock stdout write
    // Emit message_partial from adapter
    // Verify IPC message sent with correct format
  });

  test('should forward message_complete events via IPC', () => {
    const completeEvent = {
      messageId: 'msg-123',
      sessionId: 'session-456',
      text: 'Complete message',
    };

    // Emit message_complete from adapter
    // Verify IPC message sent
    // Verify partial state cleared
  });

  test('should track partial messages per task', () => {
    // Start 2 tasks
    // Emit partial for task 1
    // Emit partial for task 2
    // Verify both tracked separately
  });

  test('should clean up partial messages on task completion', () => {
    // Create partial message for task
    // Complete task
    // Verify partial message cleared
  });

  test('should throttle IPC emissions for partials', async () => {
    // Receive rapid partial updates from adapter
    // Verify IPC throttled to 100ms minimum
  });
});
```

### Frontend Tests

**File: `src/stores/__tests__/taskStore.test.ts`**

Create unit tests for partial message state management:

```typescript
describe('taskStore - Partial Message Management', () => {
  beforeEach(() => {
    // Reset store state
  });

  test('addPartialMessage should create new partial message', () => {
    const event: PartialMessageEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    // Set current task to task-123
    const store = useTaskStore.getState();
    store.addPartialMessage(event);

    // Verify partial message added to Map
    const partial = store.partialMessages.get('msg-456');
    expect(partial).toBeDefined();
    expect(partial.textSoFar).toBe('Hello');
    expect(partial.isStreaming).toBe(true);
  });

  test('addPartialMessage should update existing partial message', () => {
    const event1 = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    const event2 = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello world',
      isStreaming: true,
    };

    // Add first partial
    const store = useTaskStore.getState();
    store.addPartialMessage(event1);

    // Update with second partial
    store.addPartialMessage(event2);

    // Verify text updated
    const partial = store.partialMessages.get('msg-456');
    expect(partial.textSoFar).toBe('Hello world');
  });

  test('addPartialMessage should ignore events for non-current task', () => {
    const event = {
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

  test('finalizePartialMessage should move partial to messages', () => {
    // Create partial message
    const partialEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      textSoFar: 'Hello',
      isStreaming: true,
    };

    const completeEvent = {
      taskId: 'task-123',
      messageId: 'msg-456',
      text: 'Hello world',
    };

    const store = useTaskStore.getState();
    store.addPartialMessage(partialEvent);

    // Finalize the message
    store.finalizePartialMessage(completeEvent);

    // Verify removed from partialMessages
    expect(store.partialMessages.has('msg-456')).toBe(false);

    // Verify added to currentTask.messages
    const message = store.currentTask.messages.find(m => m.id === 'msg-456');
    expect(message).toBeDefined();
    expect(message.content).toBe('Hello world');
    expect(message.type).toBe('assistant');
  });

  test('finalizePartialMessage should handle missing partial gracefully', () => {
    const completeEvent = {
      taskId: 'task-123',
      messageId: 'msg-999', // Doesn't exist
      text: 'Hello',
    };

    const store = useTaskStore.getState();
    const initialMessages = store.currentTask.messages.length;

    // Should not throw
    store.finalizePartialMessage(completeEvent);

    // Should not add message if no partial exists
    expect(store.currentTask.messages.length).toBe(initialMessages);
  });

  test('should handle multiple partial messages simultaneously', () => {
    const events = [
      { taskId: 'task-123', messageId: 'msg-1', textSoFar: 'First', isStreaming: true },
      { taskId: 'task-123', messageId: 'msg-2', textSoFar: 'Second', isStreaming: true },
      { taskId: 'task-123', messageId: 'msg-3', textSoFar: 'Third', isStreaming: true },
    ];

    const store = useTaskStore.getState();
    events.forEach(e => store.addPartialMessage(e));

    // Verify all tracked
    expect(store.partialMessages.size).toBe(3);
    expect(store.partialMessages.get('msg-1').textSoFar).toBe('First');
    expect(store.partialMessages.get('msg-2').textSoFar).toBe('Second');
    expect(store.partialMessages.get('msg-3').textSoFar).toBe('Third');
  });
});
```

**File: `src/pages/__tests__/Execution.test.tsx`**

Create unit tests for message rendering with partials:

```typescript
describe('Execution - Partial Message Rendering', () => {
  test('should render completed messages only when no partials', () => {
    const task = {
      id: 'task-123',
      messages: [
        { id: 'msg-1', type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'msg-2', type: 'assistant', content: 'Hi', timestamp: '2024-01-01T00:00:01Z' },
      ],
      status: 'completed',
    };

    // Render with no partial messages
    // Verify 2 MessageBubbles rendered
    // Verify content matches
  });

  test('should render partial messages with completed messages', () => {
    const task = {
      id: 'task-123',
      messages: [
        { id: 'msg-1', type: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ],
      status: 'running',
    };

    const partialMessages = new Map([
      ['msg-2', {
        id: 'msg-2',
        type: 'assistant',
        textSoFar: 'Hello world',
        isStreaming: true,
        timestamp: '2024-01-01T00:00:01Z',
      }],
    ]);

    // Render with partial message
    // Verify 2 MessageBubbles rendered
    // Verify partial message shows textSoFar
    // Verify isRealStreaming prop set on partial
  });

  test('should sort messages by timestamp (completed + partial)', () => {
    const task = {
      messages: [
        { id: 'msg-1', timestamp: '2024-01-01T00:00:02Z' },
        { id: 'msg-3', timestamp: '2024-01-01T00:00:04Z' },
      ],
    };

    const partialMessages = new Map([
      ['msg-2', { id: 'msg-2', timestamp: '2024-01-01T00:00:03Z' }],
      ['msg-4', { id: 'msg-4', timestamp: '2024-01-01T00:00:05Z' }],
    ]);

    // Combine and sort
    // Verify order: msg-1, msg-2, msg-3, msg-4
  });

  test('should enable streaming only for last partial message', () => {
    const partialMessages = new Map([
      ['msg-2', { id: 'msg-2', isStreaming: true, timestamp: '00:01' }],
      ['msg-3', { id: 'msg-3', isStreaming: true, timestamp: '00:02' }],
    ]);

    // Render both partial messages
    // Verify only msg-3 has shouldStream=true
    // Verify msg-2 has shouldStream=false
  });

  test('should update rendering when partial message updates', () => {
    const { rerender } = render(<Execution />);

    // Initial render with textSoFar = "Hello"
    // Verify "Hello" displayed

    // Update partial message with textSoFar = "Hello world"
    // Rerender
    // Verify "Hello world" displayed
  });
});
```

**File: `src/components/ui/__tests__/streaming-text.test.tsx`**

Create unit tests for real streaming mode:

```typescript
describe('StreamingText - Real Streaming Mode', () => {
  test('should show text immediately when isRealStreaming=true', () => {
    const text = 'Hello world';

    const { container } = render(
      <StreamingText text={text} isRealStreaming={true}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify full text shown immediately (no animation delay)
    expect(container.textContent).toBe('Hello world');
  });

  test('should show blinking cursor when isRealStreaming=true and incomplete', () => {
    const { container } = render(
      <StreamingText text="Hello" isRealStreaming={true} isComplete={false}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify cursor element exists
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeTruthy();
  });

  test('should hide cursor when isRealStreaming=true and complete', () => {
    const { container } = render(
      <StreamingText text="Hello" isRealStreaming={true} isComplete={true}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify no cursor element
    const cursor = container.querySelector('.animate-pulse');
    expect(cursor).toBeFalsy();
  });

  test('should animate text when isRealStreaming=false (existing behavior)', async () => {
    const text = 'Hello';

    const { container } = render(
      <StreamingText text={text} isRealStreaming={false}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Initially shows empty or partial text
    // Wait for animation to complete
    // Verify full text shown
  });

  test('should update displayed text when text prop changes (real streaming)', () => {
    const { container, rerender } = render(
      <StreamingText text="Hello" isRealStreaming={true}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    expect(container.textContent).toContain('Hello');

    // Update text prop
    rerender(
      <StreamingText text="Hello world" isRealStreaming={true}>
        {(displayedText) => <div>{displayedText}</div>}
      </StreamingText>
    );

    // Verify updated text shown immediately
    expect(container.textContent).toContain('Hello world');
  });
});
```

### Integration Tests

**File: `src/__tests__/integration/streaming-flow.test.ts`**

Create integration tests for the full streaming flow:

```typescript
describe('Streaming Flow Integration', () => {
  test('should handle full streaming lifecycle', async () => {
    // 1. Start task
    // 2. Mock OpenCode emitting text events
    // 3. Verify partial messages accumulate in store
    // 4. Verify UI updates with each chunk
    // 5. Mock step_finish event
    // 6. Verify message finalized
    // 7. Verify database persistence
  });

  test('should preserve partial state during task switch', async () => {
    // 1. Start task A, accumulate partial text
    // 2. Switch to task B
    // 3. Verify task A partial still in store
    // 4. Switch back to task A
    // 5. Verify accumulated text shown immediately
    // 6. Verify streaming resumes if still active
  });

  test('should handle multiple concurrent streaming tasks', async () => {
    // 1. Start 3 tasks
    // 2. Emit partial updates for all 3
    // 3. Verify each tracked independently
    // 4. Switch between tasks
    // 5. Verify correct partial shown for each
  });

  test('should clean up partials on completion', async () => {
    // 1. Start task with partial message
    // 2. Complete task
    // 3. Verify partial removed from Map
    // 4. Verify message in database
  });
});
```

### Test Infrastructure

**Setup test environment:**

1. **Sidecar tests:** Use Jest with TypeScript support
   - Create `src-tauri/sidecar/jest.config.js`
   - Add test scripts to `src-tauri/sidecar/package.json`:
     ```json
     "scripts": {
       "test": "jest",
       "test:watch": "jest --watch",
       "test:coverage": "jest --coverage"
     }
     ```

2. **Frontend tests:** Use Vitest (already configured with Vite)
   - Create test files alongside source files
   - Add test scripts to root `package.json`:
     ```json
     "scripts": {
       "test": "vitest",
       "test:ui": "vitest --ui",
       "test:coverage": "vitest --coverage"
     }
     ```

3. **Mock utilities:**
   - Create mock Tauri API for frontend tests
   - Create mock EventEmitter for sidecar tests
   - Create mock StreamParser for adapter tests

### Test Coverage Goals

- **Adapter.ts:** 80%+ coverage of accumulation logic
- **Task-manager.ts:** 80%+ coverage of routing logic
- **taskStore.ts:** 90%+ coverage of state management
- **Execution.tsx:** 70%+ coverage of rendering logic
- **StreamingText.tsx:** 80%+ coverage of streaming modes

## Verification Steps

### End-to-End Test:
1. Start a task that generates a long response
2. **Verify:** Text appears incrementally in real-time (not all at once)
3. **Verify:** Cursor blinks at the end of partial text
4. Switch to a different task or create new task
5. Switch back to original task
6. **Verify:** All accumulated text is displayed immediately
7. **Verify:** Streaming resumes from current position if still running
8. Wait for task completion
9. **Verify:** Message moves to completed state
10. Refresh the page
11. **Verify:** Completed messages load from database correctly

### Performance Test:
1. Start 3 concurrent tasks with streaming responses
2. Rapidly switch between tasks
3. **Verify:** No UI lag or freezing
4. **Verify:** All partial states preserved correctly
5. **Verify:** Database writes only occur on completion (check logs)

### Cleanup Test:
1. Start a task, let it stream
2. Force-quit the app (Command+Q)
3. Restart the app
4. **Verify:** Partial messages don't persist (expected behavior - in-memory only)
5. **Verify:** Completed messages load correctly from database

## Success Criteria

✅ Text appears incrementally as OpenCode generates it
✅ No "flash" of complete text - truly progressive display
✅ Task switching shows accumulated partial text immediately
✅ Streaming resumes when switching back to active task
✅ No performance degradation with multiple concurrent tasks
✅ Proper cleanup on task completion
✅ Database writes only for complete messages (not partials)
✅ Smooth user experience with <100ms update latency

## Notes

- Partial messages are **in-memory only** - not persisted to database until complete
- This reduces database write frequency and prevents partial data pollution
- On app restart, only complete messages are restored (expected behavior)
- The `StreamingText` component animation is disabled for real streaming to avoid double animation
