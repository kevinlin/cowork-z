import fs from 'node:fs';
import path from 'node:path';
import { getOpenCodeLogDir } from './paths';
import { redactMessage, redactSecrets } from './redact';

export type IpcLogEmitter = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

export class Logger {
  private logFile: fs.WriteStream | null = null;
  private logDir: string;
  private sessionId?: string;
  private taskId?: string;
  private ipcEmitter: IpcLogEmitter | null = null;
  /**
   * Full HTTP response bodies and SSE event payloads contain conversation
   * content (including user file contents), so they are only logged when
   * explicitly enabled via SIDECAR_DEBUG_PAYLOADS=1 (technical review
   * finding #10). Metadata (event type, method/path/status) is always logged.
   */
  private payloadLogging: boolean;

  constructor() {
    this.logDir = getOpenCodeLogDir();
    this.ensureLogDir();
    this.payloadLogging = process.env.SIDECAR_DEBUG_PAYLOADS === '1' || process.env.SIDECAR_DEBUG_PAYLOADS === 'true';
  }

  /** Enable/disable full payload logging (exposed for tests). */
  setPayloadLogging(enabled: boolean): void {
    this.payloadLogging = enabled;
  }

  /** Wire up an IPC emitter so log messages are also sent to the frontend debug panel. */
  setIpcEmitter(emitter: IpcLogEmitter): void {
    this.ipcEmitter = emitter;
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  startSession(sessionId?: string, taskId?: string): void {
    this.sessionId = sessionId;
    this.taskId = taskId;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const parts = [timestamp];
    if (sessionId) parts.push(sessionId);
    if (taskId) parts.push(taskId);

    const filename = `${parts.join('_')}_TS.log`;
    const filepath = path.join(this.logDir, filename);

    this.logFile = fs.createWriteStream(filepath, { flags: 'a' });
    this.info(`Log started: ${filepath}`);
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
  }

  private write(level: string, rawMessage: string, rawData?: unknown): void {
    // Redact known secret keys/patterns before anything reaches the log file
    // or the IPC stream (technical review finding #4)
    const message = redactMessage(rawMessage);
    const data = rawData === undefined ? undefined : redactSecrets(rawData);

    const timestamp = this.formatTimestamp();
    const line = data ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}` : `[${timestamp}] [${level}] ${message}`;

    if (this.logFile) {
      this.logFile.write(`${line}\n`);
    }

    // Send to frontend debug panel via IPC
    if (this.ipcEmitter) {
      const levelLower = level.toLowerCase();
      const ipcLevel: 'debug' | 'info' | 'warn' | 'error' =
        levelLower === 'debug' || levelLower === 'info' || levelLower === 'warn' || levelLower === 'error' ? levelLower : 'debug'; // Map EVENT, HTTP, etc. to debug
      const prefix = levelLower === ipcLevel ? '' : `[${level}] `;
      const ipcMessage = data ? `${prefix}${message} ${JSON.stringify(data)}` : `${prefix}${message}`;
      this.ipcEmitter(ipcLevel, ipcMessage);
    }
  }

  debug(message: string, data?: unknown): void {
    this.write('DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write('INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write('WARN', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('ERROR', message, data);
  }

  // Log OpenCode server event — full payload only when payload logging is enabled
  serverEvent(event: unknown): void {
    if (this.payloadLogging) {
      this.write('EVENT', 'OpenCode Server Event', event);
      return;
    }
    const eventType = typeof event === 'object' && event !== null ? (event as { type?: string }).type : undefined;
    this.write('EVENT', `OpenCode Server Event: ${eventType ?? 'unknown'}`);
  }

  // Log HTTP response — body only when payload logging is enabled
  httpResponse(method: string, path: string, status: number, body?: unknown): void {
    this.write('HTTP', `${method} ${path} -> ${status}`, this.payloadLogging ? body : undefined);
  }

  close(): void {
    if (this.logFile) {
      this.write('INFO', 'Log closed');
      this.logFile.end();
      this.logFile = null;
    }
  }
}

export const logger = new Logger();
