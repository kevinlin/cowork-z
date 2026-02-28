/**
 * Task-related types for execution management
 */

export type TaskStatus =
  | 'pending'
  | 'starting'
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface TaskConfig {
  /** The task prompt/description */
  prompt: string;
  /** Optional task ID to correlate events */
  taskId?: string;
  /** Working directory for Claude Code operations */
  workingDirectory?: string;
  /** List of allowed tools */
  allowedTools?: string[];
  /** System prompt to append */
  systemPromptAppend?: string;
  /** JSON schema for structured output */
  outputSchema?: object;
  /** Session ID for resuming */
  sessionId?: string;
}

export interface Task {
  id: string;
  prompt: string;
  /** AI-generated short summary of the task (displayed in history) */
  summary?: string;
  status: TaskStatus;
  sessionId?: string;
  messages: TaskMessage[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: TaskResult;
  /** Workspace ID this task belongs to */
  workspaceId?: string;
}

export interface TaskAttachment {
  type: 'screenshot' | 'json';
  data: string; // base64 for images, JSON string for data
  label?: string; // e.g., "Screenshot after clicking Submit"
}

export interface TaskMessage {
  id: string;
  type: 'assistant' | 'user' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  /** Tool execution output (e.g. bash stdout) — used to resolve runtime paths */
  toolOutput?: string;
  timestamp: string;
  /** Attachments like screenshots captured during browser automation */
  attachments?: TaskAttachment[];
}

export interface TaskResult {
  status: 'success' | 'error' | 'interrupted';
  sessionId?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Startup stages shown during task initialization (before first tool runs)
 */
export type StartupStage =
  | 'starting' // Task created
  | 'browser' // Preparing browser (cold start only)
  | 'environment' // Setting up environment (config + API keys)
  | 'loading' // Loading agent (CLI spawning)
  | 'connecting' // Connecting to model (step_start received)
  | 'waiting'; // Waiting for response (timed transition)

export interface TaskProgress {
  taskId: string;
  stage: 'init' | 'thinking' | 'tool-use' | 'waiting' | 'complete' | 'setup' | StartupStage;
  toolName?: string;
  toolInput?: unknown;
  percentage?: number;
  message?: string;
  /** Model display name for 'connecting' stage */
  modelName?: string;
  /** Whether this is the first task (cold start) */
  isFirstTask?: boolean;
}

export interface TaskUpdateEvent {
  taskId: string;
  type: 'message' | 'progress' | 'complete' | 'error' | 'started';
  message?: TaskMessage;
  progress?: TaskProgress;
  result?: TaskResult;
  error?: string;
  /** Session ID from error events - allows follow-up after failures */
  sessionId?: string;
}

// ========== Streaming Message Types ==========

/** Partial message being streamed */
export interface PartialMessage {
  id: string;
  type: 'assistant';
  textSoFar: string;
  isStreaming: boolean;
  timestamp: string;
}

/** Event payload for partial message updates */
export interface PartialMessageEvent {
  taskId: string;
  messageId: string;
  textSoFar: string;
  isStreaming: boolean;
}

/** Event payload for complete message updates */
export interface CompleteMessageEvent {
  taskId: string;
  messageId: string;
  text: string;
}

// ========== Question Request Types ==========

/** A question request from the agent (via task:question_request event) */
export interface QuestionRequest {
  taskId: string;
  requestId: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

// ========== Todo Types ==========

/** A todo item from the OpenCode server's todo list */
export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

// ========== Artifact Types ==========

/** A file created or modified by the agent during a task session */
export interface Artifact {
  /** Source message ID that created this artifact */
  id: string;
  /** Absolute path to the file */
  filePath: string;
  /** Filename extracted from path (for display) */
  fileName: string;
  /** File extension without dot (for icon mapping) */
  fileExt: string;
  /** ISO timestamp when the file was written */
  timestamp: string;
  /** Operation type (currently only 'write', future: 'create', 'modify') */
  operation: 'write';
}
