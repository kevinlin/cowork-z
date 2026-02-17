import type { DirectoryEntry } from '@/shared/types/workspace';

export type PreviewType = 'code' | 'markdown' | 'image' | 'pdf' | 'html' | 'text' | 'binary';

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'rs',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'go',
  'rb',
  'php',
  'swift',
  'kt',
  'scala',
  'sh',
  'bash',
  'css',
  'scss',
  'xml',
  'sql',
  'r',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf']);

/**
 * Determine the preview type for a file based on its extension.
 */
export function getPreviewType(file: DirectoryEntry): PreviewType {
  const ext = file.extension?.toLowerCase();
  if (!ext) return 'binary';

  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'binary';
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  r: 'r',
};

/**
 * Map a file extension to a syntax-highlighter language name.
 */
export function getLanguageFromExtension(ext: string | undefined): string {
  if (!ext) return 'text';
  return LANGUAGE_MAP[ext.toLowerCase()] || ext.toLowerCase();
}

/**
 * Format a byte count into a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`;
}

/**
 * Get MIME type from a file extension (for image base64 data URLs).
 */
export function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  };
  return mimeMap[ext.toLowerCase()] || 'image/png';
}
