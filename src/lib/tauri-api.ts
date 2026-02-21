/**
 * Tauri API - Interface to the Tauri Rust backend
 *
 * This module provides type-safe access to the Tauri commands
 * and event system, replacing the Electron preload script.
 */

import { invoke, convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

import type {
  ApiKeyConfig,
  BedrockCredentials,
  CompleteMessageEvent,
  ConnectedProvider,
  DirectoryEntry,
  FolderPermission,
  McpServersConfig,
  OpenCodeMessage,
  PartialMessageEvent,
  PermissionRequest,
  PermissionResponse,
  ProviderId,
  ProviderSettings,
  Task,
  TaskConfig,
  TaskMessage,
  TaskProgress,
  TaskResult,
  TaskStatus,
  TaskUpdateEvent,
  Todo,
  Workspace,
} from '@/shared';

// ============================================================================
// App Info
// ============================================================================

export async function getVersion(): Promise<string> {
  return invoke<string>('get_version');
}

export async function getPlatform(): Promise<string> {
  return invoke<string>('get_platform');
}

export async function getArch(): Promise<string> {
  return invoke<string>('get_arch');
}

// ============================================================================
// Shell
// ============================================================================

export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

export async function revealInFinder(path: string): Promise<void> {
  await revealItemInDir(path);
}

/** Open a local file with the OS default application. */
export async function openFilePath(path: string): Promise<void> {
  await openPath(path);
}

// ============================================================================
// Asset Protocol
// ============================================================================

/**
 * Convert a local file path to a URL that can be used by the webview
 * to load the file via Tauri's asset protocol.
 */
export function convertFileSrc(filePath: string): string {
  return tauriConvertFileSrc(filePath);
}

// ============================================================================
// File Preview
// ============================================================================

/**
 * Read UTF-8 text content from a file.
 * @param path Absolute file path
 * @param maxSize Maximum file size in bytes (default 1 MB)
 */
export async function readFileContent(path: string, maxSize?: number): Promise<string> {
  return invoke<string>('read_file_content', { path, maxSize });
}

/**
 * Read binary content from a file as a base64-encoded string.
 * Used for images, PDFs, and other binary formats.
 * @param path Absolute file path
 * @param maxSize Maximum file size in bytes (default 10 MB)
 */
export async function readBinaryFile(path: string, maxSize?: number): Promise<string> {
  return invoke<string>('read_binary_file', { path, maxSize });
}

// ============================================================================
// Dialog / Folder Picker
// ============================================================================

/**
 * Open a native folder picker dialog
 * @returns The selected folder path, or null if cancelled
 */
export async function pickFolder(): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    title: 'Select Folder',
  });
  return result as string | null;
}

/**
 * Open a native save-file dialog and write text content to the chosen path.
 * @returns The saved file path, or null if the user cancelled.
 */
export async function saveTextFile(
  contents: string,
  options?: { defaultPath?: string; title?: string; filters?: Array<{ name: string; extensions: string[] }> }
): Promise<string | null> {
  const path = await save({
    title: options?.title ?? 'Save File',
    defaultPath: options?.defaultPath,
    filters: options?.filters,
  });
  if (!path) return null;
  await invoke<void>('write_text_file', { path, contents });
  return path;
}

/**
 * Get the user's home directory path
 */
export async function getHomeDir(): Promise<string> {
  return homeDir();
}

// ============================================================================
// Task Operations
// ============================================================================

export async function startTask(config: TaskConfig): Promise<Task> {
  return invoke<Task>('start_task', { config });
}

export async function cancelTask(taskId: string): Promise<void> {
  return invoke<void>('cancel_task', { taskId });
}

/**
 * @deprecated Use abortSession instead. This now routes through cancel_task as a fallback.
 */
export async function interruptTask(taskId: string): Promise<void> {
  return invoke<void>('cancel_task', { taskId });
}

export async function getTask(taskId: string): Promise<Task | null> {
  return invoke<Task | null>('get_task', { taskId });
}

export async function listTasks(workspaceId?: string): Promise<Task[]> {
  return invoke<Task[]>('list_tasks', { workspaceId: workspaceId ?? null });
}

export async function deleteTask(taskId: string): Promise<void> {
  return invoke<void>('delete_task', { taskId });
}

export async function clearTaskHistory(): Promise<void> {
  return invoke<void>('clear_task_history');
}

// ============================================================================
// Task Persistence (for saving task updates to database)
// ============================================================================

export async function saveTaskMessage(taskId: string, message: TaskMessage): Promise<void> {
  return invoke<void>('save_task_message', { taskId, message });
}

export async function saveTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  return invoke<void>('save_task_status', { taskId, status });
}

export async function saveTaskSession(taskId: string, sessionId: string): Promise<void> {
  return invoke<void>('save_task_session', { taskId, sessionId });
}

export async function saveTaskSummary(taskId: string, summary: string): Promise<void> {
  return invoke<void>('save_task_summary', { taskId, summary });
}

// ============================================================================
// Folder Permissions
// ============================================================================

export async function saveFolderPermission(taskId: string, folderPath: string, accessLevel: string, source?: string): Promise<void> {
  return invoke<void>('save_folder_permission', { taskId, folderPath, accessLevel, source });
}

