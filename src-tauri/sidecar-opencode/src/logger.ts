import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class Logger {
  private logFile: fs.WriteStream | null = null;
  private logDir: string;
  private sessionId?: string;
  private taskId?: string;

  constructor() {
    this.logDir = path.join(os.homedir(), '.local', 'share', 'opencode', 'log');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  startSession(sessionId?: string, taskId?: string): void {
    this.sessionId = sessionId;
    this.taskId = taskId;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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

  private write(level: string, message: string, data?: unknown): void {
    const timestamp = this.formatTimestamp();
    const line = data ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}` : `[${timestamp}] [${level}] ${message}`;

    if (this.logFile) {
      this.logFile.write(`${line}\n`);
    }

    // Also write to stderr for debugging
    console.error(line);
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

  // Log raw OpenCode server event
  serverEvent(event: unknown): void {
    this.write('EVENT', 'OpenCode Server Event', event);
  }

  // Log raw HTTP response
  httpResponse(method: string, path: string, status: number, body?: unknown): void {
    this.write('HTTP', `${method} ${path} -> ${status}`, body);
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
