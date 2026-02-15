import os from 'node:os';
import path from 'node:path';

/**
 * Get the OpenCode log directory path based on the current platform.
 *
 * On Windows: %LOCALAPPDATA%\opencode\log (with fallback to AppData\Local)
 * On macOS/Linux: ~/.local/share/opencode/log (XDG convention)
 *
 * This matches the Rust sidecar logger's behavior.
 */
export function getOpenCodeLogDir(): string {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'log');
}
