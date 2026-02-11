/**
 * Tauri API Interface
 *
 * This module provides the type-safe interface for the Tauri backend API
 * and wraps async event listeners into synchronous unlisteners.
 */

import type {
  ApiKeyConfig,
  BedrockCredentials,
  ConnectedProvider,
  McpServersConfig,
  PermissionRequest,
  PermissionResponse,
  ProviderId,
  ProviderSettings,
  Task,
  TaskConfig,
  TaskMessage,
  TaskProgress,
  TaskStatus,
  TaskUpdateEvent,
} from '@/shared';
import { getTauriApi, isRunningInTauri } from './tauri-api';

export interface TauriAPI {
  // App info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  getArch(): Promise<string>;

  // Shell
  openExternal(url: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;

  // Task operations
  startTask(config: TaskConfig): Promise<Task>;
  cancelTask(taskId: string): Promise<void>;
  abortSession(taskId: string, sessionId: string): Promise<void>;
  /** @deprecated Use abortSession instead */
  interruptTask?(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Promise<Task[]>;
  deleteTask(taskId: string): Promise<void>;
  clearTaskHistory(): Promise<void>;

  // Permission responses
  respondToPermission(response: PermissionResponse): Promise<void>;

  // Question responses
  replyToQuestion(taskId: string, requestId: string, answers: Array<{ labels: string[]; customText?: string }>): Promise<void>;

  // Session management
  resumeSession(sessionId: string, prompt: string, taskId?: string): Promise<Task>;

  // Settings
  getApiKeys(): Promise<ApiKeyConfig[]>;
  addApiKey(
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
  ): Promise<ApiKeyConfig>;
  removeApiKey(id: string): Promise<void>;
  getDebugMode(): Promise<boolean>;
  setDebugMode(enabled: boolean): Promise<void>;
  getUserPrompt(): Promise<{ enabled: boolean; text: string | null }>;
  setUserPrompt(enabled: boolean, text: string | null): Promise<void>;
  getAppSettings(): Promise<{
    debugMode: boolean;
    onboardingComplete: boolean;
  }>;

  // API Key management
  hasApiKey(): Promise<boolean>;
  setApiKey(key: string): Promise<void>;
  getApiKey(): Promise<string | null>;
  validateApiKey(key: string): Promise<{ valid: boolean; error?: string }>;
  validateApiKeyForProvider(provider: string, key: string, options?: Record<string, any>): Promise<{ valid: boolean; error?: string }>;
  clearApiKey(): Promise<void>;

  // Multi-provider API keys
  getAllApiKeys(): Promise<Record<string, { exists: boolean; prefix?: string }>>;
  hasAnyApiKey(): Promise<boolean>;

  // Onboarding
  getOnboardingComplete(): Promise<boolean>;
  setOnboardingComplete(complete: boolean): Promise<void>;

  // Claude CLI
  checkClaudeCli(): Promise<{
    installed: boolean;
    version: string | null;
    installCommand: string;
  }>;
  getClaudeVersion(): Promise<string | null>;

  // Model selection
  getSelectedModel(): Promise<{
    provider: string;
    model: string;
    baseUrl?: string;
    deploymentName?: string;
  } | null>;
  setSelectedModel(model: { provider: string; model: string; baseUrl?: string; deploymentName?: string }): Promise<void>;

  // Ollama configuration
  testOllamaConnection(url: string): Promise<{
    success: boolean;
    models?: Array<{ id: string; displayName: string; size: number }>;
    error?: string;
  }>;
  getOllamaConfig(): Promise<{
    baseUrl: string;
    enabled: boolean;
    lastValidated?: number;
    models?: Array<{ id: string; displayName: string; size: number }>;
  } | null>;
  setOllamaConfig(
    config: {
      baseUrl: string;
      enabled: boolean;
      lastValidated?: number;
      models?: Array<{ id: string; displayName: string; size: number }>;
    } | null
  ): Promise<void>;

  // Azure Foundry configuration
  getAzureFoundryConfig(): Promise<{
    baseUrl: string;
    deploymentName: string;
    authType: 'api-key' | 'entra-id';
    enabled: boolean;
    lastValidated?: number;
  } | null>;
  setAzureFoundryConfig(
    config: {
      baseUrl: string;
      deploymentName: string;
      authType: 'api-key' | 'entra-id';
      enabled: boolean;
      lastValidated?: number;
    } | null
  ): Promise<void>;
  testAzureFoundryConnection(config: {
    endpoint: string;
    deploymentName: string;
    authType: 'api-key' | 'entra-id';
    apiKey?: string;
  }): Promise<{ success: boolean; error?: string }>;
  saveAzureFoundryConfig(config: {
    endpoint: string;
    deploymentName: string;
    authType: 'api-key' | 'entra-id';
    apiKey?: string;
  }): Promise<void>;

  // OpenRouter configuration
  fetchOpenRouterModels(): Promise<{
    success: boolean;
    models?: Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number;
    }>;
    error?: string;
  }>;

  // LiteLLM configuration
  testLiteLLMConnection(
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
  }>;
  fetchLiteLLMModels(): Promise<{
    success: boolean;
    models?: Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number;
    }>;
    error?: string;
  }>;
  getLiteLLMConfig(): Promise<{
    baseUrl: string;
    enabled: boolean;
    lastValidated?: number;
    models?: Array<{
      id: string;
      name: string;
      provider: string;
      contextLength: number;
    }>;
  } | null>;
  setLiteLLMConfig(
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
  ): Promise<void>;

