/**
 * Tauri API - Interface to the Tauri Rust backend
 *
 * This module provides type-safe access to the Tauri commands
 * and event system, replacing the Electron preload script.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

import type {
  Task,
  TaskConfig,
  TaskUpdateEvent,
  TaskStatus,
  PermissionRequest,
  PermissionResponse,
  TaskProgress,
  TaskResult,
  ApiKeyConfig,
  TaskMessage,
  BedrockCredentials,
  ProviderSettings,
  ProviderId,
  ConnectedProvider,
  OpenCodeMessage,
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

// ============================================================================
// Shell
// ============================================================================

export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
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

export async function interruptTask(taskId: string): Promise<void> {
  return invoke<void>('interrupt_task', { taskId });
}

export async function getTask(taskId: string): Promise<Task | null> {
  return invoke<Task | null>('get_task', { taskId });
}

export async function listTasks(): Promise<Task[]> {
  return invoke<Task[]>('list_tasks');
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
// Session Management
// ============================================================================

export async function resumeSession(sessionId: string, prompt: string, taskId?: string): Promise<Task> {
  return invoke<Task>('resume_session', { sessionId, prompt, taskId });
}

// ============================================================================
// Settings - API Keys
// ============================================================================

export async function getApiKeys(): Promise<ApiKeyConfig[]> {
  return invoke<ApiKeyConfig[]>('get_api_keys');
}

export async function addApiKey(
  provider: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'xai' | 'deepseek' | 'zai' | 'azure-foundry' | 'custom' | 'bedrock' | 'litellm',
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

export async function getAppSettings(): Promise<{ debugMode: boolean; onboardingComplete: boolean }> {
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
  return invoke<{ valid: boolean; error?: string }>('validate_api_key', { key });
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

export async function checkClaudeCli(): Promise<{ installed: boolean; version: string | null; installCommand: string }> {
  return invoke<{ installed: boolean; version: string | null; installCommand: string }>('check_claude_cli');
}

export async function getClaudeVersion(): Promise<string | null> {
  return invoke<string | null>('get_claude_version');
}

// ============================================================================
// Model Selection
// ============================================================================

export async function getSelectedModel(): Promise<{ provider: string; model: string; baseUrl?: string; deploymentName?: string } | null> {
  return invoke<{ provider: string; model: string; baseUrl?: string; deploymentName?: string } | null>('get_selected_model');
}

export async function setSelectedModel(model: { provider: string; model: string; baseUrl?: string; deploymentName?: string }): Promise<void> {
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

export async function setOllamaConfig(config: {
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: Array<{ id: string; displayName: string; size: number }>;
} | null): Promise<void> {
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

export async function setAzureFoundryConfig(config: {
  baseUrl: string;
  deploymentName: string;
  authType: 'api-key' | 'entra-id';
  enabled: boolean;
  lastValidated?: number;
} | null): Promise<void> {
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
// OpenRouter Configuration
// ============================================================================

export async function fetchOpenRouterModels(): Promise<{
  success: boolean;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
  error?: string;
}> {
  return invoke('fetch_openrouter_models');
}

// ============================================================================
// LiteLLM Configuration
// ============================================================================

export async function testLiteLLMConnection(url: string, apiKey?: string): Promise<{
  success: boolean;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
  error?: string;
}> {
  return invoke('test_litellm_connection', { url, apiKey });
}

export async function fetchLiteLLMModels(): Promise<{
  success: boolean;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
  error?: string;
}> {
  return invoke('fetch_litellm_models');
}

export async function getLiteLLMConfig(): Promise<{
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
} | null> {
  return invoke('get_litellm_config');
}

export async function setLiteLLMConfig(config: {
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: Array<{ id: string; name: string; provider: string; contextLength: number }>;
} | null): Promise<void> {
  return invoke('set_litellm_config', { config });
}

// ============================================================================
// Bedrock Configuration
// ============================================================================

export async function validateBedrockCredentials(credentials: BedrockCredentials): Promise<{ valid: boolean; error?: string }> {
  return invoke('validate_bedrock_credentials', { credentials: JSON.stringify(credentials) });
}

export async function saveBedrockCredentials(credentials: BedrockCredentials): Promise<ApiKeyConfig> {
  return invoke('save_bedrock_credentials', { credentials: JSON.stringify(credentials) });
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

type ConnectedProviderResponse = { id?: string; selectedModel?: string | null; config?: unknown };

type ProviderSettingsResponse = {
  activeProvider?: string | null;
  connectedProviders?: Record<string, ConnectedProviderResponse>;
  debugMode: boolean;
};

function isConnectedProviderShape(value: unknown): value is ConnectedProvider {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    'providerId' in record &&
    'connectionStatus' in record &&
    'selectedModelId' in record &&
    'credentials' in record
  );
}

function normalizeConnectedProvider(key: string, raw: ConnectedProviderResponse): ConnectedProvider {
  const providerId = (raw.id ?? key) as ProviderId;
  const config = raw.config;
  let credentials = config as ConnectedProvider['credentials'] | null;
  let availableModels: ConnectedProvider['availableModels'] | undefined;

  if (config && typeof config === 'object' && 'credentials' in (config as Record<string, unknown>)) {
    const configRecord = config as { credentials?: ConnectedProvider['credentials']; availableModels?: ConnectedProvider['availableModels'] };
    credentials = configRecord.credentials ?? null;
    availableModels = configRecord.availableModels;
  }

  if (!credentials || typeof credentials !== 'object') {
    credentials = { type: 'api_key', keyPrefix: '' } as ConnectedProvider['credentials'];
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
  const activeProviderId = ((data as ProviderSettings).activeProviderId ?? (data as ProviderSettingsResponse).activeProvider ?? null) as ProviderId | null;

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
    config: provider.credentials ? {
      credentials: provider.credentials,
      availableModels: provider.availableModels,
    } : undefined,
  };
  return invoke<void>('set_connected_provider', { providerId, provider: connectedProviderInput });
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
  return typeof type === 'string' && TASK_MESSAGE_TYPES.has(type as 'assistant' | 'user' | 'tool' | 'system') && typeof content === 'string';
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
      const textMessage = message as OpenCodeMessage & { part?: { text?: string } };
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
      const toolMessage = message as OpenCodeMessage & { part?: { tool?: string; input?: unknown } };
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
      const toolUseMessage = message as OpenCodeMessage & { part?: { tool?: string; state?: { input?: unknown } } };
      return {
        id: buildOpenCodeMessageId(message),
        type: 'tool',
        content: '',
        timestamp: normalizeTimestamp(message.timestamp),
        toolName: toolUseMessage.part?.tool,
        toolInput: toolUseMessage.part?.state?.input,
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
    listen<{ taskId?: string; payload?: { result?: TaskResult } }>('task:complete', (event) => {
      const taskId = event.payload?.taskId;
      const result = event.payload?.payload?.result;
      if (taskId && result) {
        callback({ taskId, type: 'complete', result });
      }
    }).then(track),
    listen<{ taskId?: string; payload?: { error?: unknown } }>('task:error', (event) => {
      const taskId = event.payload?.taskId;
      const errorPayload = event.payload?.payload?.error;
      if (taskId && errorPayload !== undefined) {
        const error = typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload);
        callback({ taskId, type: 'error', error });
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
  return listen<PermissionRequest>('permission:request', (event) => callback(event.payload));
}

export async function onTaskProgress(callback: (progress: TaskProgress) => void): Promise<UnlistenFn> {
  return listen<TaskProgress>('task:progress', (event) => callback(event.payload));
}

export async function onDebugLog(callback: (log: unknown) => void): Promise<UnlistenFn> {
  return listen<unknown>('debug:log', (event) => callback(event.payload));
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

// ============================================================================
// Logging
// ============================================================================

export async function logEvent(payload: { level?: string; message: string; context?: Record<string, unknown> }): Promise<unknown> {
  return invoke('log_event', { payload });
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
 * Get the Tauri API object
 * Provides a similar interface to the old accomplish API
 */
export function getTauriApi() {
  return {
    // App info
    getVersion,
    getPlatform,

    // Shell
    openExternal,

    // Task operations
    startTask,
    cancelTask,
    interruptTask,
    getTask,
    listTasks,
    deleteTask,
    clearTaskHistory,

    // Permission responses
    respondToPermission,

    // Session management
    resumeSession,

    // Settings
    getApiKeys,
    addApiKey,
    removeApiKey,
    getDebugMode,
    setDebugMode,
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
    checkClaudeCli,
    getClaudeVersion,

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

    // OpenRouter configuration
    fetchOpenRouterModels,

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
    onTaskProgress,
    onDebugLog,
    onDebugModeChange,
    onTaskStatusChange,
    onTaskSummary,

    // Logging
    logEvent,
  };
}

/**
 * @deprecated Use getTauriApi or import individual functions instead
 */
export function getAccomplish() {
  return getTauriApi();
}

/**
 * @deprecated Use getTauriApi or import individual functions instead
 */
export function useAccomplish() {
  return getTauriApi();
}
