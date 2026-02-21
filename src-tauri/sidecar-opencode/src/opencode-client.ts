import { logger } from './logger';
import type { Config, HealthResponse, Message, Part, PermissionRequest, QuestionAnswer, QuestionRequest, Session, Todo } from './types';

export interface OpenCodeClientOptions {
  baseUrl?: string;
  port?: number;
  timeout?: number;
  /** Server password for HTTP basic auth. When set, all requests include an Authorization header. */
  password?: string;
}

export class OpenCodeClient {
  private baseUrl: string;
  private timeout: number;
  private authHeader?: string;

  constructor(options: OpenCodeClientOptions = {}) {
    const port = options.port ?? 4096;
    this.baseUrl = options.baseUrl ?? `http://127.0.0.1:${port}`;
    this.timeout = options.timeout ?? 30_000;
    if (options.password) {
      this.authHeader = `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}`;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    queryParams?: Record<string, string>,
    options?: { timeout?: number }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    const effectiveTimeout = options?.timeout ?? this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (this.authHeader) headers['Authorization'] = this.authHeader;

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const responseBody = await response.json().catch(() => null);
      logger.httpResponse(method, path, response.status, responseBody);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(responseBody)}`);
      }

      return responseBody as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // Health & Server Management
  // ============================================================================

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/global/health');
  }

  async isServerRunning(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  async disposeGlobal(): Promise<boolean> {
    return this.request<boolean>('POST', '/global/dispose');
  }

  async disposeInstance(directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', '/instance/dispose', undefined, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async getConfig(directory?: string): Promise<Config> {
    return this.request<Config>('GET', '/config', undefined, directory ? { directory } : undefined);
  }

  async updateConfig(config: Partial<Config>, directory?: string): Promise<Config> {
    return this.request<Config>('PATCH', '/config', config, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  async listSessions(options?: { directory?: string; roots?: boolean; limit?: number }): Promise<Session[]> {
    const params: Record<string, string> = {};
    if (options?.directory) params.directory = options.directory;
    if (options?.roots) params.roots = 'true';
    if (options?.limit) params.limit = String(options.limit);
    return this.request<Session[]>('GET', '/session', undefined, params);
  }

  async createSession(options?: { directory?: string; parentID?: string; title?: string; permission?: unknown }): Promise<Session> {
    const params = options?.directory ? { directory: options.directory } : undefined;
    const body = {
      parentID: options?.parentID,
      title: options?.title,
      permission: options?.permission,
    };
    return this.request<Session>('POST', '/session', body, params);
  }

  async getSession(sessionId: string, directory?: string): Promise<Session> {
    return this.request<Session>('GET', `/session/${sessionId}`, undefined, directory ? { directory } : undefined);
  }

  async deleteSession(sessionId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('DELETE', `/session/${sessionId}`, undefined, directory ? { directory } : undefined);
  }

  async abortSession(sessionId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/session/${sessionId}/abort`, undefined, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Todos
  // ============================================================================

  async getSessionTodos(sessionId: string, directory?: string): Promise<Todo[]> {
    return this.request<Todo[]>('GET', `/session/${sessionId}/todo`, undefined, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Messages
  // ============================================================================

  async getMessages(sessionId: string, options?: { directory?: string; limit?: number }): Promise<Array<{ info: Message; parts: Part[] }>> {
    const params: Record<string, string> = {};
    if (options?.directory) params.directory = options.directory;
    if (options?.limit) params.limit = String(options.limit);
    return this.request('GET', `/session/${sessionId}/message`, undefined, params);
  }

  async sendMessage(
    sessionId: string,
    options: {
      parts: Array<{ type: 'text'; text: string }>;
      directory?: string;
      model?: { providerID: string; modelID: string };
      agent?: string;
      /** System prompt override — injected directly, bypassing agent resolution. */
      system?: string;
    }
  ): Promise<{ info: Message; parts: Part[] }> {
    const params = options.directory ? { directory: options.directory } : undefined;
    // sendMessage is a long-running request: OpenCode blocks until the full agent
    // turn completes (which may include permission waits, tool execution, etc.).
    // Use a 10-minute timeout instead of the default 30 seconds.
    return this.request(
      'POST',
      `/session/${sessionId}/message`,
      {
        parts: options.parts,
        model: options.model,
        agent: options.agent,
        system: options.system,
      },
      params,
      { timeout: 10 * 60 * 1000 }
    );
  }

  // ============================================================================
  // Permissions
  // ============================================================================

  async listPermissions(directory?: string): Promise<PermissionRequest[]> {
    return this.request<PermissionRequest[]>('GET', '/permission', undefined, directory ? { directory } : undefined);
  }

  async replyToPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    options?: { directory?: string; message?: string }
  ): Promise<boolean> {
    const params = options?.directory ? { directory: options.directory } : undefined;
    return this.request<boolean>(
      'POST',
      `/permission/${requestId}/reply`,
      {
        reply,
        message: options?.message,
      },
      params
    );
  }

  // ============================================================================
  // Questions
  // ============================================================================

  async listQuestions(directory?: string): Promise<QuestionRequest[]> {
    return this.request<QuestionRequest[]>('GET', '/question', undefined, directory ? { directory } : undefined);
  }

  async replyToQuestion(requestId: string, answers: QuestionAnswer[], directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/question/${requestId}/reply`, { answers }, directory ? { directory } : undefined);
  }

  async rejectQuestion(requestId: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/question/${requestId}/reject`, undefined, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Provider OAuth & Discovery
  // ============================================================================

  async oauthAuthorize(providerID: string, method = 0): Promise<{ url: string; method: string; instructions: string }> {
    return this.request('POST', `/provider/${providerID}/oauth/authorize`, { method });
  }

  async oauthCallback(providerID: string, method = 0, code?: string): Promise<boolean> {
    return this.request('POST', `/provider/${providerID}/oauth/callback`, { method, code }, undefined, { timeout: 10 * 60 * 1000 });
  }

  async listProviders(
    directory?: string
  ): Promise<{ all: Array<{ id: string; models?: Record<string, { name?: string }> }>; connected: string[] }> {
    return this.request('GET', '/provider', undefined, directory ? { directory } : undefined);
  }

  async deleteAuth(providerID: string): Promise<boolean> {
    return this.request<boolean>('DELETE', `/auth/${providerID}`);
  }
}
