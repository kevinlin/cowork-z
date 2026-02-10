import { describe, expect, it } from 'vitest';
import {
  analyzeFile,
  formatPathForChat,
  getFileCategory,
  getFileExtension,
  insertAtCursor,
  isAbsolutePath,
  isPathSafe,
  looksLikeFilePath,
  needsQuoting,
} from '../file-utils';

describe('getFileExtension', () => {
  it('should extract common extensions', () => {
    expect(getFileExtension('/path/to/file.txt')).toBe('txt');
    expect(getFileExtension('/path/to/image.PNG')).toBe('png');
    expect(getFileExtension('document.pdf')).toBe('pdf');
  });

  it('should handle files with no extension', () => {
    expect(getFileExtension('/usr/bin/node')).toBe('');
    expect(getFileExtension('Makefile')).toBe('');
  });

  it('should handle dotfiles', () => {
    expect(getFileExtension('/home/.bashrc')).toBe('bashrc');
    // Bare dotfile without directory prefix — treated as name, not extension
    expect(getFileExtension('.gitignore')).toBe('');
  });

  it('should handle multiple dots', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
    expect(getFileExtension('file.test.ts')).toBe('ts');
  });
});

describe('getFileCategory', () => {
  it('should categorize image extensions', () => {
    expect(getFileCategory('jpg')).toBe('image');
    expect(getFileCategory('jpeg')).toBe('image');
    expect(getFileCategory('png')).toBe('image');
    expect(getFileCategory('gif')).toBe('image');
    expect(getFileCategory('webp')).toBe('image');
    expect(getFileCategory('svg')).toBe('image');
  });

  it('should categorize video extensions', () => {
    expect(getFileCategory('mp4')).toBe('video');
    expect(getFileCategory('webm')).toBe('video');
    expect(getFileCategory('mov')).toBe('video');
    expect(getFileCategory('mkv')).toBe('video');
  });

  it('should categorize code extensions', () => {
    expect(getFileCategory('ts')).toBe('code');
    expect(getFileCategory('js')).toBe('code');
    expect(getFileCategory('py')).toBe('code');
    expect(getFileCategory('json')).toBe('code');
    expect(getFileCategory('html')).toBe('code');
  });

  it('should categorize document extensions', () => {
    expect(getFileCategory('pdf')).toBe('document');
    expect(getFileCategory('doc')).toBe('document');
    expect(getFileCategory('xlsx')).toBe('document');
  });

  it('should categorize archive extensions', () => {
    expect(getFileCategory('zip')).toBe('archive');
    expect(getFileCategory('tar')).toBe('archive');
    expect(getFileCategory('gz')).toBe('archive');
  });

  it('should return unknown for unrecognized extensions', () => {
    expect(getFileCategory('xyz')).toBe('unknown');
    expect(getFileCategory('')).toBe('unknown');
  });
});

describe('analyzeFile', () => {
  it('should analyze image files as previewable', () => {
    const info = analyzeFile('/Users/test/photo.jpg');
    expect(info.category).toBe('image');
    expect(info.previewable).toBe(true);
    expect(info.extension).toBe('jpg');
    expect(info.filename).toBe('photo.jpg');
  });

  it('should analyze video files as previewable', () => {
    const info = analyzeFile('/Users/test/video.mp4');
    expect(info.category).toBe('video');
    expect(info.previewable).toBe(true);
  });

  it('should analyze code files as not previewable', () => {
    const info = analyzeFile('/src/app.ts');
    expect(info.category).toBe('code');
    expect(info.previewable).toBe(false);
  });

  it('should handle files without extensions', () => {
    const info = analyzeFile('/usr/bin/node');
    expect(info.category).toBe('unknown');
    expect(info.previewable).toBe(false);
    expect(info.filename).toBe('node');
  });
});

describe('isAbsolutePath', () => {
  it('should recognize Unix absolute paths', () => {
    expect(isAbsolutePath('/usr/local/bin')).toBe(true);
    expect(isAbsolutePath('/Users/name/file.txt')).toBe(true);
    expect(isAbsolutePath('/')).toBe(true);
  });

  it('should recognize Windows absolute paths', () => {
    expect(isAbsolutePath('C:\\Users\\file.txt')).toBe(true);
    expect(isAbsolutePath('D:/projects/app')).toBe(true);
  });

  it('should reject relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false);
    expect(isAbsolutePath('./local')).toBe(false);
    expect(isAbsolutePath('../parent')).toBe(false);
    expect(isAbsolutePath('file.txt')).toBe(false);
  });
});