export async function getFolderPermissions(taskId: string): Promise<FolderPermission[]> {
  return invoke<FolderPermission[]>('get_folder_permissions', { taskId });
}

export async function removeFolderPermission(taskId: string, folderPath: string): Promise<void> {
  return invoke<void>('remove_folder_permission', { taskId, folderPath });
}

export async function getDefaultFolderPermissions(): Promise<FolderPermission[]> {
  return invoke<FolderPermission[]>('get_default_folder_permissions');
}

export async function completeTask(taskId: string, status: TaskStatus, sessionId?: string): Promise<void> {
  return invoke<void>('complete_task', { taskId, status, sessionId });
}

// ============================================================================
// Permission Responses
// ============================================================================

export async function respondToPermission(response: PermissionResponse): Promise<void> {
  return invoke<void>('respond_to_permission', { response });
}

// ============================================================================
// Question Responses
// ============================================================================

export async function replyToQuestion(
  taskId: string,
  requestId: string,
  answers: Array<{ labels: string[]; customText?: string }>
): Promise<void> {
  return invoke<void>('reply_to_question', { taskId, requestId, answers });
}

// ============================================================================
// Session Management
// ============================================================================

export async function resumeSession(sessionId: string, prompt: string, taskId?: string): Promise<Task> {
  return invoke<Task>('resume_session', { sessionId, prompt, taskId });
}

export async function abortSession(taskId: string, sessionId: string): Promise<void> {
  return invoke<void>('abort_session', { taskId, sessionId });
}

// ============================================================================
// Settings - API Keys
// ============================================================================

export async function getApiKeys(): Promise<ApiKeyConfig[]> {
  return invoke<ApiKeyConfig[]>('get_api_keys');
}

export async function addApiKey(
  provider:
    | 'anthropic'
    | 'openai'
    | 'openrouter'
    | 'google'
    | 'xai'
    | 'deepseek'
    | 'zai'
    | 'azure-foundry'
    | 'custom'
    | 'bedrock'
    | 'litellm',
  key: string,
  label?: string
): Promise<ApiKeyConfig> {
  return invoke<ApiKeyConfig>('add_api_key', { provider, key, label });
}

export async function removeApiKey(id: string): Promise<void> {
  return invoke<void>('remove_api_key', { id });
}

export async function getDebugMode(): Promise<boolean> {
  return invoke<boolean>('get_debug_mode');
}

export async function setDebugMode(enabled: boolean): Promise<void> {
  return invoke<void>('set_debug_mode', { enabled });
}

export async function getUserPrompt(): Promise<{ enabled: boolean; text: string | null }> {
  return invoke<{ enabled: boolean; text: string | null }>('get_user_prompt');
}

export async function setUserPrompt(enabled: boolean, text: string | null): Promise<void> {
  return invoke<void>('set_user_prompt', { enabled, text });
}

// ============================================================================
// MCP Servers
// ============================================================================

export async function getTheme(): Promise<string | null> {
  return invoke<string | null>('get_theme');
}

export async function setTheme(themeId: string | null): Promise<void> {
  return invoke<void>('set_theme', { themeId });
}

export async function getMcpServersConfig(): Promise<McpServersConfig | null> {
  return invoke<McpServersConfig | null>('get_mcp_servers_config');
}

export async function setMcpServersConfig(config: McpServersConfig | null): Promise<void> {
  return invoke<void>('set_mcp_servers_config', { config });
}

export async function getAppSettings(): Promise<{
  debugMode: boolean;
  onboardingComplete: boolean;
}> {
  return invoke<{ debugMode: boolean; onboardingComplete: boolean }>('get_app_settings');
}

// ============================================================================
// API Key Management
// ============================================================================

export async function hasApiKey(): Promise<boolean> {
  return invoke<boolean>('has_api_key');
}

export async function setApiKey(key: string): Promise<void> {
  return invoke<void>('set_api_key', { key });
}

export async function getApiKey(): Promise<string | null> {
  return invoke<string | null>('get_api_key');
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  return invoke<{ valid: boolean; error?: string }>('validate_api_key', {
    key,
  });
}

export async function validateApiKeyForProvider(
  provider: string,
  key: string,
  options?: Record<string, unknown>
): Promise<{ valid: boolean; error?: string }> {
  return invoke<{ valid: boolean; error?: string }>('validate_api_key_for_provider', { provider, key, options });
}

export async function clearApiKey(): Promise<void> {
  return invoke<void>('clear_api_key');
}

export async function getAllApiKeys(): Promise<Record<string, { exists: boolean; prefix?: string }>> {
  return invoke<Record<string, { exists: boolean; prefix?: string }>>('get_all_api_keys');
}

export async function hasAnyApiKey(): Promise<boolean> {
  return invoke<boolean>('has_any_api_key');
}

// ============================================================================
// Onboarding
// ============================================================================

export async function getOnboardingComplete(): Promise<boolean> {
  return invoke<boolean>('get_onboarding_complete');
}

export async function setOnboardingComplete(complete: boolean): Promise<void> {
  return invoke<void>('set_onboarding_complete', { complete });
}

// ============================================================================
// Claude CLI
// ============================================================================

export async function checkOpencodeCli(): Promise<{
  installed: boolean;
  version: string | null;
  installCommand: string;
}> {
  return invoke<{
    installed: boolean;
    version: string | null;
    installCommand: string;
  }>('check_opencode_cli');
}

