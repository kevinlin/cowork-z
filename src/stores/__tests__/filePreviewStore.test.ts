import { beforeEach, describe, expect, it } from 'vitest';

import { useFilePreviewStore } from '../filePreviewStore';

describe('filePreviewStore.openPreviewByPath', () => {
  beforeEach(() => {
    useFilePreviewStore.setState({ selectedFile: null, isPreviewOpen: false });
  });

  it('opens the preview for a safe absolute path', () => {
    useFilePreviewStore.getState().openPreviewByPath('/Users/name/Pictures/photo.png');
    const state = useFilePreviewStore.getState();
    expect(state.isPreviewOpen).toBe(true);
    expect(state.selectedFile?.name).toBe('photo.png');
    expect(state.selectedFile?.extension).toBe('png');
  });

  it('rejects paths with traversal segments', () => {
    useFilePreviewStore.getState().openPreviewByPath('/Users/name/../../etc/passwd');
    const state = useFilePreviewStore.getState();
    expect(state.isPreviewOpen).toBe(false);
    expect(state.selectedFile).toBeNull();
  });

  it('rejects sensitive system paths', () => {
    for (const path of ['/System/Library/CoreServices/boot.efi', '/Library/Keychains/login.keychain', '/Users/name/.Trash/file.txt']) {
      useFilePreviewStore.getState().openPreviewByPath(path);
      const state = useFilePreviewStore.getState();
      expect(state.isPreviewOpen).toBe(false);
      expect(state.selectedFile).toBeNull();
    }
  });
});
