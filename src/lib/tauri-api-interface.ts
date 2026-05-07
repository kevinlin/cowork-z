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
  DirectoryEntry,
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
  Workspace,
} from '@/shared';
import type { InstalledSkill, PackInstallResult, PackMeta, RepoSkill, SkillRepo, SkillWithStatus, SyncProgress } from './tauri-api';
import { getTauriApi, isRunningInTauri } from './tauri-api';

export interface TauriAPI {
  // App info
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  getArch(): Promise<string>;

  // Shell
  openExternal(url: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;

  // File operations
  trashFile(path: string): Promise<void>;

  // Task operations
  startTask(config: TaskConfig): Promise<Task>;
  cancelTask(taskId: string): Promise<void>;
  abortSession(taskId: string, sessionId: string): Promise<void>;
  /** @deprecated Use abortSession instead */
  interruptTask?(taskId: string): Promise<void>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(workspaceId?: string): Promise<Task[]>;
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
  checkOpencodeCli(): Promise<{
    installed: boolean;
    version: string | null;
    installCommand: string;
  }>;
  getOpencodeVersion(): Promise<string | null>;

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

  // Dynamic provider model discovery
  fetchProviderModels(provider: string): Promise<{
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
  getMcpStatus(): Promise<void>;
  getMcpTools(): Promise<void>;
  connectMcpServer(name: string): Promise<void>;
  disconnectMcpServer(name: string): Promise<void>;
  onMcpStatus(callback: (data: { servers: Record<string, { status: string; error?: string }> }) => void): () => void;
  onMcpTools(callback: (data: { toolIds: string[] }) => void): () => void;
  onMcpToolsChanged(callback: (data: { server: string }) => void): () => void;

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

  // Workspaces
  listWorkspaces(): Promise<Workspace[]>;
  getActiveWorkspace(): Promise<Workspace | null>;
  addWorkspace(folderPath: string): Promise<Workspace>;
  removeWorkspace(workspaceId: string): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<Workspace>;
  initializeWorkspace(): Promise<Workspace>;
  readDirectory(path: string): Promise<DirectoryEntry[]>;
  onWorkspaceChanged?(callback: (data: { workspace: Workspace }) => void): () => void;
  onWorkspaceFsChanged?(callback: (data: { changedPath: string }) => void): () => void;

  // Packs
  listPacks(): Promise<PackMeta[]>;
  installPack(packId: string, destinationDir: string): Promise<PackInstallResult>;
  installPackDefault(packId: string): Promise<PackInstallResult>;

  // Skills
  listSkillsWithStatus(): Promise<SkillWithStatus[]>;
  getSkillFilePath(skillId: string, workspacePath?: string): Promise<string>;

  // Skills Manager
  skillReposList(): Promise<SkillRepo[]>;
  skillReposAdd(url: string, branch?: string, authToken?: string): Promise<SkillRepo>;
  skillReposRemove(id: string): Promise<void>;
  skillReposSync(id: string): Promise<void>;
  skillReposSyncAll(): Promise<void>;
  skillReposSkills(repoId?: string, targetFolder?: string): Promise<RepoSkill[]>;
  skillsInstallFromRepo(repoId: string, skillPath: string, targetFolder?: string): Promise<void>;
  skillsListInstalled(targetFolder?: string): Promise<InstalledSkill[]>;
  skillsDeleteInstalled(skillId: string, targetFolder?: string): Promise<void>;
  onSkillsChanged(callback: () => void): () => void;
  onSkillsSyncProgress(callback: (progress: SyncProgress) => void): () => void;

  // Copilot OAuth
  copilotOAuthAuthorize(enterpriseUrl?: string): Promise<void>;
  copilotGetModels(): Promise<void>;
  copilotDisconnect(): Promise<void>;
  onCopilotOAuthResult(callback: (result: { url: string; method: string; instructions: string }) => void): () => void;
  onCopilotOAuthComplete(callback: (result: { connected: boolean; error?: string }) => void): () => void;
  onCopilotModelsResult(
    callback: (result: { success: boolean; models?: Array<{ id: string; name: string }>; error?: string }) => void
  ): () => void;

  // Automations
  createAutomation(input: import('@/shared').CreateAutomationInput): Promise<import('@/shared').Automation>;
  updateAutomation(input: import('@/shared').UpdateAutomationInput): Promise<void>;
  deleteAutomation(id: string): Promise<void>;
  listAutomations(workspaceId?: string): Promise<import('@/shared').Automation[]>;
  getAutomation(id: string): Promise<import('@/shared').Automation | null>;
  toggleAutomationEnabled(id: string, enabled: boolean): Promise<void>;
  listAutomationRuns(workspaceId: string, unreadOnly: boolean): Promise<import('@/shared').AutomationRun[]>;
  markRunRead(runId: string): Promise<void>;
  markAllRunsRead(workspaceId: string): Promise<void>;
  getAutomationUnreadCount(workspaceId: string): Promise<number>;
  runAutomationNow(automationId: string): Promise<void>;
  onAutomationRunStarted(callback: (event: { automationId: string; runId: string }) => void): () => void;
  onAutomationRunCompleted(callback: (event: { runId: string; hasFindings: boolean; status: string }) => void): () => void;
  onAutomationChanged(callback: (event: { automationId: string; action: string }) => void): () => void;
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
    onWorkspaceChanged: (callback: (data: { workspace: Workspace }) => void) => toSyncUnlisten(tauriApi.onWorkspaceChanged(callback)),
    onWorkspaceFsChanged: (callback: (data: { changedPath: string }) => void) => toSyncUnlisten(tauriApi.onWorkspaceFsChanged(callback)),
    onSkillsChanged: (callback: () => void) => toSyncUnlisten(tauriApi.onSkillsChanged(callback)),
    onSkillsSyncProgress: (callback: (progress: SyncProgress) => void) => toSyncUnlisten(tauriApi.onSkillsSyncProgress(callback)),
    onCopilotOAuthResult: (callback: (result: { url: string; method: string; instructions: string }) => void) =>
      toSyncUnlisten(tauriApi.onCopilotOAuthResult(callback)),
    onCopilotOAuthComplete: (callback: (result: { connected: boolean; error?: string }) => void) =>
      toSyncUnlisten(tauriApi.onCopilotOAuthComplete(callback)),
    onCopilotModelsResult: (
      callback: (result: { success: boolean; models?: Array<{ id: string; name: string }>; error?: string }) => void
    ) => toSyncUnlisten(tauriApi.onCopilotModelsResult(callback)),
    onMcpStatus: (callback: (data: { servers: Record<string, { status: string; error?: string }> }) => void) =>
      toSyncUnlisten(tauriApi.onMcpStatus(callback)),
    onMcpTools: (callback: (data: { toolIds: string[] }) => void) => toSyncUnlisten(tauriApi.onMcpTools(callback)),
    onMcpToolsChanged: (callback: (data: { server: string }) => void) => toSyncUnlisten(tauriApi.onMcpToolsChanged(callback)),
  };

  return cachedTauriAPI;
}
