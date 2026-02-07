'use client';

import { FolderPlus, Lock, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDefaultFolderPermissions, getHomeDir, pickFolder } from '@/lib/tauri-api';
import { cn } from '@/lib/utils';
import type { FolderAccessLevel, FolderPermission, FolderPermissionSource } from '@/shared';
import { useTaskStore } from '@/stores/taskStore';
import CollapsibleSection from '@/components/layout/CollapsibleSection';

/**
 * Format a folder path for display:
 * - If path starts with home dir, show as ~/relative/path
 * - Otherwise show the absolute path
 */
function formatFolderPath(path: string, homeDir: string | null): string {
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length);
    // Handle trailing slash in homeDir
    const cleanRelative = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return cleanRelative ? `~/${cleanRelative}` : '~';
  }
  return path;
}

interface FolderItemProps {
  path: string;
  displayPath: string;
  accessLevel: FolderAccessLevel;
  isDefault?: boolean;
  source?: FolderPermissionSource;
  onRemove: () => void;
}

function AccessBadge({ level }: { level: FolderAccessLevel }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none',
        level === 'read'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      )}
    >
      {level === 'read' ? 'R' : 'RW'}
    </span>
  );
}

function FolderItem({ path, displayPath, accessLevel, isDefault, source, onRemove }: FolderItemProps) {
  const isAdhoc = source === 'adhoc';
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-2 py-1.5',
        'text-sm text-zinc-700 hover:bg-accent hover:text-accent-foreground',
        'transition-colors duration-200',
        isDefault && 'opacity-75'
      )}
      title={`${path} (${accessLevel}${isAdhoc ? ', auto-granted' : ''})`}
    >
      {isDefault && <Lock className="h-3 w-3 shrink-0 text-zinc-400" />}
      {isAdhoc && <ShieldCheck className="h-3 w-3 shrink-0 text-green-500" />}
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          direction: 'rtl',
          textAlign: 'left',
        }}
      >
        {/* Use Unicode LRO to preserve folder name display while truncating from left */}
        <bdi>{displayPath}</bdi>
      </span>
      <AccessBadge level={accessLevel} />
      {!isDefault && (
        <button
          aria-label="Remove folder"
          className={cn(
            'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
            'rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/20',
            'text-zinc-400 hover:text-red-600 dark:hover:text-red-400',
            'shrink-0'
          )}
          onClick={onRemove}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function FoldersPanel() {
  const { folderPermissions, addFolderPermission, removeFolderPermission } = useTaskStore();
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [defaultPermissions, setDefaultPermissions] = useState<FolderPermission[]>([]);
  const [showAccessPicker, setShowAccessPicker] = useState(false);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);

  // Fetch home directory and default permissions on mount
  useEffect(() => {
    getHomeDir()
      .then(setHomeDirectory)
      .catch((err) => {
        console.error('Failed to get home directory:', err);
      });

    getDefaultFolderPermissions()
      .then(setDefaultPermissions)
      .catch((err) => {
        console.error('Failed to get default folder permissions:', err);
      });
  }, []);

  const handleAddFolder = async () => {
    try {
      const selectedPath = await pickFolder();
      if (selectedPath) {
        // Check if it's already in the list (user-added or default)
        const isAlreadyAdded = folderPermissions.some((fp) => fp.folderPath === selectedPath);
        const isDefault = defaultPermissions.some((fp) => fp.folderPath === selectedPath);
        if (isAlreadyAdded || isDefault) {
          return;
        }
        setPendingFolderPath(selectedPath);
        setShowAccessPicker(true);
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  const handleAccessLevelSelect = (level: FolderAccessLevel) => {
    if (pendingFolderPath) {
      addFolderPermission(pendingFolderPath, level);
    }
    setPendingFolderPath(null);
    setShowAccessPicker(false);
  };

  const handleCancelAccessPicker = () => {
    setPendingFolderPath(null);
    setShowAccessPicker(false);
  };

  const addButton = (
    <Button
      className="h-5 w-5 p-0"
      onClick={handleAddFolder}
      size="icon"
      title="Add Folder"
      variant="ghost"
    >
      <FolderPlus className="h-3 w-3" />
    </Button>
  );

  // Merge default, user-added, and adhoc permissions for display
  const allPermissions = [
    ...defaultPermissions.map((fp) => ({ ...fp, isDefault: true, source: undefined as FolderPermissionSource | undefined })),
    ...folderPermissions.filter(
      (fp) => !defaultPermissions.some((d) => d.folderPath === fp.folderPath)
    ).map((fp) => ({ ...fp, isDefault: false })),
  ];

  return (
    <CollapsibleSection
      action={addButton}
      defaultOpen={true}
      title="Folders"
    >
      {/* Access level picker overlay */}
      {showAccessPicker && pendingFolderPath && (
        <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-1.5 truncate text-xs text-zinc-500" title={pendingFolderPath}>
            {formatFolderPath(pendingFolderPath, homeDirectory)}
          </div>
          <div className="flex gap-1.5">
            <button
              className="flex-1 rounded-md border border-zinc-200 px-2 py-1 text-xs transition-colors hover:bg-blue-50 hover:border-blue-300 dark:border-zinc-600 dark:hover:bg-blue-900/20 dark:hover:border-blue-700"
              onClick={() => handleAccessLevelSelect('read')}
              type="button"
            >
              Read Only
            </button>
            <button
              className="flex-1 rounded-md border border-zinc-200 px-2 py-1 text-xs transition-colors hover:bg-amber-50 hover:border-amber-300 dark:border-zinc-600 dark:hover:bg-amber-900/20 dark:hover:border-amber-700"
              onClick={() => handleAccessLevelSelect('read-write')}
              type="button"
            >
              Read &amp; Write
            </button>
          </div>
          <button
            className="mt-1.5 w-full text-center text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            onClick={handleCancelAccessPicker}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {allPermissions.length === 0 ? (
        <div className="px-2 py-3 text-center text-muted-foreground text-xs">
          No folders added
        </div>
      ) : (
        <div className="space-y-0.5">
          {allPermissions.map((fp) => (
            <FolderItem
              accessLevel={fp.accessLevel}
              displayPath={formatFolderPath(fp.folderPath, homeDirectory)}
              isDefault={fp.isDefault}
              key={fp.folderPath}
              onRemove={() => removeFolderPermission(fp.folderPath)}
              path={fp.folderPath}
              source={fp.source}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
