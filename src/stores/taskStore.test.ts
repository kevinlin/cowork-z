import { describe, expect, it } from 'vitest';
import type { Artifact, TaskMessage } from '@/shared/types';

/**
 * Tool names from OpenCode that modify/create files.
 */
const FILE_WRITING_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit']);

/**
 * Extract file path from a tool input object.
 */
function extractFilePathFromToolInput(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  const path = input.file_path ?? input.filePath ?? input.path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

/**
 * Extract file paths from a bash command string by matching common
 * file-writing patterns.
 *
 * NOTE: Duplicated from taskStore.ts for testing purposes.
 */
/** Path prefix pattern: matches /, ~/, $HOME/, ${HOME}/ */
const ABS_PATH = String.raw`(?:\/[^\s"'>;|&\\]+|~\/[^\s"'>;|&\\]+|\$HOME\/[^\s"'>;|&\\]+|\$\{HOME\}\/[^\s"'>;|&\\]+)`;
/** Same but also allows shell variable chars inside the path */
const ABS_PATH_VARS = String.raw`(?:\/[^\s"'>;|&\\]+|~\/[^\s"'>;|&\\]+|\$HOME\/[^\s"'>;|\\]+|\$\{HOME\}\/[^\s"'>;|\\]+|\$\{process\.env\.HOME\}\/[^\s"'>;|\\]+)`;

function extractFilePathsFromBashCommand(command: string): string[] {
  const paths = new Set<string>();

  const patterns: RegExp[] = [
    new RegExp(String.raw`>>?\s+\\?["']?` + `(${ABS_PATH_VARS})` + String.raw`\\?["']?`, 'g'),
    new RegExp(String.raw`writeFileSync\s*\(\s*["'\x60](` + ABS_PATH_VARS + String.raw`)["'\x60]`, 'g'),
    new RegExp(String.raw`writeFile\s*\(\s*["'\x60](` + ABS_PATH_VARS + String.raw`)["'\x60]`, 'g'),
    new RegExp(
      String.raw`(?:outPath|outputPath|filePath|targetPath|savePath|destPath|dest|target|output)\s*=\s*["\x60'](` +
        ABS_PATH_VARS +
        String.raw`)["\x60']`,
      'g'
    ),
    new RegExp(String.raw`open\s*\(\s*["'](` + ABS_PATH + String.raw`)["']\s*,\s*["'][wa]`, 'g'),
    new RegExp(String.raw`\btee\s+(?:-a\s+)?\\?["']?(` + ABS_PATH_VARS + String.raw`)\\?["']?`, 'g'),
  ];

  for (const pattern of patterns) {
    let match: RegExpMatchArray | null;
    while ((match = pattern.exec(command)) !== null) {
      const rawPath = match[1];
      if (rawPath) {
        paths.add(rawPath);
      }
    }
  }

  return Array.from(paths);
}

function createArtifact(id: string, filePath: string, timestamp: string): Artifact {
  const fileName = filePath.split('/').pop() || filePath;
  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  return { id, filePath, fileName, fileExt: ext, timestamp, operation: 'write' };
}

/**
 * Resolve shell variables in bash-extracted paths.
 * Duplicated from taskStore.ts for testing.
 */
function resolveShellPath(rawPath: string, toolOutput?: string, allMessages?: TaskMessage[]): string {
  const path = rawPath.replace(/^\$HOME\//, '~/').replace(/^\$\{HOME\}\//, '~/');
  if (!path.includes('$')) return path;

  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  const ext = path.includes('.') ? path.substring(path.lastIndexOf('.')) : '';

  const candidates: string[] = [];
  if (toolOutput) candidates.push(toolOutput);
  if (allMessages) {
    for (const m of allMessages) {
      if (m.type === 'assistant' && m.content) candidates.push(m.content);
    }
  }

  const dirForMatch = dir.replace(/^\$HOME\//, '~/').replace(/^\$\{HOME\}\//, '~/');

  for (const text of candidates) {
    const escaped = dirForMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped + String.raw`([^\s"'\x60:,)]+` + ext.replace('.', '\\.') + ')');
    const match = pattern.exec(text);
    if (match) {
      return dirForMatch + match[1];
    }
  }

  return path;
}

/**
 * Extract artifacts from task messages. Handles both direct file-writing tools
 * and bash commands with file-writing patterns.
 *
 * NOTE: Duplicated from taskStore.ts for testing.
 */
function extractArtifactsFromMessages(messages: TaskMessage[]): Artifact[] {
  const artifactMap = new Map<string, Artifact>();

  for (const m of messages) {
    if (m.type !== 'tool' || !m.toolName) continue;

    try {
      if (FILE_WRITING_TOOLS.has(m.toolName)) {
        const path = extractFilePathFromToolInput(m.toolInput);
        if (path) {
          artifactMap.set(path, createArtifact(m.id, path, m.timestamp));
        }
        continue;
      }

      if (m.toolName === 'bash' && m.toolInput && typeof m.toolInput === 'object') {
        const input = m.toolInput as Record<string, unknown>;
        const command = typeof input.command === 'string' ? input.command : '';
        if (command) {
          const bashPaths = extractFilePathsFromBashCommand(command);
          for (const rawPath of bashPaths) {
            const resolved = resolveShellPath(rawPath, m.toolOutput, messages);
            artifactMap.set(resolved, createArtifact(m.id, resolved, m.timestamp));
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse artifact:', e);
    }
  }

  return Array.from(artifactMap.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ============================================================================
// resolveShellPath tests
// ============================================================================

describe('resolveShellPath', () => {
  it('should replace $HOME/ with ~/', () => {
    expect(resolveShellPath('$HOME/Downloads/file.md')).toBe('~/Downloads/file.md');
  });

  it('should replace ${HOME}/ with ~/', () => {
    expect(resolveShellPath('${HOME}/Documents/notes.txt')).toBe('~/Documents/notes.txt');
  });

  it('should pass through paths without shell variables', () => {
    expect(resolveShellPath('~/Downloads/file.md')).toBe('~/Downloads/file.md');
    expect(resolveShellPath('/tmp/test.txt')).toBe('/tmp/test.txt');
  });

  it('should resolve $var from tool output', () => {
    const resolved = resolveShellPath('~/Downloads/$ts-report.md', undefined, [
      { id: 'm1', type: 'assistant', content: 'Created ~/Downloads/20260210-report.md for you.', timestamp: '2026-01-01T00:00:00Z' },
    ]);
    expect(resolved).toBe('~/Downloads/20260210-report.md');
  });

  it('should return unresolved path if no match found', () => {
    expect(resolveShellPath('~/Downloads/$ts-report.md')).toBe('~/Downloads/$ts-report.md');
  });
});

// ============================================================================
// extractFilePathsFromBashCommand tests
// ============================================================================

describe('extractFilePathsFromBashCommand', () => {
  it('should extract paths from shell redirects', () => {
    expect(extractFilePathsFromBashCommand('echo "hello" > /tmp/test.txt')).toContain('/tmp/test.txt');
    expect(extractFilePathsFromBashCommand('echo "hello" >> /tmp/test.txt')).toContain('/tmp/test.txt');
  });

  it('should extract paths from tilde redirects', () => {
    expect(extractFilePathsFromBashCommand('echo "hello" > ~/Downloads/test.txt')).toContain('~/Downloads/test.txt');
  });

  it('should extract paths from Node.js writeFileSync', () => {
    expect(extractFilePathsFromBashCommand("fs.writeFileSync('/Users/test/file.docx', buffer)")).toContain('/Users/test/file.docx');
  });

  it('should extract paths from variable assignments with output paths', () => {
    const cmd = "const outPath = '~/Downloads/Intro.docx';\nfs.writeFileSync(outPath, buffer);";
    const paths = extractFilePathsFromBashCommand(cmd);
    expect(paths).toContain('~/Downloads/Intro.docx');
  });

  it('should extract paths from Python open() with write mode', () => {
    expect(extractFilePathsFromBashCommand("open('/tmp/output.csv', 'w')")).toContain('/tmp/output.csv');
    expect(extractFilePathsFromBashCommand("open('/tmp/output.csv', 'a')")).toContain('/tmp/output.csv');
  });

  it('should extract paths from tee command', () => {
    expect(extractFilePathsFromBashCommand('echo "data" | tee /tmp/output.txt')).toContain('/tmp/output.txt');
    expect(extractFilePathsFromBashCommand('echo "data" | tee -a /tmp/output.txt')).toContain('/tmp/output.txt');
  });

  it('should extract paths with $HOME prefix', () => {
    expect(extractFilePathsFromBashCommand('cat <<EOF > "$HOME/Downloads/test.md"\nhello\nEOF')).toContain('$HOME/Downloads/test.md');
  });

  it('should extract paths with $HOME and shell variables in filename', () => {
    const cmd = 'ts=$(date) && cat <<\'EOF\' > \\"$HOME/Downloads/$ts-previous-response.md\\"';
    const paths = extractFilePathsFromBashCommand(cmd);
    expect(paths.some((p) => p.startsWith('$HOME/Downloads/'))).toBe(true);
  });

  it('should extract paths with ${process.env.HOME} prefix', () => {
    const cmd = 'const outPath = `${process.env.HOME}/Downloads/file.docx`;\nfs.writeFileSync(outPath, buffer);';
    const paths = extractFilePathsFromBashCommand(cmd);
    expect(paths.some((p) => p.includes('/Downloads/file.docx'))).toBe(true);
  });

  it('should return empty array for commands without file writes', () => {
    expect(extractFilePathsFromBashCommand('ls -la')).toHaveLength(0);
    expect(extractFilePathsFromBashCommand('npm install docx')).toHaveLength(0);
    expect(extractFilePathsFromBashCommand('echo "hello"')).toHaveLength(0);
  });

  it('should deduplicate paths', () => {
    const cmd = 'echo "a" > /tmp/test.txt && echo "b" >> /tmp/test.txt';
    const paths = extractFilePathsFromBashCommand(cmd);
    const unique = new Set(paths);
    expect(paths.length).toBe(unique.size);
  });
});

// ============================================================================
// extractArtifactsFromMessages tests
// ============================================================================

describe('extractArtifactsFromMessages', () => {
  it('should extract artifacts from write tool calls', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'write',
        toolInput: { file_path: '/Users/test/file.ts', content: 'code' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: 'msg-1',
      filePath: '/Users/test/file.ts',
      fileName: 'file.ts',
      fileExt: 'ts',
      operation: 'write',
    });
  });

  it('should extract artifacts from edit tool calls', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'edit',
        toolInput: { file_path: '/Users/test/file.ts', old_string: 'foo', new_string: 'bar' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/file.ts');
  });

  it('should extract artifacts from bash commands with writeFileSync', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'bash',
        toolInput: {
          command: "node - <<'JS'\nconst fs = require('fs');\nfs.writeFileSync('/Users/test/Downloads/output.docx', buffer);\nJS",
          description: 'Create Word doc',
        },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/Users/test/Downloads/output.docx');
    expect(artifacts[0].fileExt).toBe('docx');
  });

  it('should extract artifacts from bash commands with shell redirect using ~/', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'bash',
        toolInput: { command: 'echo "hello world" > ~/Documents/hello.txt' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('~/Documents/hello.txt');
    expect(artifacts[0].fileExt).toBe('txt');
  });

  it('should resolve $HOME to ~ in bash commands with shell redirect', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'bash',
        toolInput: { command: 'cat <<\'EOF\' > "$HOME/Downloads/report.md"\nhello\nEOF' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('~/Downloads/report.md');
    expect(artifacts[0].fileExt).toBe('md');
  });

  it('should resolve $var in bash paths using assistant message text', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-assistant',
        type: 'assistant',
        content: 'I created the file at ~/Downloads/20260210-021248-previous-response.md',
        timestamp: '2026-02-10T10:01:00Z',
      },
      {
        id: 'msg-bash',
        type: 'tool',
        toolName: 'bash',
        toolInput: { command: "ts=$(date '+%Y%m%d-%H%M%S') && cat <<'EOF' > \"$HOME/Downloads/$ts-previous-response.md\"\nhello\nEOF" },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('~/Downloads/20260210-021248-previous-response.md');
    expect(artifacts[0].fileName).toBe('20260210-021248-previous-response.md');
  });

  it('should extract artifacts from bash commands with outPath variable', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'bash',
        toolInput: {
          command: "const outPath = '~/Downloads/Intro.docx';\nfs.writeFileSync(outPath, buffer);",
        },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('~/Downloads/Intro.docx');
  });

  it('should deduplicate multiple writes to same file', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'write',
        toolInput: { file_path: '/test/file.ts', content: 'v1' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
      {
        id: 'msg-2',
        type: 'tool',
        toolName: 'edit',
        toolInput: { file_path: '/test/file.ts', old_string: 'v1', new_string: 'v2' },
        content: '',
        timestamp: '2026-02-10T10:01:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe('msg-2');
  });

  it('should ignore read, grep, and non-writing bash commands', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'read',
        toolInput: { file_path: '/test/file.ts' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
      { id: 'msg-2', type: 'tool', toolName: 'grep', toolInput: { pattern: 'foo' }, content: '', timestamp: '2026-02-10T10:01:00Z' },
      { id: 'msg-3', type: 'tool', toolName: 'bash', toolInput: { command: 'ls -la' }, content: '', timestamp: '2026-02-10T10:02:00Z' },
    ];

    expect(extractArtifactsFromMessages(messages)).toHaveLength(0);
  });

  it('should handle missing path gracefully', () => {
    const messages: TaskMessage[] = [
      { id: 'msg-1', type: 'tool', toolName: 'write', toolInput: { content: 'no path' }, content: '', timestamp: '2026-02-10T10:00:00Z' },
    ];
    expect(extractArtifactsFromMessages(messages)).toHaveLength(0);
  });

  it('should sort artifacts by timestamp descending', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'write',
        toolInput: { file_path: '/test/a.ts', content: '' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
      {
        id: 'msg-2',
        type: 'tool',
        toolName: 'write',
        toolInput: { file_path: '/test/b.ts', content: '' },
        content: '',
        timestamp: '2026-02-10T10:02:00Z',
      },
      {
        id: 'msg-3',
        type: 'tool',
        toolName: 'edit',
        toolInput: { file_path: '/test/c.ts' },
        content: '',
        timestamp: '2026-02-10T10:01:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts.map((a) => a.fileName)).toEqual(['b.ts', 'c.ts', 'a.ts']);
  });

  it('should handle files without extensions', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'write',
        toolInput: { file_path: '/test/Makefile', content: '' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].fileName).toBe('Makefile');
    expect(artifacts[0].fileExt).toBe('');
  });

  it('should handle patch and multiedit tools', () => {
    const messages: TaskMessage[] = [
      {
        id: 'msg-1',
        type: 'tool',
        toolName: 'patch',
        toolInput: { file_path: '/test/patched.ts' },
        content: '',
        timestamp: '2026-02-10T10:00:00Z',
      },
      {
        id: 'msg-2',
        type: 'tool',
        toolName: 'multiedit',
        toolInput: { file_path: '/test/multi.ts' },
        content: '',
        timestamp: '2026-02-10T10:01:00Z',
      },
    ];

    const artifacts = extractArtifactsFromMessages(messages);
    expect(artifacts).toHaveLength(2);
  });
});
