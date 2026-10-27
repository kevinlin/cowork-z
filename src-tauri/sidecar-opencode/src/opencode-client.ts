import { logger } from './logger';
import type {
  Config,
  FormAnswer,
  FormInfo,
  McpV2Config,
  ModelRef,
  PermissionAsk,
  PermissionRule,
  ServerInfo,
  SessionInfo,
  SessionMessage,
} from './types';

export interface OpenCodeClientOptions {
  baseUrl?: string;
  port?: number;
  timeout?: number;
  /** Server password for HTTP basic auth. When set, all requests include an Authorization header. */
  password?: string;
}

/** A 2xx `text/html` response: OpenCode serves its web UI for paths it has no API route for (e.g. `/api/info` on a 1.x server). */
export class OpenCodeRouteNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeRouteNotFoundError';
  }
}

/**
 * A non-2xx HTTP response from OpenCode. Distinguishes "the server answered and refused"
 * (`status` set) from a transport failure (timeout, socket reset), which stays a plain Error.
 */
export class OpenCodeHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${JSON.stringify(body)}`);
    this.name = 'OpenCodeHttpError';
    this.status = status;
    this.body = body;
  }
}

type QueryScalar = string | number | boolean | null | undefined;
export type QueryValue = QueryScalar | Record<string, QueryScalar>;

/**
 * Serialise query parameters. Object values use the OpenAPI `deepObject` style that v2's
 * location-scoped routes declare: `{location: {directory: '/ws'}}` → `location[directory]=%2Fws`.
 * Brackets stay literal; values are percent-encoded. Undefined and null values are skipped.
 */
export function serializeQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value)) {
        if (childValue === undefined || childValue === null) continue;
        parts.push(`${key}[${child}]=${encodeURIComponent(String(childValue))}`);
      }
      continue;
    }
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

/** Where a v2 location-scoped route should look: `?location[directory]=<cwd>`. */
function locationQuery(directory?: string): Record<string, QueryValue> | undefined {
  return directory ? { location: { directory } } : undefined;
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
    queryParams?: Record<string, QueryValue>,
    options?: { timeout?: number; logBody?: boolean }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const query = queryParams ? serializeQuery(queryParams) : '';
    if (query) url.search = query;

    const effectiveTimeout = options?.timeout ?? this.timeout;
    // Responses that can carry secrets pass `logBody: false` so the body never reaches the logger.
    const logBody = options?.logBody !== false;
    const controller = new AbortController();
    // timeout === 0 means no timeout (fire-and-forget calls)
    const timeoutId = effectiveTimeout > 0 ? setTimeout(() => controller.abort(), effectiveTimeout) : null;

    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (this.authHeader) headers['Authorization'] = this.authHeader;

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: timeoutId === null ? undefined : controller.signal,
      });

      const contentType = response.headers?.get?.('content-type') ?? '';
      if (response.ok && contentType.includes('text/html')) {
        logger.httpResponse(method, path, response.status);
        throw new OpenCodeRouteNotFoundError(`OpenCode route not found: ${method} ${path} (unsupported OpenCode version?)`);
      }

      const responseBody = await response.json().catch(() => null);
      if (logBody) {
        logger.httpResponse(method, path, response.status, responseBody);
      } else {
        logger.httpResponse(method, path, response.status);
      }

      if (!response.ok) {
        throw new OpenCodeHttpError(response.status, responseBody);
      }

      return responseBody as T;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // ============================================================================
  // Server info
  // ============================================================================

  /** `GET /api/info` — the v2 health and version probe. */
  async info(): Promise<ServerInfo> {
    return this.request<ServerInfo>('GET', '/api/info');
  }

  /** v1 `GET /global/health`. Only the version gate calls this, to recognise an OpenCode 1.x server. */
  async health(): Promise<{ version?: string } | null> {
    return this.request<{ version?: string } | null>('GET', '/global/health');
  }

  async isServerRunning(): Promise<boolean> {
    try {
      await this.info();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Configuration (v1 route — still used by the Copilot-enterprise path until it moves to v2)
  // ============================================================================

  async updateConfig(config: Partial<Config>, directory?: string): Promise<Config> {
    return this.request<Config>('PATCH', '/config', config, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  async createSession(options: { directory?: string; model?: ModelRef; permissions?: PermissionRule[] }): Promise<SessionInfo> {
    const body = {
      location: options.directory ? { directory: options.directory } : undefined,
      model: options.model,
      permissions: options.permissions,
    };
    const response = await this.request<{ data: SessionInfo }>('POST', '/api/session', body);
    return response.data;
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    const response = await this.request<{ data: SessionInfo }>('GET', `/api/session/${encodeURIComponent(sessionId)}`);
    return response.data;
  }

  /** Replaces the session's permission rules. Takes effect on the next tool call. */
  async updateSession(sessionId: string, update: { permissions?: PermissionRule[] }): Promise<void> {
    await this.request<unknown>('PATCH', `/api/session/${encodeURIComponent(sessionId)}`, update);
  }

  async switchModel(sessionId: string, model: ModelRef): Promise<void> {
    await this.request<unknown>('POST', `/api/session/${encodeURIComponent(sessionId)}/model`, { model });
  }

  /** Experimental: sets one named entry of the session's system instructions. */
  async putInstructions(sessionId: string, key: string, value: string): Promise<void> {
    await this.request<unknown>(
      'PUT',
      `/api/experimental/session/${encodeURIComponent(sessionId)}/instructions/entries/${encodeURIComponent(key)}`,
      { value }
    );
  }

  /**
   * Admit one user turn. The server durably queues the input and returns within milliseconds;
   * the run itself is observed on the event stream, so no extended timeout is needed.
   */
  async prompt(sessionId: string, text: string): Promise<unknown> {
    const response = await this.request<{ data: unknown }>('POST', `/api/session/${encodeURIComponent(sessionId)}/prompt`, { text });
    return response?.data;
  }

  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    return this.request<{ interrupted: boolean }>('POST', `/api/session/${encodeURIComponent(sessionId)}/interrupt`);
  }

  /** Session history, newest first. */
  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const response = await this.request<{ data: SessionMessage[] }>(
      'GET',
      `/api/session/${encodeURIComponent(sessionId)}/message`,
      undefined,
      { order: 'desc' }
    );
    return response.data;
  }

  // ============================================================================
  // Permissions and forms (questions)
  // ============================================================================

  async listSessionPermissions(sessionId: string): Promise<PermissionAsk[]> {
    const response = await this.request<{ data: PermissionAsk[] }>('GET', `/api/session/${encodeURIComponent(sessionId)}/permission`);
    return response.data;
  }

  async listSessionForms(sessionId: string): Promise<FormInfo[]> {
    const response = await this.request<{ data: FormInfo[] }>('GET', `/api/session/${encodeURIComponent(sessionId)}/form`);
    return response.data;
  }

  async replyPermission(sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject', message?: string): Promise<void> {
    await this.request<unknown>('POST', `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`, {
      decision,
      message,
    });
  }

  async replyForm(sessionId: string, formId: string, answer: FormAnswer): Promise<void> {
    await this.request<unknown>('POST', `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formId)}/reply`, {
      answer,
    });
  }

  async cancelForm(sessionId: string, formId: string, message: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formId)}`, undefined, {
      message,
    });
  }

  // ============================================================================
  // MCP servers at runtime (experimental)
  // ============================================================================

  /** Adds or replaces a server at the location and connects it. */
  async putMcpServer(name: string, config: McpV2Config, directory?: string): Promise<void> {
    await this.request<unknown>('PUT', `/api/experimental/mcp/${encodeURIComponent(name)}`, { config }, locationQuery(directory));
  }

  async removeMcpServer(name: string, directory?: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/experimental/mcp/${encodeURIComponent(name)}`, undefined, locationQuery(directory));
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

  // ============================================================================
  // MCP Servers
  // ============================================================================

  async getMcpStatus(directory?: string): Promise<Record<string, { status: string; error?: string }>> {
    return this.request<Record<string, { status: string; error?: string }>>(
      'GET',
      '/mcp',
      undefined,
      directory ? { directory } : undefined
    );
  }

  async connectMcpServer(name: string, directory?: string): Promise<boolean> {
    return this.request<boolean>('POST', `/mcp/${encodeURIComponent(name)}/connect`, undefined, directory ? { directory } : undefined);
  }

  async disconnectMcpServer(name: string, directory?: string): Promise<void> {
    return this.request<void>('POST', `/mcp/${encodeURIComponent(name)}/disconnect`, undefined, directory ? { directory } : undefined);
  }

  // ============================================================================
  // Tools (Experimental)
  // ============================================================================

  async getToolIds(directory?: string): Promise<string[]> {
    return this.request<string[]>('GET', '/experimental/tool/ids', undefined, directory ? { directory } : undefined);
  }
}