  // Bedrock configuration
  validateBedrockCredentials(credentials: BedrockCredentials): Promise<{ valid: boolean; error?: string }>;
  saveBedrockCredentials(credentials: BedrockCredentials): Promise<ApiKeyConfig>;
  getBedrockCredentials(): Promise<BedrockCredentials | null>;
  fetchBedrockModels(credentials: string): Promise<{
    success: boolean;
    models: Array<{ id: string; name: string; provider: string }>;
    error?: string;
  }>;

  // Theme
  getTheme(): Promise<string | null>;
  setTheme(themeId: string | null): Promise<void>;

  // MCP Servers
  getMcpServersConfig(): Promise<McpServersConfig | null>;
  setMcpServersConfig(config: McpServersConfig | null): Promise<void>;

  // E2E Testing
  isE2EMode(): Promise<boolean>;

  // Provider Settings API
  getProviderSettings(): Promise<ProviderSettings>;
  setActiveProvider(providerId: ProviderId | null): Promise<void>;
  getConnectedProvider(providerId: ProviderId): Promise<ConnectedProvider | null>;
  setConnectedProvider(providerId: ProviderId, provider: ConnectedProvider): Promise<void>;
  removeConnectedProvider(providerId: ProviderId): Promise<void>;
  updateProviderModel(providerId: ProviderId, modelId: string | null): Promise<void>;
  setProviderDebugMode(enabled: boolean): Promise<void>;
  getProviderDebugMode(): Promise<boolean>;

  // Event subscriptions
  onTaskUpdate(callback: (event: TaskUpdateEvent) => void): () => void;
  onTaskUpdateBatch?(callback: (event: { taskId: string; messages: TaskMessage[] }) => void): () => void;
  onPermissionRequest(callback: (request: PermissionRequest) => void): () => void;
  onTaskProgress(callback: (progress: TaskProgress) => void): () => void;
  onDebugLog(callback: (log: unknown) => void): () => void;
  onDebugModeChange?(callback: (data: { enabled: boolean }) => void): () => void;
  onTaskStatusChange?(callback: (data: { taskId: string; status: TaskStatus }) => void): () => void;
  onTaskSummary?(callback: (data: { taskId: string; summary: string }) => void): () => void;

  // Logging
  logEvent(payload: { level?: string; message: string; context?: Record<string, unknown> }): Promise<unknown>;
}

const toSyncUnlisten = (promise: Promise<() => void>) => {
  let unlisten: (() => void) | null = null;
  let pendingCancel = false;
  promise
    .then((fn) => {
      unlisten = fn;
      if (pendingCancel) {
        fn();
      }
    })
    .catch(() => {});
  return () => {
    if (unlisten) {
      unlisten();
    } else {
      pendingCancel = true;
    }
  };
};

/** Cached singleton so callers always receive a referentially stable object. */
let cachedTauriAPI: TauriAPI | null = null;

/**
 * Get the Tauri API interface.
 * Wraps async event listeners from getTauriApi() into synchronous unlisteners.
 * Returns a singleton so the reference is stable across React renders.
 */
export function getTauriAPI(): TauriAPI {
  if (cachedTauriAPI) return cachedTauriAPI;

  if (!isRunningInTauri()) {
    throw new Error('Tauri API not available - not running in Tauri');
  }

  const tauriApi = getTauriApi();

  cachedTauriAPI = {
    ...tauriApi,
    onTaskUpdate: (callback: (event: TaskUpdateEvent) => void) => toSyncUnlisten(tauriApi.onTaskUpdate(callback)),
    onTaskUpdateBatch: (callback: (event: { taskId: string; messages: TaskMessage[] }) => void) =>
      toSyncUnlisten(tauriApi.onTaskUpdateBatch(callback)),
    onPermissionRequest: (callback: (request: PermissionRequest) => void) => toSyncUnlisten(tauriApi.onPermissionRequest(callback)),
    onTaskProgress: (callback: (progress: TaskProgress) => void) => toSyncUnlisten(tauriApi.onTaskProgress(callback)),
    onDebugLog: (callback: (log: unknown) => void) => toSyncUnlisten(tauriApi.onDebugLog(callback)),
    onDebugModeChange: (callback: (data: { enabled: boolean }) => void) => toSyncUnlisten(tauriApi.onDebugModeChange(callback)),
    onTaskStatusChange: (callback: (data: { taskId: string; status: TaskStatus }) => void) =>
      toSyncUnlisten(tauriApi.onTaskStatusChange(callback)),
    onTaskSummary: (callback: (data: { taskId: string; summary: string }) => void) => toSyncUnlisten(tauriApi.onTaskSummary(callback)),
  };

  return cachedTauriAPI;
}
