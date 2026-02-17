import { File, FileCode, FileJson, FileText, Folder, FolderOpen, Image } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { formatFileSize, getFileIcon, isHiddenEntry } from '../FileTreePanel';

describe('isHiddenEntry', () => {
  describe('dotfiles and dotfolders', () => {
    it('should hide names starting with a dot', () => {
      expect(isHiddenEntry('.git')).toBe(true);
      expect(isHiddenEntry('.env')).toBe(true);
      expect(isHiddenEntry('.vscode')).toBe(true);
      expect(isHiddenEntry('.gitignore')).toBe(true);
      expect(isHiddenEntry('.hidden')).toBe(true);
    });
  });

  describe('macOS temp edit files (~$ prefix)', () => {
    it('should hide files with ~$ prefix (Office lock/temp files)', () => {
      expect(isHiddenEntry('~$Document.docx')).toBe(true);
      expect(isHiddenEntry('~$Budget.xlsx')).toBe(true);
      expect(isHiddenEntry('~$Filename.txt')).toBe(true);
      expect(isHiddenEntry('~$Presentation.pptx')).toBe(true);
    });

    it('should not hide files that merely contain ~ or $ elsewhere', () => {
      expect(isHiddenEntry('backup~')).toBe(false);
      expect(isHiddenEntry('file$name.txt')).toBe(false);
      expect(isHiddenEntry('$variable')).toBe(false);
    });

    it('should not hide a bare tilde filename', () => {
      expect(isHiddenEntry('~readme.txt')).toBe(false);
    });
  });

  describe('macOS system entries', () => {
    it('should hide known macOS system files/folders', () => {
      expect(isHiddenEntry('.DS_Store')).toBe(true);
      expect(isHiddenEntry('.Spotlight-V100')).toBe(true);
      expect(isHiddenEntry('.Trashes')).toBe(true);
      expect(isHiddenEntry('.fseventsd')).toBe(true);
      expect(isHiddenEntry('__MACOSX')).toBe(true);
      expect(isHiddenEntry('.DocumentRevisions-V100')).toBe(true);
      expect(isHiddenEntry('.TemporaryItems')).toBe(true);
    });

    it('should catch macOS system entries via the dotfile rule too', () => {
      // These are also dotfiles, so both rules apply
      expect(isHiddenEntry('.DS_Store')).toBe(true);
      expect(isHiddenEntry('.fseventsd')).toBe(true);
    });
  });

  describe('Windows system entries', () => {
    it('should hide known Windows system files/folders', () => {
      expect(isHiddenEntry('$RECYCLE.BIN')).toBe(true);
      expect(isHiddenEntry('System Volume Information')).toBe(true);
      expect(isHiddenEntry('Thumbs.db')).toBe(true);
      expect(isHiddenEntry('desktop.ini')).toBe(true);
      expect(isHiddenEntry('NTUSER.DAT')).toBe(true);
      expect(isHiddenEntry('ntuser.dat.LOG1')).toBe(true);
      expect(isHiddenEntry('ntuser.dat.LOG2')).toBe(true);
      expect(isHiddenEntry('ntuser.ini')).toBe(true);
    });
  });

  describe('visible entries (not hidden)', () => {
    it('should not hide regular files', () => {
      expect(isHiddenEntry('README.md')).toBe(false);
      expect(isHiddenEntry('package.json')).toBe(false);
      expect(isHiddenEntry('index.ts')).toBe(false);
      expect(isHiddenEntry('Cargo.toml')).toBe(false);
    });

    it('should not hide regular folders', () => {
      expect(isHiddenEntry('src')).toBe(false);
      expect(isHiddenEntry('node_modules')).toBe(false);
      expect(isHiddenEntry('dist')).toBe(false);
      expect(isHiddenEntry('__pycache__')).toBe(false);
    });

    it('should not hide files with dots in the middle', () => {
      expect(isHiddenEntry('file.test.ts')).toBe(false);
      expect(isHiddenEntry('my.config.json')).toBe(false);
    });
  });
});

describe('getFileIcon', () => {
  describe('directories', () => {
    it('should return FolderOpen for expanded directories', () => {
      expect(getFileIcon({ isDirectory: true, name: 'src' }, true)).toBe(FolderOpen);
    });

    it('should return Folder for collapsed directories', () => {
      expect(getFileIcon({ isDirectory: true, name: 'src' }, false)).toBe(Folder);
    });
  });

  describe('image files', () => {
    it('should return Image icon for image extensions', () => {
      for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']) {
        expect(getFileIcon({ isDirectory: false, extension: ext, name: `file.${ext}` }, false)).toBe(Image);
      }
    });
  });

  describe('code files', () => {
    it('should return FileCode icon for code extensions', () => {
      for (const ext of ['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'java', 'c', 'cpp', 'go', 'rb', 'swift', 'kt']) {
        expect(getFileIcon({ isDirectory: false, extension: ext, name: `file.${ext}` }, false)).toBe(FileCode);
      }
    });
  });

  describe('config/data files', () => {
    it('should return FileJson icon for config extensions', () => {
      for (const ext of ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env']) {
        expect(getFileIcon({ isDirectory: false, extension: ext, name: `file.${ext}` }, false)).toBe(FileJson);
      }
    });
  });

  describe('text files', () => {
    it('should return FileText icon for md, txt, log', () => {
      for (const ext of ['md', 'txt', 'log']) {
        expect(getFileIcon({ isDirectory: false, extension: ext, name: `file.${ext}` }, false)).toBe(FileText);
      }
    });
  });

  describe('other files', () => {
    it('should return generic File icon for unknown extensions', () => {
      expect(getFileIcon({ isDirectory: false, extension: 'pdf', name: 'doc.pdf' }, false)).toBe(File);
      expect(getFileIcon({ isDirectory: false, extension: 'zip', name: 'archive.zip' }, false)).toBe(File);
    });

    it('should return generic File icon for files without extension', () => {
      expect(getFileIcon({ isDirectory: false, name: 'Makefile' }, false)).toBe(File);
      expect(getFileIcon({ isDirectory: false, extension: undefined, name: 'Dockerfile' }, false)).toBe(File);
    });
  });

  describe('case sensitivity', () => {
    it('should match extensions case-insensitively', () => {
      expect(getFileIcon({ isDirectory: false, extension: 'PNG', name: 'photo.PNG' }, false)).toBe(Image);
      expect(getFileIcon({ isDirectory: false, extension: 'TS', name: 'file.TS' }, false)).toBe(FileCode);
      expect(getFileIcon({ isDirectory: false, extension: 'JSON', name: 'config.JSON' }, false)).toBe(FileJson);
    });
  });
});

describe('formatFileSize', () => {
  it('should format bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('should format kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('2 KB');
    expect(formatFileSize(10_240)).toBe('10 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024 KB');
  });

  it('should format megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});
