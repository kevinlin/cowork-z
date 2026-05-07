import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/** localStorage key used to hand off a pending repo URL between the main and skills windows. */
export const PENDING_FOCUS_REPO_KEY = 'skills:pendingFocusRepo';

export interface PendingFocusRepo {
  url: string;
  branch?: string;
}

export async function openSkillsManagerWindow() {
  const label = 'skills';
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: '/#/skills',
    title: 'Skills Manager',
    width: 1100,
    height: 750,
  });
}

/**
 * Open the Skills Manager and hand off a curated repo for auto-add / focus.
 *
 * `localStorage` is shared across same-origin Tauri webview windows and fires a
 * `storage` event in *other* windows when written, so this works whether the
 * Skills Manager is already open (live event) or not yet mounted (read on mount).
 */
export async function openSkillsManagerForRepo(repo: PendingFocusRepo): Promise<void> {
  localStorage.setItem(PENDING_FOCUS_REPO_KEY, JSON.stringify(repo));
  await openSkillsManagerWindow();
}

/** Read and clear the pending focus-repo handoff. Returns null if missing or malformed. */
export function readAndClearPendingFocusRepo(): PendingFocusRepo | null {
  const raw = localStorage.getItem(PENDING_FOCUS_REPO_KEY);
  if (!raw) return null;
  localStorage.removeItem(PENDING_FOCUS_REPO_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFocusRepo> | null;
    if (!parsed || typeof parsed.url !== 'string' || parsed.url.length === 0) {
      return null;
    }
    return {
      url: parsed.url,
      branch: typeof parsed.branch === 'string' ? parsed.branch : undefined,
    };
  } catch {
    return null;
  }
}