export async function getOpencodeVersion(): Promise<string | null> {
  return invoke<string | null>('get_opencode_version');
}

// ============================================================================
// Model Selection
// ============================================================================

export async function getSelectedModel(): Promise<{
  provider: string;
  model: string;
  baseUrl?: string;
  deploymentName?: string;
} | null> {
  return invoke<{
    provider: string;
    model: string;
    baseUrl?: string;
    deploymentName?: string;
  } | null>('get_selected_model');
}

export async function setSelectedModel(model: {
  provider: string;
  model: string;
  baseUrl?: string;
  deploymentName?: string;
}): Promise<void> {
  return invoke<void>('set_selected_model', { model });
}

// ============================================================================
// Ollama Configuration
// ============================================================================

export async function testOllamaConnection(url: string): Promise<{
  success: boolean;
  models?: Array<{ id: string; displayName: string; size: number }>;
  error?: string;
}> {
  return invoke('test_ollama_connection', { url });
}

export async function getOllamaConfig(): Promise<{
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: Array<{ id: string; displayName: string; size: number }>;
} | null> {
  return invoke('get_ollama_config');
}

export async function setOllamaConfig(
  config: {
    baseUrl: string;
    enabled: boolean;
    lastValidated?: number;
    models?: Array<{ id: string; displayName: string; size: number }>;
  } | null
): Promise<void> {
  return invoke('set_ollama_config', { config });
}

// ============================================================================
// Azure Foundry Configuration
// ============================================================================

export async function getAzureFoundryConfig(): Promise<{
  baseUrl: string;
  deploymentName: string;
  authType: 'api-key' | 'entra-id';
  enabled: boolean;
  lastValidated?: number;
} | null> {
  return invoke('get_azure_foundry_config');
}

export async function setAzureFoundryConfig(
  config: {
    baseUrl: string;
    deploymentName: string;
    authType: 'api-key' | 'entra-id';
    enabled: boolean;
    lastValidated?: number;
  } | null
): Promise<void> {
  return invoke('set_azure_foundry_config', { config });
}

export async function testAzureFoundryConnection(config: {
  endpoint: string;
  deploymentName: string;
  authType: 'api-key' | 'entra-id';
  apiKey?: string;
}): Promise<{ success: boolean; error?: string }> {
  return invoke('test_azure_foundry_connection', { config });
}

export async function saveAzureFoundryConfig(config: {
  endpoint: string;
  deploymentName: string;
  authType: 'api-key' | 'entra-id';
  apiKey?: string;
}): Promise<void> {
  return invoke('save_azure_foundry_config', { config });
}

// ============================================================================
// Dynamic Provider Model Discovery
// ============================================================================

export async function fetchProviderModels(provider: string): Promise<{
  success: boolean;
  models?: Array<{
    id: string;
    name: string;
    provider: string;
    contextLength: number;
  }>;
  error?: string;
}> {
  return invoke('fetch_provider_models', { provider });
}

// ============================================================================
// LiteLLM Configuration
// ============================================================================

export async function testLiteLLMConnection(
  url: string,
  apiKey?: string
): Promise<{
  success: boolean;
  models?: Array<{
    id: string;
    name: string;
    provider: string;
    contextLength: number;
  }>;
  error?: string;
}> {
  return invoke('test_litellm_connection', { url, apiKey });
}

export async function fetchLiteLLMModels(): Promise<{
  success: boolean;
  models?: Array<{
    id: string;
    name: string;
    provider: string;
    contextLength: number;
  }>;
  error?: string;
}> {
  return invoke('fetch_litellm_models');
}

export async function getLiteLLMConfig(): Promise<{
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: Array<{
    id: string;
    name: string;
    provider: string;
    contextLength: number;
  }>;
} | null> {
  return invoke('get_litellm_config');
}

export async function setLiteLLMConfig(
  config: {
    baseUrl: string;
    enabled: boolean;
    lastValidated?: number;
    models?: Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number;
    }>;
  } | null
): Promise<void> {
  return invoke('set_litellm_config', { config });
}

// ============================================================================
// Bedrock Configuration
// ============================================================================

export async function validateBedrockCredentials(credentials: BedrockCredentials): Promise<{ valid: boolean; error?: string }> {
  return invoke('validate_bedrock_credentials', {
    credentials: JSON.stringify(credentials),
  });
}

export async function saveBedrockCredentials(credentials: BedrockCredentials): Promise<ApiKeyConfig> {
  return invoke('save_bedrock_credentials', {
    credentials: JSON.stringify(credentials),
  });
}

export async function getBedrockCredentials(): Promise<BedrockCredentials | null> {
  return invoke('get_bedrock_credentials');
}

export async function fetchBedrockModels(credentials: string): Promise<{
  success: boolean;
  models: Array<{ id: string; name: string; provider: string }>;
  error?: string;
}> {
  return invoke('fetch_bedrock_models', { credentials });
}

// ============================================================================
// E2E Testing
// ============================================================================

export async function isE2EMode(): Promise<boolean> {
  return invoke<boolean>('is_e2e_mode');
}

// ============================================================================
// Provider Settings API
// ============================================================================

type ConnectedProviderResponse = {
  id?: string;
  selectedModel?: string | null;
  config?: unknown;
};

