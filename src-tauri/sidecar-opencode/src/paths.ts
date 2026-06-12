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

/**
 * App-private directory for the OpenCode config the sidecar writes and the
 * working directory of the spawned `opencode serve` process.
 *
 * Deliberately OUTSIDE OpenCode's own data tree (2026-06-12 review #25):
 * the sidecar's config writes use replace semantics for app-managed keys
 * (`mcp`, model overlays), which is only safe in a directory the app owns.
 * The user's global OpenCode config (~/.config/opencode/opencode.json) is
 * never touched.
 */
export function getAppOpenCodeConfigDir(): string {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'cowork-z', 'opencode');
}
