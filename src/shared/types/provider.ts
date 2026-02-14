/**
 * Provider and model configuration types for multi-provider support
 */

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'xai'
  | 'ollama'
  | 'deepseek'
  | 'zai'
  | 'azure-foundry'
  | 'custom'
  | 'bedrock'
  | 'litellm';

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  models: ModelConfig[];
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

export interface ModelConfig {
  id: string; // e.g., "claude-sonnet-4-5"
  displayName: string; // e.g., "Claude Sonnet 4.5"
  provider: ProviderType;
  fullId: string; // e.g., "anthropic/claude-sonnet-4-5"
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
}

export interface SelectedModel {
  provider: ProviderType;
  model: string; // Full ID: "anthropic/claude-sonnet-4-5"
  baseUrl?: string; // For Ollama: the server URL, for Azure Foundry: the endpoint URL
  deploymentName?: string; // For Azure Foundry: the deployment name
}

/**
 * Ollama model info from API
 */
export interface OllamaModelInfo {
  id: string; // e.g., "qwen3:latest"
  displayName: string;
  size: number;
}

/**
 * Ollama server configuration
 */
export interface OllamaConfig {
  baseUrl: string;
  enabled: boolean;
  lastValidated?: number;
  models?: OllamaModelInfo[]; // Discovered models from Ollama API
}

/**
/**
 * Azure Foundry configuration
 */
export interface AzureFoundryConfig {
  baseUrl: string; // Azure Foundry endpoint URL
  deploymentName: string; // Deployment name
  authType: 'api-key' | 'entra-id'; // Authentication type
  enabled: boolean;
  lastValidated?: number;
}

/**
 * OpenRouter model info from API
 */
export interface OpenRouterModel {
  id: string; // e.g., "anthropic/claude-3.5-sonnet"
  name: string; // e.g., "Claude 3.5 Sonnet"
  provider: string; // e.g., "anthropic" (extracted from id)
  contextLength: number;
}

/**
 * OpenRouter configuration
 */
export interface OpenRouterConfig {
  models: OpenRouterModel[];
  lastFetched?: number;
}

/**
 * LiteLLM model info from API
 */
export interface LiteLLMModel {
  id: string; // e.g., "openai/gpt-4"
  name: string; // Display name (same as id for LiteLLM)
  provider: string; // Extracted from model ID
  contextLength: number;
}

/**
 * LiteLLM configuration
 */
export interface LiteLLMConfig {
  baseUrl: string; // e.g., "http://localhost:4000"
  enabled: boolean;
  lastValidated?: number;
  models?: LiteLLMModel[];
}

/**
 * Providers that support dynamic model discovery via their API.
 * When a user connects to one of these, the app fetches models from the provider's API.
 */
export const DYNAMIC_MODEL_PROVIDERS: ProviderType[] = ['anthropic', 'openai', 'google', 'xai', 'deepseek'];

/**
 * Fallback models used when dynamic model fetching fails (network error, API error).
 * These are the previously-hardcoded static model lists, keyed by provider.
 */
export const FALLBACK_MODELS: Partial<Record<ProviderType, Array<{ id: string; name: string }>>> = {
  anthropic: [
    { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5' },
  ],
  openai: [
    { id: 'openai/gpt-5.2-codex', name: 'GPT 5.2 Codex' },
    { id: 'openai/gpt-5.2', name: 'GPT 5.2' },
    { id: 'openai/gpt-5-mini', name: 'GPT 5 Mini' },
    { id: 'openai/gpt-5-codex', name: 'GPT 5 Codex' },
  ],
  google: [
    { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
    { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
  ],
  xai: [
    { id: 'xai/grok-4', name: 'Grok 4' },
    { id: 'xai/grok-3', name: 'Grok 3' },
  ],
  deepseek: [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (V3)' },
    { id: 'deepseek/deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
  ],
};

/**
 * Default providers and models.
 * Dynamic providers (Anthropic, OpenAI, Google, xAI, DeepSeek) have empty models arrays —
 * their models are fetched from the provider API at connect time.
 * Z.AI keeps its static model list.
 */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    requiresApiKey: true,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [], // Fetched dynamically
  },
  {
    id: 'openai',
    name: 'OpenAI',
    requiresApiKey: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [], // Fetched dynamically
  },
  {
    id: 'google',
    name: 'Google AI',
    requiresApiKey: true,
    apiKeyEnvVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    models: [], // Fetched dynamically
  },
  {
    id: 'xai',
    name: 'xAI',
    requiresApiKey: true,
    apiKeyEnvVar: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai',
    models: [], // Fetched dynamically
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    requiresApiKey: true,
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    models: [], // Fetched dynamically
  },
  {
    id: 'zai',
    name: 'Z.AI Coding Plan',
    requiresApiKey: true,
    apiKeyEnvVar: 'ZAI_API_KEY',
    baseUrl: 'https://open.bigmodel.cn',
    models: [
      {
        id: 'glm-4.7-flashx',
        displayName: 'GLM-4.7 FlashX (Latest)',
        provider: 'zai',
        fullId: 'zai/glm-4.7-flashx',
        contextWindow: 200_000,
        supportsVision: false,
      },
      {
        id: 'glm-4.7',
        displayName: 'GLM-4.7',
        provider: 'zai',
        fullId: 'zai/glm-4.7',
        contextWindow: 200_000,
        supportsVision: false,
      },
      {
        id: 'glm-4.7-flash',
        displayName: 'GLM-4.7 Flash',
        provider: 'zai',
        fullId: 'zai/glm-4.7-flash',
        contextWindow: 200_000,
        supportsVision: false,
      },
      {
        id: 'glm-4.6',
        displayName: 'GLM-4.6',
        provider: 'zai',
        fullId: 'zai/glm-4.6',
        contextWindow: 200_000,
        supportsVision: false,
      },
      {
        id: 'glm-4.5-flash',
        displayName: 'GLM-4.5 Flash',
        provider: 'zai',
        fullId: 'zai/glm-4.5-flash',
        contextWindow: 128_000,
        supportsVision: false,
      },
    ],
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    requiresApiKey: false, // Uses AWS credentials
    models: [], // Now fetched dynamically from AWS API
  },
];

export const DEFAULT_MODEL: SelectedModel = {
  provider: 'anthropic',
  model: 'anthropic/claude-opus-4-5',
};