type ProviderSettingsResponse = {
  activeProvider?: string | null;
  connectedProviders?: Record<string, ConnectedProviderResponse>;
  debugMode: boolean;
};

function isConnectedProviderShape(value: unknown): value is ConnectedProvider {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return 'providerId' in record && 'connectionStatus' in record && 'selectedModelId' in record && 'credentials' in record;
}

function normalizeConnectedProvider(key: string, raw: ConnectedProviderResponse): ConnectedProvider {
  const providerId = (raw.id ?? key) as ProviderId;
  const config = raw.config;
  let credentials = config as ConnectedProvider['credentials'] | null;
  let availableModels: ConnectedProvider['availableModels'] | undefined;

  if (config && typeof config === 'object' && 'credentials' in (config as Record<string, unknown>)) {
    const configRecord = config as {
      credentials?: ConnectedProvider['credentials'];
      availableModels?: ConnectedProvider['availableModels'];
    };
    credentials = configRecord.credentials ?? null;
    availableModels = configRecord.availableModels;
  }

  if (!credentials || typeof credentials !== 'object') {
    credentials = {
      type: 'api_key',
      keyPrefix: '',
    } as ConnectedProvider['credentials'];
  }

  return {
    providerId,
    connectionStatus: 'connected',
    selectedModelId: raw.selectedModel ?? null,
    credentials,
    lastConnectedAt: new Date().toISOString(),
    availableModels,
  };
}

export async function getProviderSettings(): Promise<ProviderSettings> {
  const data = await invoke<ProviderSettings | ProviderSettingsResponse>('get_provider_settings');
  const activeProviderId = ((data as ProviderSettings).activeProviderId ??
    (data as ProviderSettingsResponse).activeProvider ??
    null) as ProviderId | null;

  const connectedProviders: ProviderSettings['connectedProviders'] = {};
  if (data.connectedProviders) {
    for (const [key, raw] of Object.entries(data.connectedProviders)) {
      if (isConnectedProviderShape(raw)) {
        connectedProviders[key as ProviderId] = raw as ConnectedProvider;
      } else {
        connectedProviders[key as ProviderId] = normalizeConnectedProvider(key, raw as ConnectedProviderResponse);
      }
    }
  }

  return {
    activeProviderId,
    connectedProviders,
    debugMode: data.debugMode ?? false,
  };
}

export async function setActiveProvider(providerId: ProviderId | null): Promise<void> {
  return invoke<void>('set_active_provider', { providerId });
}

export async function getConnectedProvider(providerId: ProviderId): Promise<ConnectedProvider | null> {
  const data = await invoke<ConnectedProvider | { id?: string; selectedModel?: string | null; config?: unknown } | null>(
    'get_connected_provider',
    { providerId }
  );
  if (!data) return null;
  if (isConnectedProviderShape(data)) return data;
  return normalizeConnectedProvider(providerId, data);
}

export async function setConnectedProvider(providerId: ProviderId, provider: ConnectedProvider): Promise<void> {
  const connectedProviderInput = {
    id: provider.providerId,
    selectedModel: provider.selectedModelId ?? undefined,
    config: provider.credentials
      ? {
          credentials: provider.credentials,
          availableModels: provider.availableModels,
        }
      : undefined,
  };
  return invoke<void>('set_connected_provider', {
    providerId,
    provider: connectedProviderInput,
  });
}

export async function removeConnectedProvider(providerId: ProviderId): Promise<void> {
  return invoke<void>('remove_connected_provider', { providerId });
}

export async function updateProviderModel(providerId: ProviderId, modelId: string | null): Promise<void> {
  return invoke<void>('update_provider_model', { providerId, modelId });
}

export async function setProviderDebugMode(enabled: boolean): Promise<void> {
  return invoke<void>('set_provider_debug_mode', { enabled });
}

export async function getProviderDebugMode(): Promise<boolean> {
  return invoke<boolean>('get_provider_debug_mode');
}

// ============================================================================
// Event Subscriptions
// ============================================================================

const TASK_MESSAGE_TYPES = new Set(['assistant', 'user', 'tool', 'system'] as const);

function normalizeTimestamp(rawTimestamp?: number): string {
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
    return new Date(rawTimestamp).toISOString();
  }
  return new Date().toISOString();
}

function isTaskMessage(message: unknown): message is TaskMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  const content = (message as { content?: unknown }).content;
  return (
    typeof type === 'string' && TASK_MESSAGE_TYPES.has(type as 'assistant' | 'user' | 'tool' | 'system') && typeof content === 'string'
  );
}

function isOpenCodeMessage(message: unknown): message is OpenCodeMessage {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string';
}

