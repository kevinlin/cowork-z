#!/usr/bin/env node

/**
 * Cross-platform sidecar binary builder.
 * Detects the current OS and architecture, then runs the correct
 * pnpm build:binary:<target> command from the sidecar directory.
 */

import { execFileSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { resolve } from 'node:path';

const sidecarDir = resolve(import.meta.dirname, '..', 'src-tauri', 'sidecar-opencode');

const targetMap = {
  'darwin-arm64': 'build:binary',
  'darwin-x64': 'build:binary:x64',
  'win32-x64': 'build:binary:win',
  'linux-x64': 'build:binary:linux',
  'linux-arm64': 'build:binary:linux-arm64',
};

const key = `${platform()}-${arch()}`;
const script = targetMap[key];

if (!script) {
  console.error(`Unsupported platform/arch: ${key}`);
  console.error(`Supported targets: ${Object.keys(targetMap).join(', ')}`);
  process.exit(1);
}

console.log(`Building sidecar for ${key} (pnpm ${script})...`);

try {
  execFileSync('pnpm', [script], {
    cwd: sidecarDir,
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