describe('looksLikeFilePath', () => {
  it('should recognize valid file paths', () => {
    expect(looksLikeFilePath('/Users/name/file.txt')).toBe(true);
    expect(looksLikeFilePath('/usr/local/bin/node')).toBe(true);
  });

  it('should reject URLs', () => {
    expect(looksLikeFilePath('https://example.com/path')).toBe(false);
    expect(looksLikeFilePath('http://localhost:3000')).toBe(false);
  });

  it('should reject paths with too few segments', () => {
    expect(looksLikeFilePath('/single')).toBe(false);
  });

  it('should reject relative paths', () => {
    expect(looksLikeFilePath('relative/path/file.txt')).toBe(false);
  });
});

describe('isPathSafe', () => {
  it('should allow normal paths', () => {
    expect(isPathSafe('/Users/name/Documents/file.txt')).toBe(true);
    expect(isPathSafe('/tmp/output.log')).toBe(true);
  });

  it('should block directory traversal', () => {
    expect(isPathSafe('/Users/name/../../etc/passwd')).toBe(false);
    expect(isPathSafe('/tmp/../etc/shadow')).toBe(false);
  });

  it('should block sensitive system paths', () => {
    expect(isPathSafe('/System/Library/something')).toBe(false);
    expect(isPathSafe('/Library/Keychains/login.keychain')).toBe(false);
    expect(isPathSafe('/private/var/db/something')).toBe(false);
    expect(isPathSafe('/Users/name/.Trash/file.txt')).toBe(false);
  });
});

// ── Drag-and-drop path formatting ────────────────────────────────────

describe('needsQuoting', () => {
  it('should return false for simple paths without spaces', () => {
    expect(needsQuoting('/Users/name/file.txt')).toBe(false);
    expect(needsQuoting('/usr/local/bin/node')).toBe(false);
    expect(needsQuoting('C:\\Users\\name\\file.txt')).toBe(false);
  });

  it('should return true for paths with spaces', () => {
    expect(needsQuoting('/Users/name/My Documents/file.txt')).toBe(true);
    expect(needsQuoting('/tmp/my file.txt')).toBe(true);
  });

  it('should return true for paths with quotes', () => {
    expect(needsQuoting("/Users/name/it's a file.txt")).toBe(true);
    expect(needsQuoting('/Users/name/"quoted".txt')).toBe(true);
  });

  it('should return true for paths with parentheses', () => {
    expect(needsQuoting('/Users/name/file (1).txt')).toBe(true);
    expect(needsQuoting('/Users/name/backup(old)')).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(needsQuoting('')).toBe(false);
  });
});

describe('formatPathForChat', () => {
  it('should format a Unix absolute path', () => {
    expect(formatPathForChat('/Users/name/file.txt')).toBe('@/Users/name/file.txt');
  });

  it('should format a Windows absolute path', () => {
    expect(formatPathForChat('C:\\Users\\name\\file.txt')).toBe('@C:\\Users\\name\\file.txt');
  });

  it('should quote a path with spaces', () => {
    expect(formatPathForChat('/Users/name/My Documents/file.txt')).toBe('@"/Users/name/My Documents/file.txt"');
  });

  it('should return null for unsafe path with directory traversal', () => {
    expect(formatPathForChat('/Users/name/../../etc/passwd')).toBeNull();
  });

  it('should return null for sensitive system paths', () => {
    expect(formatPathForChat('/System/Library/something')).toBeNull();
    expect(formatPathForChat('/Library/Keychains/login.keychain')).toBeNull();
  });

  it('should handle paths with parentheses', () => {
    expect(formatPathForChat('/Users/name/file (1).txt')).toBe('@"/Users/name/file (1).txt"');
  });
});

describe('insertAtCursor', () => {
  it('should insert at the start (position 0)', () => {
    const result = insertAtCursor('existing text', '@/path/file', 0);
    expect(result.newText).toBe('@/path/fileexisting text');
    expect(result.newCursorPosition).toBe(11);
  });

  it('should insert at the end', () => {
    const result = insertAtCursor('Hello ', '@/path/file', 6);
    expect(result.newText).toBe('Hello @/path/file');
    expect(result.newCursorPosition).toBe(17);
  });

  it('should insert in the middle', () => {
    const result = insertAtCursor('Hello world', ' @/path/file ', 5);
    expect(result.newText).toBe('Hello @/path/file  world');
    expect(result.newCursorPosition).toBe(18);
  });

  it('should insert into empty string', () => {
    const result = insertAtCursor('', '@/path/file', 0);
    expect(result.newText).toBe('@/path/file');
    expect(result.newCursorPosition).toBe(11);
  });

  it('should handle multiple sequential insertions correctly', () => {
    const first = insertAtCursor('', '@/first', 0);
    expect(first.newText).toBe('@/first');

    const second = insertAtCursor(first.newText, ' @/second', first.newCursorPosition);
    expect(second.newText).toBe('@/first @/second');
    expect(second.newCursorPosition).toBe(16);
  });
});
