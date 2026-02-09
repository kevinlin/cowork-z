export interface McpOAuthConfig {
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface McpServerConfig {
  type: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | false;
  timeout?: number;
}

export type McpServersConfig = Record<string, McpServerConfig>;
