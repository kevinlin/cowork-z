/**
 * Redaction helpers applied by the Logger before anything is written to the
 * log file or forwarded over IPC to the frontend debug panel (technical
 * review finding #4).
 */

/** Property names whose values must never appear in logs. */
const SECRET_KEY_PATTERN = /(password|passwd|secret|token|api[-_]?key|authorization|credential|access[-_]?key)/i;

/** Inline `KEY=value` / `KEY: value` patterns in plain log messages. */
const SECRET_ASSIGNMENT_PATTERN =
  /\b([\w-]*(?:password|passwd|secret|token|api[-_]?key|authorization|credential)[\w-]*)(\s*[=:]\s*)(\S+)/gi;

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;

/**
 * Recursively replace the values of secret-looking properties in an object
 * tree. Returns a redacted copy; the input is never mutated. Non-container
 * values are returned as-is.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key) && (typeof val === 'string' || typeof val === 'number')) {
      result[key] = REDACTED;
    } else {
      result[key] = redactSecrets(val, depth + 1);
    }
  }
  return result;
}

/** Redact inline `SECRET=value` assignments inside a plain message string. */
export function redactMessage(message: string): string {
  return message.replace(SECRET_ASSIGNMENT_PATTERN, `$1$2${REDACTED}`);
}
