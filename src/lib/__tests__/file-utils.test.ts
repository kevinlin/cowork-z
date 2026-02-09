import { describe, expect, it } from 'vitest';
import { analyzeFile, getFileCategory, getFileExtension, isAbsolutePath, isPathSafe, looksLikeFilePath } from '../file-utils';

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
