// ============================================================================
// Single source of truth for the Rust <-> sidecar IPC protocol.
//
// The frontend imports `SidecarEvent` from here via the `@sidecar/*` path alias
// (tsconfig.json, vite.config.ts, vitest.config.ts) rather than keeping its own
// copy. Consequence to be aware of: this file is part of the root TypeScript
// program, so a change here can break `pnpm typecheck` from outside `src/`.
// Keep it type-only — no imports, no runtime code.
// ============================================================================

// ============================================================================
// OpenCode 2.x Server API Types — the subset the sidecar uses
// (full contract: docs/specs/opencode-api-v2.json)
// ============================================================================

export interface ServerInfo {
  version: string;
  pid?: number;
}

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export type PermissionEffect = 'ask' | 'allow' | 'deny';

/** One entry of a session's ordered ruleset. The last matching rule wins. */
export interface PermissionRule {
  action: string;
  resource: string;
  effect: PermissionEffect;
}

export type SessionOutcome = 'succeeded' | 'failed' | 'interrupted';

/** `Session.Info` from `GET /api/session/{id}` (unwrapped from `{data}`). */
export interface SessionInfo {
  id: string;
  outcome?: SessionOutcome;
  model?: ModelRef;
  time: { created: number; updated: number; idle?: number };
  location: { directory: string };
  title?: string;
  permissions?: PermissionRule[];
}

/** An `/api/event` frame. `server.connected` and `session.execution.*` frames carry no `location`. */
export interface OpenCodeEventFrame {
  id?: string;
  created?: number;
  type: string;
  location?: { directory?: string };
  data: unknown;
}

export interface ErrorInfo {
  type: string;
  message: string;
}

export interface TextDeltaData {
  sessionID: string;
  assistantMessageID: string;
  ordinal: number;
  delta: string;
}

export interface ToolInputStartedData {
  sessionID: string;
  assistantMessageID: string;
  id: string;
  name: string;
}

export interface ToolCalledData {
  sessionID: string;
  assistantMessageID: string;
  id: string;
  input: unknown;
}

export type ToolContentItem = { type: 'text'; text: string } | { type: 'file'; uri: string; mime: string; name?: string | null };

export interface ToolSuccessData {
  sessionID: string;
  assistantMessageID: string;
  id: string;
  content: ToolContentItem[];
}

export interface ToolFailedData {
  sessionID: string;
  assistantMessageID: string;
  id: string;
  error: ErrorInfo;
}

export interface ExecutionFailedData {
  sessionID: string;
  error: ErrorInfo;
}

export interface ExecutionInterruptedData {
  sessionID: string;
  reason?: string;
}

/** `Permission.Request` — the payload of `permission.asked` and `GET /api/session/{sid}/permission`. */
export interface PermissionAsk {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: { type: 'tool'; messageID: string; id: string };
  message?: string;
}

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormField {
  key: string;
  type: 'string' | 'multiselect' | 'number' | 'integer' | 'boolean' | 'external';
  title?: string;
  description?: string;
  hidden?: boolean;
  when?: unknown[];
  options?: FormOption[];
  custom?: boolean;
  url?: string;
}

/** `Form.Info` — the `form` of `form.created` and the items of `GET /api/session/{sid}/form`. */
export interface FormInfo {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  fields: FormField[];
}

export type FormValue = string | number | boolean | string[];
export type FormAnswer = Record<string, FormValue>;

/** Items of `GET /api/session/{id}/message` that the sidecar reads (assistant tool calls and errors). */
export interface SessionMessageContentItem {
  type: string;
  id?: string;
  name?: string;
  state?: { status?: string; input?: unknown };
}

export interface SessionMessage {
  id: string;
  type: string;
  outcome?: SessionOutcome;
  content?: SessionMessageContentItem[];
  error?: ErrorInfo;
}

/** v2 `mcp` entry for `PUT /api/experimental/mcp/{name}` (`{config}`). */
export interface McpV2Config {
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
  timeout?: { execution: number };
  oauth?: { client_id: string; client_secret: string; scope?: string } | false;
}

/** One item of `GET /api/mcp` `data`. `status.status` is `connected`, `pending`, `disabled`, `failed` or `needs_auth`. */
export interface McpServerState {
  name: string;
  status: { status: string; error?: string };
  integrationID?: string;
}

export interface IntegrationMethod {
  id: string;
  type: string;
  label?: string;
}

/** A credential connection carries the id `DELETE /api/credential/{id}` takes; an env connection has only a variable name. */
export type IntegrationConnection = { type: 'credential'; id: string; label?: string; method?: string } | { type: 'env'; name: string };

/** One item of `GET /api/integration` `data` (no secrets). */
export interface IntegrationInfo {
  id: string;
  name: string;
  methods: IntegrationMethod[];
  connections: IntegrationConnection[];
}

