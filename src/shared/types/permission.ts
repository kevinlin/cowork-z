/**
 * Permission and interactive prompt types
 */

/** File operation types for RequestFilePermission tool */
export type FileOperation = 'create' | 'delete' | 'rename' | 'move' | 'modify' | 'overwrite';

/** Access level for folder permissions */
export type FolderAccessLevel = 'read' | 'read-write';

/** Source of a folder permission */
export type FolderPermissionSource = 'user' | 'adhoc' | 'workspace';

/** Folder permission for a task */
export interface FolderPermission {
  folderPath: string;
  accessLevel: FolderAccessLevel;
  /** Source: 'user' (added via FoldersPanel) or 'adhoc' (granted from permission prompt) */
  source?: FolderPermissionSource;
}

export interface PermissionRequest {
  id: string;
  taskId: string;
  type: 'tool' | 'question' | 'file';
  /** Tool name if type is 'tool' */
  toolName?: string;
  /** Tool input if type is 'tool' */
  toolInput?: unknown;
  /** Question text if type is 'question', or description for 'file' */
  question?: string;
  /** Short header/title for the question */
  header?: string;
  /** Available options for selection */
  options?: PermissionOption[];
  /** Allow multiple selections */
  multiSelect?: boolean;
  /** File operation type if type is 'file' */
  fileOperation?: FileOperation;
  /** File path being operated on if type is 'file' */
  filePath?: string;
  /** Multiple file paths for batch operations (e.g., deleting multiple files) */
  filePaths?: string[];
  /** Target path for rename/move operations */
  targetPath?: string;
  /** Preview of content (truncated) for create/modify/overwrite */
  contentPreview?: string;
  /** Permission patterns (e.g., directory paths, command patterns) */
  patterns?: string[];
  /** Timeout in milliseconds */
  timeoutMs?: number;
  createdAt: string;
}

export interface PermissionOption {
  label: string;
  description?: string;
}

export interface PermissionResponse {
  requestId: string;
  /** Task ID to route response to the correct task */
  taskId: string;
  decision: 'allow' | 'deny';
  /** User message/reason */
  message?: string;
  /** Selected options for questions */
  selectedOptions?: string[];
  /** Custom text response for "Other" option */
  customText?: string;
  /** Permission patterns (e.g., file paths being edited) - passed through for adhoc persistence */
  patterns?: string[];
}
