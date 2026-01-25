import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Get OpenCode package name and platform-specific binary name.
 *
 * On Windows: The binary is in a platform-specific package (opencode-windows-x64)
 * On macOS/Linux: The binary is in the main opencode-ai package
 */
function getOpenCodePlatformInfo(): { packageName: string; binaryName: string } {
  if (process.platform === 'win32') {
    // On Windows, use the platform-specific package
    return {
      packageName: 'opencode-windows-x64',
      binaryName: 'opencode.exe',
    };
  }
  return {
    packageName: 'opencode-ai',
    binaryName: 'opencode',
  };
}

/**
 * Get all possible nvm OpenCode CLI paths by scanning the nvm versions directory
 */
function getNvmOpenCodePaths(): string[] {
  const homeDir = process.env.HOME || '';
  const nvmVersionsDir = path.join(homeDir, '.nvm/versions/node');
  const paths: string[] = [];

  try {
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir);
      for (const version of versions) {
        const opencodePath = path.join(nvmVersionsDir, version, 'bin', 'opencode');
        if (fs.existsSync(opencodePath)) {
          paths.push(opencodePath);
        }
      }
    }
  } catch {
    // Ignore errors scanning nvm directory
  }

  return paths;
}

/**
 * Check if opencode is available on the system PATH
 */
function isOpenCodeOnPath(): boolean {
  try {
    const command = process.platform === 'win32' ? 'where opencode' : 'which opencode';
    execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the OpenCode CLI.
 *
 * Search order:
 * 1. OPENCODE_CLI_PATH environment variable (explicit override)
 * 2. nvm installations
 * 3. Global installations (/usr/local/bin, homebrew, npm global)
 * 4. node_modules/.bin (dev mode)
 * 5. PATH fallback
 */
export function getOpenCodeCliPath(): { command: string; args: string[] } {
  // 1. Check explicit environment variable
  const envCliPath = process.env.OPENCODE_CLI_PATH;
  if (envCliPath && fs.existsSync(envCliPath)) {
    return { command: envCliPath, args: [] };
  }

  // 2. Check nvm installations (dynamically scan all versions)
  const nvmPaths = getNvmOpenCodePaths();
  for (const opencodePath of nvmPaths) {
    return { command: opencodePath, args: [] };
  }

  // 3. Check global installations (platform-specific)
  const globalOpenCodePaths =
    process.platform === 'win32'
      ? [
          // Windows: npm global installs
          path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'npm', 'opencode.cmd'),
        ]
      : [
          // macOS/Linux: Global npm
          '/usr/local/bin/opencode',
          // Homebrew
          '/opt/homebrew/bin/opencode',
        ];

  for (const opencodePath of globalOpenCodePaths) {
    if (fs.existsSync(opencodePath)) {
      return { command: opencodePath, args: [] };
    }
  }

  // 4. Try bundled CLI in node_modules (for dev mode)
  const binName = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
  const devCliPath = path.join(process.cwd(), 'node_modules', '.bin', binName);
  if (fs.existsSync(devCliPath)) {
    return { command: devCliPath, args: [] };
  }

  // 5. Final fallback: 'opencode' on PATH
  return { command: 'opencode', args: [] };
}

/**
 * Check if the OpenCode CLI is available
 */
export function isOpenCodeAvailable(): boolean {
  try {
    // Check explicit environment variable
    const envCliPath = process.env.OPENCODE_CLI_PATH;
    if (envCliPath && fs.existsSync(envCliPath)) {
      return true;
    }

    // Check nvm installations
    const nvmPaths = getNvmOpenCodePaths();
    if (nvmPaths.length > 0) {
      return true;
    }

    // Check global installations (platform-specific)
    const globalOpenCodePaths =
      process.platform === 'win32'
        ? [
            path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'opencode.cmd'),
          ]
        : ['/usr/local/bin/opencode', '/opt/homebrew/bin/opencode'];

    for (const opencodePath of globalOpenCodePaths) {
      if (fs.existsSync(opencodePath)) {
        return true;
      }
    }

    // Check bundled CLI in node_modules
    const binName = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
    const devCliPath = path.join(process.cwd(), 'node_modules', '.bin', binName);
    if (fs.existsSync(devCliPath)) {
      return true;
    }

    // Final fallback: check if opencode is on PATH
    if (isOpenCodeOnPath()) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get the version of the OpenCode CLI
 */
export function getOpenCodeVersion(): string | null {
  try {
    const { command, args } = getOpenCodeCliPath();
    const fullCommand =
      args.length > 0
        ? `"${command}" ${args.map((a) => `"${a}"`).join(' ')} --version`
        : `"${command}" --version`;

    const output = execSync(fullCommand, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse version from output (e.g., "opencode 1.0.0" or just "1.0.0")
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : output;
  } catch {
    return null;
  }
}

/**
 * Error thrown when OpenCode CLI is not found
 */
export class OpenCodeCliNotFoundError extends Error {
  constructor() {
    super(
      'OpenCode CLI not found. Please install it with: npm install -g opencode-ai'
    );
    this.name = 'OpenCodeCliNotFoundError';
  }
}
