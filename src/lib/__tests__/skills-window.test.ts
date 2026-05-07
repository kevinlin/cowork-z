import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetByLabel, mockSetFocus, WebviewWindowMock } = vi.hoisted(() => {
  const mockGetByLabel = vi.fn();
  const mockSetFocus = vi.fn();
  const WebviewWindowMock = vi.fn();
  return { mockGetByLabel, mockSetFocus, WebviewWindowMock };
});

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(WebviewWindowMock, {
    getByLabel: mockGetByLabel,
  }),
}));

import { openSkillsManagerForRepo, PENDING_FOCUS_REPO_KEY, readAndClearPendingFocusRepo } from '../skills-window';

describe('skills-window helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetByLabel.mockResolvedValue(null);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('openSkillsManagerForRepo', () => {
    it('writes localStorage with the JSON-encoded repo payload', async () => {
      await openSkillsManagerForRepo({ url: 'https://github.com/x/y.git', branch: 'develop' });

      expect(localStorage.getItem(PENDING_FOCUS_REPO_KEY)).toBe(JSON.stringify({ url: 'https://github.com/x/y.git', branch: 'develop' }));
    });

    it('focuses the existing window when one is already open', async () => {
      mockGetByLabel.mockResolvedValue({ setFocus: mockSetFocus });

      await openSkillsManagerForRepo({ url: 'https://github.com/a/b.git' });

      expect(mockSetFocus).toHaveBeenCalled();
      expect(WebviewWindowMock).not.toHaveBeenCalled();
      expect(localStorage.getItem(PENDING_FOCUS_REPO_KEY)).toBe(JSON.stringify({ url: 'https://github.com/a/b.git' }));
    });

    it('opens a new window when none is open', async () => {
      mockGetByLabel.mockResolvedValue(null);

      await openSkillsManagerForRepo({ url: 'https://github.com/c/d.git' });

      expect(WebviewWindowMock).toHaveBeenCalledTimes(1);
      const [label, options] = WebviewWindowMock.mock.calls[0] as [string, { url: string; title: string }];
      expect(label).toBe('skills');
      expect(options.url).toBe('/#/skills');
    });
  });

  describe('readAndClearPendingFocusRepo', () => {
    it('returns the parsed value and clears the key', () => {
      const payload = { url: 'https://github.com/x/y.git', branch: 'main' };
      localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify(payload));

      const result = readAndClearPendingFocusRepo();

      expect(result).toEqual(payload);
      expect(localStorage.getItem(PENDING_FOCUS_REPO_KEY)).toBeNull();
    });

    it('returns null and does not throw when the key is missing', () => {
      expect(readAndClearPendingFocusRepo()).toBeNull();
    });

    it('returns null on malformed JSON without throwing', () => {
      localStorage.setItem(PENDING_FOCUS_REPO_KEY, '{not-json');
      expect(() => readAndClearPendingFocusRepo()).not.toThrow();
      expect(readAndClearPendingFocusRepo()).toBeNull();
    });

    it('returns null when the parsed payload has no url', () => {
      localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ branch: 'main' }));
      expect(readAndClearPendingFocusRepo()).toBeNull();
    });

    it('preserves branch only when it is a string', () => {
      localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify({ url: 'https://github.com/x/y.git', branch: 42 }));
      const result = readAndClearPendingFocusRepo();
      expect(result).toEqual({ url: 'https://github.com/x/y.git', branch: undefined });
    });
  });
});
