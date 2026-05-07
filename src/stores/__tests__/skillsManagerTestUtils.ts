import type { SkillRepo } from '@/lib/tauri-api';

export const makeRepo = (id: string, url: string): SkillRepo => ({
  id,
  url,
  name: id,
  branch: 'main',
  hasAuthToken: false,
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: new Date().toISOString(),
  skillCount: 0,
});
