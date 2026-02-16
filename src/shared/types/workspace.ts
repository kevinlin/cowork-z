/**
 * Workspace types for the workspace-as-folder feature
 */

export interface Workspace {
  id: string;
  folderPath: string;
  displayName: string;
  createdAt: number;
  lastOpenedAt: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
}