function buildOpenCodeMessageId(message: OpenCodeMessage): string {
  const withPart = message as { part?: { messageID?: string; id?: string } };
  if (withPart.part?.messageID) return withPart.part.messageID;
  if (withPart.part?.id) return withPart.part.id;
  const fallbackTimestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
  return `opencode_${fallbackTimestamp}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOpenCodeMessage(message: OpenCodeMessage): TaskMessage | null {
  switch (message.type) {
    case 'text': {
      const textMessage = message as OpenCodeMessage & {
        part?: { text?: string };
      };
      const content = textMessage.part?.text ?? '';
      if (!content.trim()) {
        return null;
      }
      return {
        id: buildOpenCodeMessageId(message),
        type: 'assistant',
        content,
        timestamp: normalizeTimestamp(message.timestamp),
      };
    }
    case 'tool_call': {
      const toolMessage = message as OpenCodeMessage & {
        part?: { tool?: string; input?: unknown };
      };
      return {
        id: buildOpenCodeMessageId(message),
        type: 'tool',
        content: '',
        timestamp: normalizeTimestamp(message.timestamp),
        toolName: toolMessage.part?.tool,
        toolInput: toolMessage.part?.input,
      };
    }
    case 'tool_use': {
      const toolUseMessage = message as OpenCodeMessage & {
        part?: { tool?: string; state?: { input?: unknown; output?: string; title?: string } };
      };
      const toolOutput = toolUseMessage.part?.state?.output;
      return {
        id: buildOpenCodeMessageId(message),
        type: 'tool',
        content: '',
        timestamp: normalizeTimestamp(message.timestamp),
        toolName: toolUseMessage.part?.tool,
        toolInput: toolUseMessage.part?.state?.input,
        ...(typeof toolOutput === 'string' && toolOutput ? { toolOutput } : {}),
      };
    }
    default:
      return null;
  }
}

function normalizeIncomingMessage(message: unknown): TaskMessage | null {
  if (isTaskMessage(message)) {
    return message;
  }
  if (isOpenCodeMessage(message)) {
    return normalizeOpenCodeMessage(message);
  }
  return null;
}

function normalizeTaskCompletePayload(payload?: {
  result?: TaskResult;
  status?: string;
  sessionId?: string;
  error?: string;
}): TaskResult | null {
  if (!payload) {
    return null;
  }
  if (payload.result) {
    return payload.result;
  }
  if (!payload.status) {
    return null;
  }

  let normalizedStatus: TaskResult['status'];
  switch (payload.status) {
    case 'success':
      normalizedStatus = 'success';
      break;
    case 'aborted':
    case 'cancelled':
      normalizedStatus = 'interrupted';
      break;
    default:
      normalizedStatus = 'error';
  }

  return {
    status: normalizedStatus,
    sessionId: payload.sessionId,
    error: payload.error,
  };
}

export async function onTaskUpdate(callback: (event: TaskUpdateEvent) => void): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];
  const track = (unlisten: UnlistenFn) => {
    unlisteners.push(unlisten);
  };

  await Promise.all([
    listen<TaskUpdateEvent>('task:update', (event) => {
      if (event.payload?.type === 'message' && event.payload.message) {
        const normalized = normalizeIncomingMessage(event.payload.message);
        if (normalized) {
          callback({ ...event.payload, message: normalized });
        }
        return;
      }
      callback(event.payload);
    }).then(track),
    listen<{ taskId?: string; payload?: { message?: TaskMessage } }>('task:message', (event) => {
      const taskId = event.payload?.taskId;
      const message = event.payload?.payload?.message;
      if (taskId && message) {
        const normalized = normalizeIncomingMessage(message);
        if (!normalized) {
          return;
        }
        callback({ taskId, type: 'message', message: normalized });
      }
    }).then(track),
    listen<{ taskId?: string; payload?: { progress?: TaskProgress } }>('task:progress', (event) => {
      const taskId = event.payload?.taskId;
      const progress = event.payload?.payload?.progress;
      if (taskId && progress) {
        callback({ taskId, type: 'progress', progress });
      }
    }).then(track),
    listen<{
      taskId?: string;
      payload?: {
        result?: TaskResult;
        status?: string;
        sessionId?: string;
        error?: string;
      };
    }>('task:complete', (event) => {
      const taskId = event.payload?.taskId;
      const result = normalizeTaskCompletePayload(event.payload?.payload);
      if (taskId && result) {
        callback({ taskId, type: 'complete', result });
      }
    }).then(track),
    listen<{
      taskId?: string;
      payload?: { error?: unknown; sessionId?: string };
    }>('task:error', (event) => {
      const taskId = event.payload?.taskId;
      const errorPayload = event.payload?.payload?.error;
      const sessionId = event.payload?.payload?.sessionId;
      if (taskId && errorPayload !== undefined) {
        const error = typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload);
        callback({ taskId, type: 'error', error, sessionId });
      }
    }).then(track),
  ]);

  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}

export async function onTaskUpdateBatch(callback: (event: { taskId: string; messages: TaskMessage[] }) => void): Promise<UnlistenFn> {
  return listen<{ taskId: string; messages: TaskMessage[] }>('task:update-batch', (event) => callback(event.payload));
}

export async function onPermissionRequest(callback: (request: PermissionRequest) => void): Promise<UnlistenFn> {
  return listen<{
    taskId?: string;
    payload?: {
      id?: string;
      sessionId?: string;
      permission?: string;
      patterns?: string[];
      metadata?: Record<string, unknown>;
    };
  }>('task:permission_request', (event) => {
    const taskId = event.payload?.taskId;
    const payload = event.payload?.payload;
    if (taskId && payload?.id) {
      callback({
        id: payload.id,
        taskId,
        type: 'tool',
        toolName: payload.permission,
        patterns: payload.patterns,
        question: `Permission requested: ${payload.permission}`,
        createdAt: new Date().toISOString(),
      });
    }
  });
}

export interface QuestionRequestEvent {
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

export async function onQuestionRequest(callback: (event: QuestionRequestEvent) => void): Promise<UnlistenFn> {
  return listen<{
    taskId?: string;
    payload?: {
      id?: string;
      sessionId?: string;
      questions?: Array<{
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
    };
  }>('task:question_request', (event) => {
    const taskId = event.payload?.taskId;
    const payload = event.payload?.payload;
    if (taskId && payload?.id && payload.questions) {
      callback({
        taskId,
        requestId: payload.id,
        sessionId: payload.sessionId ?? '',
        questions: payload.questions,
      });
    }
  });
}

export async function onTaskProgress(callback: (progress: TaskProgress) => void): Promise<UnlistenFn> {
  return listen<TaskProgress>('task:progress', (event) => callback(event.payload));
}

export async function onDebugLog(callback: (log: unknown) => void): Promise<UnlistenFn> {
  // Listen on sidecar:log — Rust maps sidecar "log" events to "sidecar:log"
  // Payload shape from Rust: { taskId?, payload: { level, message } }
  // Transform to DebugLogEntry shape: { taskId, timestamp, type, message }
  return listen<{ taskId?: string; payload?: { level?: string; message?: string } }>('sidecar:log', (event) => {
    const raw = event.payload;
    const logPayload = raw?.payload;
    if (logPayload) {
      callback({
        taskId: raw?.taskId ?? 'system',
        timestamp: new Date().toISOString(),
        type: logPayload.level ?? 'info',
        message: logPayload.message ?? '',
      });
    }
  });
}

export async function onDebugModeChange(callback: (data: { enabled: boolean }) => void): Promise<UnlistenFn> {
  return listen<{ enabled: boolean }>('debug:mode-change', (event) => callback(event.payload));
}

export async function onTaskStatusChange(callback: (data: { taskId: string; status: TaskStatus }) => void): Promise<UnlistenFn> {
  return listen<{ taskId: string; status: TaskStatus }>('task:status-change', (event) => callback(event.payload));
}

export async function onTaskSummary(callback: (data: { taskId: string; summary: string }) => void): Promise<UnlistenFn> {
  return listen<{ taskId: string; summary: string }>('task:summary', (event) => callback(event.payload));
}

export async function onTaskMessagePartial(callback: (event: PartialMessageEvent) => void): Promise<UnlistenFn> {
  return listen<{
    taskId?: string;
    payload?: { messageId?: string; textSoFar?: string; isStreaming?: boolean };
  }>('task:message:partial', (event) => {
    const taskId = event.payload?.taskId;
    const payload = event.payload?.payload;
    if (taskId && payload?.messageId && payload.textSoFar !== undefined) {
      callback({
        taskId,
        messageId: payload.messageId,
        textSoFar: payload.textSoFar,
        isStreaming: payload.isStreaming ?? true,
      });
    }
  });
}

export async function onTaskMessageComplete(callback: (event: CompleteMessageEvent) => void): Promise<UnlistenFn> {
  return listen<{
    taskId?: string;
    payload?: { messageId?: string; text?: string };
  }>('task:message:complete', (event) => {
    const taskId = event.payload?.taskId;
    const payload = event.payload?.payload;
    if (taskId && payload?.messageId && payload.text !== undefined) {
      callback({
        taskId,
        messageId: payload.messageId,
        text: payload.text,
      });
    }
  });
}

// ============================================================================
// Todos
// ============================================================================

export async function getSessionTodos(taskId: string, sessionId: string): Promise<void> {
  return invoke<void>('get_session_todos', { taskId, sessionId });
}

export async function onTodoUpdated(callback: (event: { taskId: string; todos: Todo[] }) => void): Promise<UnlistenFn> {
  return listen<{ taskId?: string; payload?: { todos?: Todo[] } }>('task:todo_updated', (event) => {
    const taskId = event.payload?.taskId;
    const todos = event.payload?.payload?.todos;
    if (taskId && todos) {
      callback({ taskId, todos });
    }
  });
}

// ============================================================================
// App Updates
// ============================================================================

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_for_update');
}

export async function installUpdate(): Promise<void> {
  return invoke<void>('install_update');
}

// ============================================================================
// Logging
// ============================================================================

export async function logEvent(payload: { level?: string; message: string; context?: Record<string, unknown> }): Promise<unknown> {
  return invoke('log_event', { payload });
}

// ============================================================================
// Workspaces
// ============================================================================

export async function listWorkspaces(): Promise<Workspace[]> {
  return invoke<Workspace[]>('list_workspaces');
}

export async function getActiveWorkspace(): Promise<Workspace | null> {
  return invoke<Workspace | null>('get_active_workspace');
}

export async function addWorkspace(folderPath: string): Promise<Workspace> {
  return invoke<Workspace>('add_workspace', { folderPath });
}

export async function removeWorkspace(workspaceId: string): Promise<void> {
  return invoke<void>('remove_workspace', { workspaceId });
}

export async function switchWorkspace(workspaceId: string): Promise<Workspace> {
  return invoke<Workspace>('switch_workspace', { workspaceId });
}

export async function initializeWorkspace(): Promise<Workspace> {
  return invoke<Workspace>('initialize_workspace');
}

export async function readDirectory(path: string): Promise<DirectoryEntry[]> {
  return invoke<DirectoryEntry[]>('read_directory', { path });
}

export async function onWorkspaceChanged(callback: (data: { workspace: Workspace }) => void): Promise<UnlistenFn> {
  return listen<{ workspace: Workspace }>('workspace:changed', (e) => callback(e.payload));
}

export async function onWorkspaceFsChanged(callback: (data: { changedPath: string }) => void): Promise<UnlistenFn> {
  return listen<{ changedPath: string }>('workspace:fs_changed', (e) => callback(e.payload));
}

// ============================================================================
// Packs
// ============================================================================

export interface PackMeta {
  id: string;
  title: string;
  description: string;
  complexity: string;
  time_estimate: string;
  tags: string[];
}

export interface PackInstallResult {
  installed_path: string;
}

export async function listPacks(): Promise<PackMeta[]> {
  return invoke<PackMeta[]>('packs_list');
}

export async function installPack(packId: string, destinationDir: string): Promise<PackInstallResult> {
  return invoke<PackInstallResult>('packs_install', { packId, destinationDir });
}

export async function installPackDefault(packId: string): Promise<PackInstallResult> {
  return invoke<PackInstallResult>('packs_install_default', { packId });
}

// ============================================================================
// Skills
// ============================================================================

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface SkillStatus {
  installed: boolean;
  needs_update: boolean;
}

export interface SkillWithStatus {
  meta: SkillMeta;
  status: SkillStatus;
}

export async function listSkillsWithStatus(): Promise<SkillWithStatus[]> {
  return invoke<SkillWithStatus[]>('skills_list_with_status');
}

export async function installSkill(skillId: string): Promise<void> {
  return invoke<void>('skills_install', { skillId });
}

export async function getSkillTemplatePath(skillId: string): Promise<string> {
  return invoke<string>('skills_get_template_path', { skillId });
}

// ============================================================================
// Skills Manager
// ============================================================================

export interface SkillRepo {
  id: string;
  url: string;
  name: string;
  branch: string;
  hasAuthToken: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  skillCount: number;
}

export interface RepoSkill {
  repoId: string;
  repoName: string;
  skillPath: string;
  skillId: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
  needsUpdate: boolean;
}

export interface InstalledSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  sourceRepoUrl: string | null;
  sourceRepoName: string | null;
}

export interface SyncProgress {
  repoId: string;
  status: 'syncing' | 'synced' | 'error';
  error?: string;
}

export async function skillReposList(): Promise<SkillRepo[]> {
  return invoke<SkillRepo[]>('skill_repos_list');
}

export async function skillReposAdd(url: string, branch?: string, authToken?: string): Promise<SkillRepo> {
  return invoke<SkillRepo>('skill_repos_add', { url, branch, authToken });
}

export async function skillReposRemove(id: string): Promise<void> {
  return invoke<void>('skill_repos_remove', { id });
}

export async function skillReposSync(id: string): Promise<void> {
  return invoke<void>('skill_repos_sync', { id });
}

export async function skillReposSyncAll(): Promise<void> {
  return invoke<void>('skill_repos_sync_all');
}

export async function skillReposSkills(repoId?: string, targetFolder?: string): Promise<RepoSkill[]> {
  return invoke<RepoSkill[]>('skill_repos_skills', { repoId, targetFolder });
}

export async function skillsInstallFromRepo(repoId: string, skillPath: string, targetFolder?: string): Promise<void> {
  return invoke<void>('skills_install_from_repo', { repoId, skillPath, targetFolder });
}

export async function skillsListInstalled(targetFolder?: string): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>('skills_list_installed', { targetFolder });
}

export async function skillsDeleteInstalled(skillId: string, targetFolder?: string): Promise<void> {
  return invoke<void>('skills_delete_installed', { skillId, targetFolder });
}

export async function onSkillsChanged(callback: () => void): Promise<UnlistenFn> {
  return listen<void>('skills:changed', () => callback());
}

export async function onSkillsSyncProgress(callback: (progress: SyncProgress) => void): Promise<UnlistenFn> {
  return listen<SyncProgress>('skills:sync_progress', (event) => callback(event.payload));
}

// ============================================================================
// Copilot OAuth
// ============================================================================

export async function copilotOAuthAuthorize(enterpriseUrl?: string): Promise<void> {
  return invoke<void>('copilot_oauth_authorize', { enterpriseUrl: enterpriseUrl ?? null });
}

export async function copilotGetModels(): Promise<void> {
  return invoke<void>('copilot_get_models');
}

export async function copilotDisconnect(): Promise<void> {
  return invoke<void>('copilot_disconnect');
}

export async function onCopilotOAuthResult(
  callback: (result: { url: string; method: string; instructions: string }) => void
): Promise<UnlistenFn> {
  return listen<{ payload?: { url?: string; method?: string; instructions?: string } }>('copilot:oauth_result', (event) => {
    const payload = event.payload?.payload;
    if (payload?.url && payload.instructions) {
      callback({
        url: payload.url,
        method: payload.method ?? 'code',
        instructions: payload.instructions,
      });
    }
  });
}

export async function onCopilotOAuthComplete(callback: (result: { connected: boolean; error?: string }) => void): Promise<UnlistenFn> {
  return listen<{ payload?: { connected?: boolean; error?: string } }>('copilot:oauth_complete', (event) => {
    const payload = event.payload?.payload;
    if (payload) {
      callback({
        connected: payload.connected ?? false,
        error: payload.error,
      });
    }
  });
}

export async function onCopilotModelsResult(
  callback: (result: { success: boolean; models?: Array<{ id: string; name: string }>; error?: string }) => void
): Promise<UnlistenFn> {
  return listen<{ payload?: { success?: boolean; models?: Array<{ id: string; name: string }>; error?: string } }>(
    'copilot:models_result',
    (event) => {
      const payload = event.payload?.payload;
      if (payload) {
        callback({
          success: payload.success ?? false,
          models: payload.models,
          error: payload.error,
        });
      }
    }
  );
}

// ============================================================================
// Compatibility Helpers
// ============================================================================

/**
 * Check if running in Tauri shell
 */
export function isRunningInTauri(): boolean {
  const hasWindow = typeof window !== 'undefined';
  const hasTauri = hasWindow && '__TAURI__' in window;
  const hasTauriInternals = hasWindow && '__TAURI_INTERNALS__' in window;
  return hasTauri || hasTauriInternals;
}

/**
 * @deprecated Use isRunningInTauri instead
 */
export function isRunningInElectron(): boolean {
  return false;
}

/**
 * Get shell version if available
 */
export async function getShellVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}

/**
 * Get shell platform if available
 */
export async function getShellPlatform(): Promise<string | null> {
  try {
    return await getPlatform();
  } catch {
    return null;
  }
}

// ============================================================================
// API Object (for compatibility with existing code)
// ============================================================================

/**
 * Get the Tauri API object — bundles all individual Tauri command functions
 * into a single object for convenience.
 */
export function getTauriApi() {
  return {
    // App info
    getVersion,
    getPlatform,
    getArch,

    // Shell
    openExternal,
    openFilePath,
    revealInFinder,

    // Task operations
    startTask,
    cancelTask,
    abortSession,
    getTask,
    listTasks,
    deleteTask,
    clearTaskHistory,

    // Permission responses
    respondToPermission,

    // Question responses
    replyToQuestion,

    // Session management
    resumeSession,

    // Folder permissions
    saveFolderPermission,
    getFolderPermissions,
    removeFolderPermission,
    getDefaultFolderPermissions,

    // Settings
    getApiKeys,
    addApiKey,
    removeApiKey,
    getDebugMode,
    setDebugMode,
    getUserPrompt,
    setUserPrompt,
    getAppSettings,

    // API Key management
    hasApiKey,
    setApiKey,
    getApiKey,
    validateApiKey,
    validateApiKeyForProvider,
    clearApiKey,
    getAllApiKeys,
    hasAnyApiKey,

    // Onboarding
    getOnboardingComplete,
    setOnboardingComplete,

    // Claude CLI
    checkOpencodeCli,
    getOpencodeVersion,

    // Model selection
    getSelectedModel,
    setSelectedModel,

    // Ollama configuration
    testOllamaConnection,
    getOllamaConfig,
    setOllamaConfig,

    // Azure Foundry configuration
    getAzureFoundryConfig,
    setAzureFoundryConfig,
    testAzureFoundryConnection,
    saveAzureFoundryConfig,

    // Dynamic provider model discovery
    fetchProviderModels,

    // LiteLLM configuration
    testLiteLLMConnection,
    fetchLiteLLMModels,
    getLiteLLMConfig,
    setLiteLLMConfig,

    // Bedrock configuration
    validateBedrockCredentials,
    saveBedrockCredentials,
    getBedrockCredentials,
    fetchBedrockModels,

    // Theme
    getTheme,
    setTheme,

    // MCP Servers
    getMcpServersConfig,
    setMcpServersConfig,

    // E2E Testing
    isE2EMode,

    // Provider Settings API
    getProviderSettings,
    setActiveProvider,
    getConnectedProvider,
    setConnectedProvider,
    removeConnectedProvider,
    updateProviderModel,
    setProviderDebugMode,
    getProviderDebugMode,

    // Event subscriptions
    onTaskUpdate,
    onTaskUpdateBatch,
    onPermissionRequest,
    onQuestionRequest,
    onTaskProgress,
    onDebugLog,
    onDebugModeChange,
    onTaskStatusChange,
    onTaskSummary,
    onTaskMessagePartial,
    onTaskMessageComplete,

    // Logging
    logEvent,

    // Workspaces
    listWorkspaces,
    getActiveWorkspace,
    addWorkspace,
    removeWorkspace,
    switchWorkspace,
    initializeWorkspace,
    readDirectory,
    onWorkspaceChanged,
    onWorkspaceFsChanged,

    // Packs
    listPacks,
    installPack,
    installPackDefault,

    // Skills
    listSkillsWithStatus,
    installSkill,
    getSkillTemplatePath,

    // Skills Manager
    skillReposList,
    skillReposAdd,
    skillReposRemove,
    skillReposSync,
    skillReposSyncAll,
    skillReposSkills,
    skillsInstallFromRepo,
    skillsListInstalled,
    skillsDeleteInstalled,
    onSkillsChanged,
    onSkillsSyncProgress,

    // Copilot OAuth
    copilotOAuthAuthorize,
    copilotGetModels,
    copilotDisconnect,
    onCopilotOAuthResult,
    onCopilotOAuthComplete,
    onCopilotModelsResult,
  };
}