export interface OAuthConnectRequest {
  methodID: string;
  answer?: Record<string, string>;
}

/** `data` of `POST /api/integration/{id}/connect/oauth`. `auto`: the server polls the provider itself. `code`: the user supplies a code. */
export interface OAuthAttempt {
  attemptID: string;
  url: string;
  instructions: string;
  mode: 'auto' | 'code';
}

/** `data` of `GET /api/integration/{id}/connect/oauth/{attemptID}`. */
export type OAuthAttemptStatus = { status: 'pending' | 'complete' | 'expired' } | { status: 'failed'; message?: string };

/** One item of `GET /api/model` `data`. */
export interface ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  enabled: boolean;
  status?: string;
}

/** v1-shaped OpenCode config document (`OPENCODE_CONFIG_CONTENT`; v2 normalises it). */
export interface Config {
  model?: string;
  small_model?: string;
  enabled_providers?: string[];
  disabled_providers?: string[];
  mcp?: Record<string, McpConfig>;
  provider?: Record<string, unknown>;
  experimental?: { todo?: boolean };
}

/** Message/part shapes carried inside `task_message` events. */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
}

export interface Part {
  type: string;
  text?: string;
}

export interface QuestionInfo {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  /** `false` hides the free-text "Others" answer. Absent means allowed. */
  custom?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionAnswer {
  labels: string[];
  customText?: string;
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
  azureFoundry?: string;
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
  | { type: 'get_mcp_status' }
  | { type: 'get_mcp_tools' }
  | { type: 'connect_mcp_server'; payload: { name: string } }
  | { type: 'disconnect_mcp_server'; payload: { name: string } }
  | { type: 'copilot_oauth_authorize'; enterpriseUrl?: string }
  | { type: 'copilot_get_models' }
  | { type: 'copilot_disconnect' }
  | { type: 'api_keys_response'; payload: ApiKeysResponsePayload }
  | { type: 'ping' }
  | { type: 'check_server' }
  | { type: 'shutdown' };

/**
 * Host reply to a `request_api_keys` event — the only IPC message carrying
 * key material, sent solely at server-spawn time (2026-06-12 review #5).
 */
export interface ApiKeysResponsePayload {
  requestId: string;
  apiKeys: ApiKeys;
  /** Host-computed fingerprint of `apiKeys` (the sidecar never hashes key material). */
  fingerprint: string;
}

export interface FolderPermission {
  path: string;
  accessLevel: 'read' | 'read-write';
  /** Source of the permission: 'user' (added via FoldersPanel), 'adhoc' (granted from permission prompt), or 'workspace' (auto from workspace folder) */
  source?: 'user' | 'adhoc' | 'workspace';
}

export interface StartTaskPayload {
  taskId: string;
  prompt: string;
  /**
   * Fingerprint of the host's current credential set — no key material.
   * The sidecar pulls actual keys via the `request_api_keys` event only
   * when this differs from the fingerprint it last applied
   * (technical review 2026-06-12 finding #5).
   */
  apiKeysFingerprint?: string;
  workingDirectory?: string;
  modelId?: string;
  folderPermissions?: FolderPermission[];
  customPrompt?: string;
  mcpServers?: Record<string, McpConfig>;
  /** Skip PATCH /config call (Arena sends config once, subsequent tasks skip) */
  skipConfig?: boolean;
  /** Arena ID — prevents cleanup of sibling sessions */
  arenaId?: string;
}

export interface ResumeSessionPayload {
  taskId: string;
  sessionId: string;
  prompt?: string;
  /** See {@link StartTaskPayload.apiKeysFingerprint}. */
  apiKeysFingerprint?: string;
  workingDirectory?: string;
  modelId?: string;
  folderPermissions?: FolderPermission[];
  customPrompt?: string;
  mcpServers?: Record<string, McpConfig>;
  /** Skip PATCH /config call (Arena sends config once, subsequent tasks skip) */
  skipConfig?: boolean;
  /** Arena ID — prevents cleanup of sibling sessions */
  arenaId?: string;
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
  | { type: 'mcp_status'; payload: McpStatusPayload }
  | { type: 'mcp_tools'; payload: McpToolsPayload }
  | { type: 'mcp_tools_changed'; payload: { server: string } }
  | { type: 'copilot_oauth_result'; payload: CopilotOAuthResultPayload }
  | { type: 'copilot_oauth_complete'; payload: CopilotOAuthCompletePayload }
  | { type: 'copilot_models_result'; payload: CopilotModelsResultPayload }
  | { type: 'request_api_keys'; payload: { requestId: string } }
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

export interface McpStatusPayload {
  servers: Record<string, { status: string; error?: string }>;
}

export interface McpToolsPayload {
  toolIds: string[];
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
