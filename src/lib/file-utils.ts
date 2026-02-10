/**
 * File type detection and path validation utilities.
 *
 * Used by the rich file/URL display system to categorize files,
 * determine preview capability, and validate path safety.
 */

export type FileCategory = 'image' | 'video' | 'code' | 'document' | 'archive' | 'unknown';

export interface FileInfo {
  /** Original file path */
  path: string;
  /** File extension (lowercase, without dot) */
  extension: string;
  /** File category based on extension */
  category: FileCategory;
  /** Whether the file can be previewed inline (images, videos) */
  previewable: boolean;
  /** Extracted filename (last segment of path) */
  filename: string;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff']);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']);

const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'scala',
  'r',
  'css',
  'scss',
  'less',
  'html',
  'xml',
  'json',
  'yaml',
  'yml',
  'toml',
  'md',
  'mdx',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'graphql',
  'gql',
  'vue',
  'svelte',
]);

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv']);

const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz', 'tgz']);

/** Sensitive system paths that should not be opened (macOS-specific). */
const SENSITIVE_PATHS = ['/System/', '/Library/Keychains/', '/private/var/db/', '/.Trash/'];

/**
 * Extract the lowercase file extension without the dot.
 * Returns empty string if no extension is found.
 */
export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastDot <= 0 || lastDot < lastSlash) return '';
  return filePath.slice(lastDot + 1).toLowerCase();
}

/**
 * Determine the category for a given file extension.
 */
export function getFileCategory(extension: string): FileCategory {
  const ext = extension.toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  return 'unknown';
}

/**
 * Full analysis of a file path: extension, category, previewability.
 */
export function analyzeFile(filePath: string): FileInfo {
  const extension = getFileExtension(filePath);
  const category = getFileCategory(extension);
  const previewable = category === 'image' || category === 'video';
  const segments = filePath.replace(/\\/g, '/').split('/');
  const filename = segments[segments.length - 1] || filePath;

  return { path: filePath, extension, category, previewable, filename };
}

/**
 * Returns true if the path looks like an absolute file system path
 * (Unix `/...`, `~/...`, or Windows `C:\...`).
 */
export function isAbsolutePath(path: string): boolean {
  // Unix absolute path
  if (path.startsWith('/')) return true;
  // Home-relative path (expanded at click time)
  if (path.startsWith('~/')) return true;
  // Windows absolute path  (e.g. C:\ or D:/)
  if (/^[A-Za-z]:[/\\]/.test(path)) return true;
  return false;
}

/**
 * Heuristic: does this string look like a file path?
 * Must be absolute, contain at least two segments, and not be a URL.
 */
export function looksLikeFilePath(text: string): boolean {
  // Reject URLs
  if (/^https?:\/\//i.test(text)) return false;
  if (!isAbsolutePath(text)) return false;
  // Must have at least two segments (e.g., /usr/file)
  const trimmed = text.replace(/\\/g, '/');
  const segments = trimmed.split('/').filter(Boolean);
  return segments.length >= 2;
}

/**
 * Security validation: blocks directory traversal and access to
 * known sensitive macOS system paths.
 */
export function isPathSafe(filePath: string): boolean {
  // Block directory traversal
  if (filePath.includes('..')) return false;
  // Block sensitive system paths
  for (const sensitive of SENSITIVE_PATHS) {
    if (filePath.includes(sensitive)) return false;
  }
  return true;
}

// ── Drag-and-drop path formatting ────────────────────────────────────

/**
 * Determines if a path needs to be wrapped in quotes.
 * Returns true for paths containing spaces or special chars: ' " ( )
 */
export function needsQuoting(path: string): boolean {
  return /[\s'"()]/.test(path);
}

/**
 * Formats a file path for chat input as @path or @"path with spaces".
 * Returns null if the path fails safety validation.
 */
export function formatPathForChat(path: string): string | null {
  if (!isPathSafe(path)) {
    return null;
  }

  const quoted = needsQuoting(path) ? `"${path}"` : path;
  return `@${quoted}`;
}

/**
 * Inserts text at the cursor position in a string.
 * Returns the new text and the new cursor position.
 */
export function insertAtCursor(
  currentText: string,
  insertText: string,
  cursorPosition: number
): { newText: string; newCursorPosition: number } {
  const before = currentText.slice(0, cursorPosition);
  const after = currentText.slice(cursorPosition);
  const newText = before + insertText + after;
  const newCursorPosition = cursorPosition + insertText.length;

  return { newText, newCursorPosition };
}
