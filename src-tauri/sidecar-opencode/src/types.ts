// ============================================================================
// OpenCode Server API Types (from opencode-api.json)
// ============================================================================

export interface Session {
  id: string; // Pattern: ^ses.*
  slug: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  version: string;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
  permission?: PermissionRuleset;
}

export interface SessionStatus {
  type: 'idle' | 'busy' | 'retry';
  attempt?: number;
  message?: string;
  next?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  // additional fields may be present
}

export interface Part {
  type: string;
  text?: string;
  // Union of TextPart, ToolPart, etc.
}

// Extended part shape as returned in SSE message.part.updated events.
// The server nests sessionID and messageID inside the part object itself.
export interface PartUpdate extends Part {
  id: string;
  sessionID: string;
  messageID: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
  reason?: string;
  cost?: number;
  tokens?: Record<string, number>;
}

// Message info shape as returned in SSE message.updated events.
export interface MessageInfo {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: { created: number; completed?: number };
  parentID?: string;
  modelID?: string;
  providerID?: string;
  mode?: string;
  agent?: string;
  path?: { cwd: string; root: string };
  cost?: number;
  tokens?: Record<string, number>;
  finish?: string;
  summary?: Record<string, unknown>;
}

export interface PermissionRequest {
  id: string; // Pattern: ^per.*
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionRequest {
  id: string; // Pattern: ^que.*
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionInfo {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  /** OpenCode server uses `multiple` instead of `multiSelect` */
  multiple?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionAnswer {
  labels: string[];
  customText?: string;
}

export type PermissionAction = 'ask' | 'allow' | 'deny';

export interface PermissionConfig {
  read?: PermissionRuleConfig;
  edit?: PermissionRuleConfig;
  bash?: PermissionRuleConfig;
  external_directory?: PermissionRuleConfig;
  doom_loop?: PermissionAction;
  // other permission types
}

export type PermissionRuleConfig = PermissionAction | Record<string, PermissionAction>;
export type PermissionRuleset = PermissionRule[];

export type PermissionRule = {};

export interface Config {
  $schema?: string;
  model?: string;
  small_model?: string;
  default_agent?: string;
  enabled_providers?: string[];
  disabled_providers?: string[];
  permission?: PermissionConfig;
  agent?: Record<string, AgentConfig>;
  mcp?: Record<string, McpConfig>;
  provider?: Record<string, unknown>;
  // other config fields
}

export interface AgentConfig {
  model?: string;
  prompt?: string;
  description?: string;
  mode?: 'primary' | 'subagent' | 'all';
  permission?: PermissionConfig;
}

export interface McpOAuthConfig {
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface McpConfig {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | false;
  timeout?: number;
}

export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface HealthResponse {
  healthy: true;
  version: string;
}

// ============================================================================
// OpenCode Server Events (SSE)
// ============================================================================

export type OpenCodeEvent =
  | {
      type: 'session.status';
      properties: { sessionID: string; status: SessionStatus };
    }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | { type: 'session.created'; properties: { info: Session } }
  | { type: 'session.updated'; properties: { info: Session } }
  | { type: 'session.deleted'; properties: { sessionID: string } }
  | { type: 'session.error'; properties: { sessionID: string; error: string } }
  | { type: 'session.diff'; properties: { sessionID: string; diff: unknown[] } }
  | {
      type: 'message.updated';
      properties: { info: MessageInfo };
    }
  | {
      type: 'message.part.updated';
      properties: {
        part: PartUpdate;
      };
    }
  | {
      type: 'message.part.delta';
      properties: {
        sessionID: string;
        messageID: string;
        partID: string;
        field: string;
        delta: string;
      };
    }
  | { type: 'permission.asked'; properties: PermissionRequest }
  | { type: 'permission.replied'; properties: { id: string; reply: string } }
  | { type: 'question.asked'; properties: QuestionRequest }
  | {
      type: 'question.replied';
      properties: { id: string; answers: QuestionAnswer[] };
    }
  | { type: 'question.rejected'; properties: { id: string } }
  | { type: 'todo.updated'; properties: { sessionID: string; todos: Todo[] } }
  | { type: 'session.compacted'; properties: { sessionID: string } }
  | { type: 'server.connected'; properties: Record<string, never> }
  | { type: 'server.instance.disposed'; properties: { directory: string } }
  | { type: 'server.heartbeat'; properties: Record<string, never> }
  | { type: 'global.disposed'; properties: Record<string, never> };

// ============================================================================
// IPC Protocol (Tauri <-> Sidecar)
// ============================================================================

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  xai?: string;
  deepseek?: string;
  openrouter?: string;
  litellm?: string;
  ollama?: string;
  bedrock?: BedrockCredentials;
}

export interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// Commands from Tauri to Sidecar
export type SidecarCommand =
  | { type: 'start_task'; taskId: string; payload: StartTaskPayload }
  | { type: 'resume_session'; taskId: string; payload: ResumeSessionPayload }
  | { type: 'cancel_task'; taskId: string }
  | { type: 'abort_session'; taskId: string; sessionId: string }
  | {
      type: 'send_permission_reply';
      taskId: string;
      payload: PermissionReplyPayload;
    }
  | {
      type: 'send_question_reply';
      taskId: string;
      payload: QuestionReplyPayload;
    }
  | { type: 'get_session_todos'; taskId: string; sessionId: string }
  | { type: 'update_mcp_config'; payload: UpdateMcpConfigPayload }
  | { type: 'copilot_oauth_authorize'; enterpriseUrl?: string }
  | { type: 'copilot_get_models' }
  | { type: 'copilot_disconnect' }
  | { type: 'ping' }
  | { type: 'check_server' }
  | { type: 'shutdown' };

export interface FolderPermission {
  path: string;
  accessLevel: 'read' | 'read-write';
  /** Source of the permission: 'user' (added via FoldersPanel), 'adhoc' (granted from permission prompt), or 'workspace' (auto from workspace folder) */
  source?: 'user' | 'adhoc' | 'workspace';
}

export interface StartTaskPayload {
  taskId: string;
  prompt: string;
  apiKeys?: ApiKeys;
  workingDirectory?: string;
  modelId?: string;
  folderPermissions?: FolderPermission[];
  customPrompt?: string;
  mcpServers?: Record<string, McpConfig>;
}

export interface ResumeSessionPayload {
  taskId: string;
  sessionId: string;
  prompt?: string;
  apiKeys?: ApiKeys;
  workingDirectory?: string;
  modelId?: string;
  folderPermissions?: FolderPermission[];
  customPrompt?: string;
  mcpServers?: Record<string, McpConfig>;
}

export interface UpdateMcpConfigPayload {
  mcpServers: Record<string, McpConfig>;
  workingDirectory?: string;
}

export interface PermissionReplyPayload {
  requestId: string;
  reply: 'once' | 'always' | 'reject';
  message?: string;
}

export interface QuestionReplyPayload {
  requestId: string;
  answers: QuestionAnswer[];
}

// Events from Sidecar to Tauri
export type SidecarEvent =
  | { type: 'ready'; payload: ReadyPayload }
  | { type: 'pong'; payload: { timestamp: number } }
  | { type: 'server_status'; payload: ServerStatusPayload }
  | { type: 'task_started'; taskId: string; payload: TaskStartedPayload }
  | { type: 'task_message'; taskId: string; payload: TaskMessagePayload }
  | {
      type: 'task_message_partial';
      taskId: string;
      payload: TaskMessagePartialPayload;
    }
  | {
      type: 'task_message_complete';
      taskId: string;
      payload: TaskMessageCompletePayload;
    }
  | { type: 'task_progress'; taskId: string; payload: TaskProgressPayload }
  | {
      type: 'permission_request';
      taskId: string;
      payload: PermissionRequestPayload;
    }
  | {
      type: 'question_request';
      taskId: string;
      payload: QuestionRequestPayload;
    }
  | { type: 'task_complete'; taskId: string; payload: TaskCompletePayload }
  | { type: 'task_error'; taskId: string; payload: TaskErrorPayload }
  | { type: 'todo_updated'; taskId: string; payload: TodoUpdatedPayload }
  | { type: 'copilot_oauth_result'; payload: CopilotOAuthResultPayload }
  | { type: 'copilot_oauth_complete'; payload: CopilotOAuthCompletePayload }
  | { type: 'copilot_models_result'; payload: CopilotModelsResultPayload }
  | { type: 'log'; payload: LogPayload }
  | { type: 'error'; payload: ErrorPayload };

export interface ReadyPayload {
  version: string;
  serverAvailable: boolean;
  serverVersion?: string;
}

export interface ServerStatusPayload {
  running: boolean;
  port?: number;
  version?: string;
}

export interface TaskStartedPayload {
  taskId: string;
  sessionId: string;
}

export interface TaskMessagePayload {
  message: Message;
  parts: Part[];
}

export interface TaskMessagePartialPayload {
  messageId: string;
  partId: string;
  textSoFar: string;
  delta?: string;
  isStreaming: boolean;
}

export interface TaskMessageCompletePayload {
  messageId: string;
  text: string;
}

export interface TaskProgressPayload {
  stage: 'starting' | 'connecting' | 'configuring' | 'executing' | 'completing';
  message?: string;
}

export interface PermissionRequestPayload {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
}

export interface QuestionRequestPayload {
  id: string;
  sessionId: string;
  questions: QuestionInfo[];
}

export interface TaskCompletePayload {
  status: 'success' | 'error' | 'cancelled' | 'aborted';
  sessionId?: string;
  error?: string;
}

export interface TaskErrorPayload {
  error: string;
  sessionId?: string;
}

export interface TodoUpdatedPayload {
  todos: Todo[];
}

export interface CopilotOAuthResultPayload {
  url: string;
  method: 'auto' | 'code';
  instructions: string;
}

export interface CopilotOAuthCompletePayload {
  connected: boolean;
  error?: string;
}

export interface CopilotModelsResultPayload {
  success: boolean;
  models?: Array<{ id: string; name: string }>;
  error?: string;
}

export interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface ErrorPayload {
  message: string;
}
