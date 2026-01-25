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
 *   - start_task: { taskId, prompt, sessionId?, apiKeys?, workingDirectory?, modelId? }
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
import { TaskManager } from './task-manager.js';
import { isOpenCodeAvailable, getOpenCodeVersion } from './cli-path.js';
import type { TaskConfig, ApiKeys, SidecarMessage, SidecarCommand } from './types.js';

// Initialize task manager
const taskManager = new TaskManager();

// Send a message to the parent (Tauri)
function send(type: string, payload: unknown, taskId?: string): void {
  const message: SidecarMessage = { type, payload };
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
async function handleMessage(msg: SidecarCommand): Promise<void> {
  const { type, taskId, payload } = msg;

  try {
    switch (type) {
      case 'start_task': {
        const config = payload as TaskConfig & { apiKeys?: ApiKeys };
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

      case 'check_cli': {
        const available = isOpenCodeAvailable();
        const version = available ? getOpenCodeVersion() : null;
        send('cli_status', { available, version });
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

// Start a new task using TaskManager
async function startTask(config: TaskConfig & { apiKeys?: ApiKeys }): Promise<void> {
  const { taskId } = config;

  log('info', `Starting task ${taskId}: ${config.prompt.slice(0, 50)}...`);

  // Check if OpenCode CLI is available
  if (!isOpenCodeAvailable()) {
    send(
      'task_error',
      {
        error:
          'OpenCode CLI not found. Please install opencode-ai globally: npm install -g opencode-ai',
      },
      taskId
    );
    return;
  }

  // Notify task started
  send('task_started', { taskId }, taskId);

  try {
    await taskManager.startTask(config, {
      onMessage: (message) => {
        send('task_message', { message }, taskId);
      },
      onProgress: (progress) => {
        send('task_progress', { progress }, taskId);
      },
      onPermissionRequest: (request) => {
        send('permission_request', { request }, taskId);
      },
      onComplete: (result) => {
        send('task_complete', { result }, taskId);
      },
      onError: (error) => {
        send('task_error', { error }, taskId);
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    send('task_error', { error: errorMessage }, taskId);
  }
}

// Cancel a running task
async function cancelTask(taskId: string): Promise<void> {
  log('info', `Cancelling task ${taskId}`);

  if (!taskManager.hasActiveTask(taskId)) {
    log('warn', `Task ${taskId} not found for cancellation`);
    return;
  }

  await taskManager.cancelTask(taskId);
}

// Interrupt a running task (Ctrl+C)
async function interruptTask(taskId: string): Promise<void> {
  log('info', `Interrupting task ${taskId}`);

  if (!taskManager.hasActiveTask(taskId)) {
    log('warn', `Task ${taskId} not found for interruption`);
    return;
  }

  await taskManager.interruptTask(taskId);
}

// Send a response to a task's PTY (for permissions/questions)
async function sendResponse(taskId: string, response: string): Promise<void> {
  log('info', `Sending response to task ${taskId}`);

  if (!taskManager.hasActiveTask(taskId)) {
    throw new Error(`Task ${taskId} not found`);
  }

  await taskManager.sendResponse(taskId, response);
}

// Cleanup on shutdown
function cleanup(): void {
  log('info', 'Cleaning up task manager');
  taskManager.dispose();
}

// Main entry point
async function main(): Promise<void> {
  log('info', 'Cowork Z sidecar started');

  // Check OpenCode CLI availability on startup
  const cliAvailable = isOpenCodeAvailable();
  const cliVersion = cliAvailable ? getOpenCodeVersion() : null;
  log('info', `OpenCode CLI: ${cliAvailable ? `available (${cliVersion})` : 'not found'}`);

  // Set up stdin reading
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Process JSON-line messages
  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.parse(line) as SidecarCommand;
      await handleMessage(msg);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log('error', `Failed to parse message: ${errorMessage}`);
    }
  });

  // Handle stdin close
  rl.on('close', () => {
    log('info', 'Sidecar stdin closed, shutting down');
    cleanup();
    process.exit(0);
  });

  // Handle process signals
  process.on('SIGINT', () => {
    log('info', 'Received SIGINT, shutting down');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('info', 'Received SIGTERM, shutting down');
    cleanup();
    process.exit(0);
  });

  // Send ready message with CLI status
  send('ready', {
    version: '0.1.0',
    cliAvailable,
    cliVersion,
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
