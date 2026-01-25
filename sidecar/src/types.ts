/**
 * OpenCode CLI message types
 * Based on --format json output from `opencode run`
 */

export interface OpenCodeMessageBase {
  type: string;
  timestamp?: number;
  sessionID?: string;
}

/** Step start event */
export interface OpenCodeStepStartMessage extends OpenCodeMessageBase {
  type: 'step_start';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'step-start';
    snapshot?: string;
  };
}

/** Text content event */
export interface OpenCodeTextMessage extends OpenCodeMessageBase {
  type: 'text';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'text';
    text: string;
    time?: {
      start: number;
      end: number;
    };
  };
}

/** Tool call event (legacy format) */
export interface OpenCodeToolCallMessage extends OpenCodeMessageBase {
  type: 'tool_call';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'tool-call';
    tool: string;
    input: unknown;
    time?: {
      start: number;
      end?: number;
    };
  };
}

/** Tool use event - combined tool call and result from OpenCode CLI */
export interface OpenCodeToolUseMessage extends OpenCodeMessageBase {
  type: 'tool_use';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'tool';
    callID?: string;
    tool: string;
    state: {
      status: 'pending' | 'running' | 'completed' | 'error';
      input?: unknown;
      output?: string;
    };
    time?: {
      start: number;
      end?: number;
    };
  };
}

/** Tool result event */
export interface OpenCodeToolResultMessage extends OpenCodeMessageBase {
  type: 'tool_result';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'tool-result';
    toolCallID: string;
    output?: string;
    isError?: boolean;
    time?: {
      start: number;
      end: number;
    };
  };
}

/** Step finish event */
export interface OpenCodeStepFinishMessage extends OpenCodeMessageBase {
  type: 'step_finish';
  part: {
    id: string;
    sessionID: string;
    messageID: string;
    type: 'step-finish';
    reason: 'stop' | 'end_turn' | 'tool_use' | 'error';
    snapshot?: string;
    cost?: number;
    tokens?: {
      input: number;
      output: number;
      reasoning: number;
      cache?: {
        read: number;
        write: number;
      };
    };
  };
}

/** Error event */
export interface OpenCodeErrorMessage extends OpenCodeMessageBase {
  type: 'error';
  error: string;
  code?: string;
}

/** All OpenCode message types */
export type OpenCodeMessage =
  | OpenCodeStepStartMessage
  | OpenCodeTextMessage
  | OpenCodeToolCallMessage
  | OpenCodeToolUseMessage
  | OpenCodeToolResultMessage
  | OpenCodeStepFinishMessage
  | OpenCodeErrorMessage;

// ========== Sidecar IPC Types ==========

/** API keys passed from Rust backend */
export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  xai?: string;
  deepseek?: string;
  openrouter?: string;
  litellm?: string;
  ollama?: string;
  azureFoundry?: string;
  bedrock?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
}

/** Task configuration passed from Rust */
export interface TaskConfig {
  taskId: string;
  prompt: string;
  sessionId?: string;
  apiKeys?: ApiKeys;
  workingDirectory?: string;
  modelId?: string;
}

/** Task progress stages */
export type TaskProgressStage =
  | 'starting'
  | 'loading'
  | 'connecting'
  | 'waiting'
  | 'executing'
  | 'tool-use'
  | 'completing';

/** Task progress event */
export interface TaskProgress {
  stage: TaskProgressStage;
  message?: string;
  modelName?: string;
}

/** Task completion result */
export interface TaskResult {
  status: 'success' | 'error' | 'cancelled' | 'interrupted';
  sessionId?: string;
  summary?: string;
  error?: string;
}

/** Permission request from OpenCode CLI */
export interface PermissionRequest {
  id: string;
  type: 'file' | 'bash' | 'mcp' | 'question';
  tool?: string;
  path?: string;
  command?: string;
  question?: string;
  options?: string[];
}

// ========== Sidecar IPC Protocol ==========

/** Messages received from Rust via stdin */
export type SidecarInputMessage =
  | { type: 'start_task'; taskId: string; payload: TaskConfig }
  | { type: 'cancel_task'; taskId: string }
  | { type: 'interrupt_task'; taskId: string }
  | { type: 'send_response'; taskId: string; payload: { response: string } }
  | { type: 'ping' };

/** Messages sent to Rust via stdout */
export type SidecarOutputMessage =
  | { type: 'ready'; payload: { version: string } }
  | { type: 'pong'; payload: { timestamp: number } }
  | { type: 'task_started'; taskId: string; payload: { taskId: string } }
  | { type: 'task_message'; taskId: string; payload: OpenCodeMessage }
  | { type: 'task_progress'; taskId: string; payload: TaskProgress }
  | { type: 'permission_request'; taskId: string; payload: PermissionRequest }
  | { type: 'task_complete'; taskId: string; payload: TaskResult }
  | { type: 'task_error'; taskId: string; payload: { error: string } }
  | { type: 'log'; payload: { level: 'info' | 'warn' | 'error'; message: string } };

/** Task callbacks for event handling */
export interface TaskCallbacks {
  onMessage: (message: OpenCodeMessage) => void;
  onProgress: (progress: TaskProgress) => void;
  onPermissionRequest: (request: PermissionRequest) => void;
  onComplete: (result: TaskResult) => void;
  onError: (error: string) => void;
}

/** Generic sidecar message sent to Rust */
export interface SidecarMessage {
  type: string;
  taskId?: string;
  payload?: unknown;
}

/** Generic sidecar command received from Rust */
export interface SidecarCommand {
  type: string;
  taskId?: string;
  payload?: unknown;
}
