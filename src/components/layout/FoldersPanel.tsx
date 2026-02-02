'use client';

import { FolderPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getHomeDir, pickFolder } from '@/lib/tauri-api';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import CollapsibleSection from './CollapsibleSection';

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
  onRemove: () => void;
}

function FolderItem({ path, displayPath, onRemove }: FolderItemProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5',
        'text-sm text-zinc-700 hover:bg-accent hover:text-accent-foreground',
        'transition-colors duration-200'
      )}
      title={path}
    >
      <span
        className="flex-1 truncate"
        style={{
          direction: 'rtl',
          textAlign: 'left',
        }}
      >
        {/* Use Unicode LRO to preserve folder name display while truncating from left */}
        <bdi>{displayPath}</bdi>
      </span>
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
    </div>
  );
}

export default function FoldersPanel() {
  const { folders, addFolder, removeFolder } = useTaskStore();
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);

  // Fetch home directory on mount
  useEffect(() => {
    getHomeDir()
      .then(setHomeDirectory)
      .catch((err) => {
        console.error('Failed to get home directory:', err);
      });
  }, []);

  const handleAddFolder = async () => {
    try {
      const selectedPath = await pickFolder();
      if (selectedPath) {
        addFolder(selectedPath);
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
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

  return (
    <CollapsibleSection
      action={addButton}
      defaultOpen={false}
      title="Folders"
    >
      {folders.length === 0 ? (
        <div className="px-2 py-3 text-center text-muted-foreground text-xs">
          No folders added
        </div>
      ) : (
        <div className="space-y-0.5">
          {folders.map((folder) => (
            <FolderItem
              displayPath={formatFolderPath(folder, homeDirectory)}
              key={folder}
              onRemove={() => removeFolder(folder)}
              path={folder}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
