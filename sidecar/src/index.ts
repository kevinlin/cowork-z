/**
 * Cowork Z Sidecar - Node.js process for OpenCode CLI integration
 *
 * This sidecar communicates with the Tauri app via JSON messages over stdin/stdout.
 * It spawns and manages OpenCode CLI processes using node-pty.
 *
 * Protocol:
 * - Input (stdin): JSON-line messages with { type, payload } format
 * - Output (stdout): JSON-line messages with { type, taskId?, payload } format
 *
 * Message Types:
 * Input:
 *   - start_task: { taskId, prompt, sessionId? }
 *   - cancel_task: { taskId }
 *   - interrupt_task: { taskId }
 *   - send_response: { taskId, response }
 *
 * Output:
 *   - task_started: { taskId }
 *   - task_message: { taskId, message }
 *   - task_progress: { taskId, progress }
 *   - permission_request: { taskId, request }
 *   - task_complete: { taskId, result }
 *   - task_error: { taskId, error }
 *   - log: { level, message }
 */

import * as readline from 'readline';

// Import types
interface Message {
  type: string;
  taskId?: string;
  payload?: unknown;
}

interface TaskConfig {
  taskId: string;
  prompt: string;
  sessionId?: string;
}

// Task management
const activeTasks = new Map<string, { pty: unknown; cleanup: () => void }>();

// Send a message to the parent (Tauri)
function send(type: string, payload: unknown, taskId?: string): void {
  const message: Message = { type, payload };
  if (taskId) {
    message.taskId = taskId;
  }
  console.log(JSON.stringify(message));
}

// Log helper (sends to parent for debug logging)
function log(level: 'info' | 'warn' | 'error', message: string): void {
  send('log', { level, message });
}

// Handle incoming messages
async function handleMessage(msg: Message): Promise<void> {
  const { type, taskId, payload } = msg;

  try {
    switch (type) {
      case 'start_task': {
        const config = payload as TaskConfig;
        await startTask(config);
        break;
      }

      case 'cancel_task': {
        if (taskId) {
          await cancelTask(taskId);
        }
        break;
      }

      case 'interrupt_task': {
        if (taskId) {
          await interruptTask(taskId);
        }
        break;
      }

      case 'send_response': {
        if (taskId) {
          const { response } = payload as { response: string };
          await sendResponse(taskId, response);
        }
        break;
      }

      case 'ping': {
        send('pong', { timestamp: Date.now() });
        break;
      }

      default:
        log('warn', `Unknown message type: ${type}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    send('error', { message: errorMessage }, taskId);
  }
}

// Start a new task
async function startTask(config: TaskConfig): Promise<void> {
  const { taskId, prompt, sessionId } = config;

  log('info', `Starting task ${taskId}: ${prompt.slice(0, 50)}...`);

  // Check if task already exists
  if (activeTasks.has(taskId)) {
    throw new Error(`Task ${taskId} is already running`);
  }

  // TODO: Implement actual OpenCode CLI spawning with node-pty
  // For now, send a placeholder response

  send('task_started', { taskId }, taskId);
  send('task_progress', { stage: 'starting', message: 'Starting task...' }, taskId);

  // Placeholder: simulate task completion after a delay
  // In production, this would spawn the OpenCode CLI and stream its output
  setTimeout(() => {
    send(
      'task_error',
      {
        error: 'OpenCode CLI integration not yet implemented. Install opencode-ai and configure the sidecar.',
      },
      taskId
    );
  }, 1000);
}

// Cancel a running task
async function cancelTask(taskId: string): Promise<void> {
  log('info', `Cancelling task ${taskId}`);

  const task = activeTasks.get(taskId);
  if (!task) {
    log('warn', `Task ${taskId} not found for cancellation`);
    return;
  }

  task.cleanup();
  activeTasks.delete(taskId);

  send('task_complete', { status: 'cancelled' }, taskId);
}

// Interrupt a running task (Ctrl+C)
async function interruptTask(taskId: string): Promise<void> {
  log('info', `Interrupting task ${taskId}`);

  const task = activeTasks.get(taskId);
  if (!task) {
    log('warn', `Task ${taskId} not found for interruption`);
    return;
  }

  // TODO: Send SIGINT to the PTY process
}

// Send a response to a task's PTY (for permissions/questions)
async function sendResponse(taskId: string, response: string): Promise<void> {
  log('info', `Sending response to task ${taskId}`);

  const task = activeTasks.get(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  // TODO: Write to the PTY process
}

// Main entry point
async function main(): Promise<void> {
  log('info', 'Cowork Z sidecar started');

  // Set up stdin reading
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Process JSON-line messages
  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.parse(line) as Message;
      await handleMessage(msg);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Failed to parse message: ${errorMessage}`);
    }
  });

  // Handle stdin close
  rl.on('close', () => {
    log('info', 'Sidecar stdin closed, shutting down');
    process.exit(0);
  });

  // Handle process signals
  process.on('SIGINT', () => {
    log('info', 'Received SIGINT, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('info', 'Received SIGTERM, shutting down');
    process.exit(0);
  });

  // Send ready message
  send('ready', { version: '0.1.0' });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
