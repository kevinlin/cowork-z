import { beforeEach, describe, expect, it } from 'vitest';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { selectActiveFile, useFilePreviewStore } from '../filePreviewStore';

function entry(path: string): DirectoryEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, isDirectory: false, isSymlink: false };
}

const store = () => useFilePreviewStore.getState();
const tabPaths = () => store().tabs.map((t) => t.path);

function openAll(...paths: string[]) {
  for (const path of paths) {
    store().openPreview(entry(path));
  }
}

beforeEach(() => {
  useFilePreviewStore.setState({ tabs: [], activePath: null, openSeq: 0 });
});

describe('filePreviewStore.openPreviewByPath', () => {
  it('opens a tab for a safe absolute path', () => {
    store().openPreviewByPath('/Users/name/Pictures/photo.png');
    const active = selectActiveFile(store());
    expect(tabPaths()).toEqual(['/Users/name/Pictures/photo.png']);
    expect(active?.name).toBe('photo.png');
    expect(active?.extension).toBe('png');
    expect(store().openSeq).toBe(1);
  });

  it('rejects paths with traversal segments without touching state', () => {
    store().openPreviewByPath('/Users/name/../../etc/passwd');
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(0);
  });

  it('rejects sensitive system paths without touching state', () => {
    for (const path of ['/System/Library/CoreServices/boot.efi', '/Library/Keychains/login.keychain', '/Users/name/.Trash/file.txt']) {
      store().openPreviewByPath(path);
    }
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(0);
  });
});

describe('filePreviewStore tabs', () => {
  it('re-opening an open path activates its tab without duplicating it and still bumps openSeq', () => {
    openAll('/w/a.md', '/w/b.md', '/w/a.md');
    expect(tabPaths()).toEqual(['/w/a.md', '/w/b.md']);
    expect(store().activePath).toBe('/w/a.md');
    expect(store().openSeq).toBe(3);
  });

  it('closing the active tab activates the tab to its right', () => {
    openAll('/w/a.md', '/w/b.md', '/w/c.md');
    store().setActive('/w/b.md');
    store().closeTab('/w/b.md');
    expect(tabPaths()).toEqual(['/w/a.md', '/w/c.md']);
    expect(store().activePath).toBe('/w/c.md');
  });

  it('closing the active last tab activates the tab to its left', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closeTab('/w/b.md');
    expect(store().activePath).toBe('/w/a.md');
  });

  it('closing the only tab returns to the Files tab', () => {
    openAll('/w/a.md');
    store().closeTab('/w/a.md');
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(selectActiveFile(store())).toBeNull();
  });

  it('closing an inactive tab keeps the active one', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closeTab('/w/a.md');
    expect(tabPaths()).toEqual(['/w/b.md']);
    expect(store().activePath).toBe('/w/b.md');
  });

  it('closing an unknown path changes nothing', () => {
    openAll('/w/a.md');
    store().closeTab('/w/zzz.md');
    expect(tabPaths()).toEqual(['/w/a.md']);
    expect(store().activePath).toBe('/w/a.md');
  });

  it('setActive(null) shows the Files tab without closing previews', () => {
    openAll('/w/a.md');
    store().setActive(null);
    expect(tabPaths()).toEqual(['/w/a.md']);
    expect(selectActiveFile(store())).toBeNull();
  });

  it('closePreview clears every tab but keeps openSeq', () => {
    openAll('/w/a.md', '/w/b.md');
    store().closePreview();
    expect(store().tabs).toEqual([]);
    expect(store().activePath).toBeNull();
    expect(store().openSeq).toBe(2);
  });
});
