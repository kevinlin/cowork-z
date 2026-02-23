'use client';

import { Check, ChevronDown, FolderPlus, X } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pickFolder } from '@/lib/tauri-api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export default function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, switchWorkspace, addWorkspace, removeWorkspace } = useWorkspaceStore();

  const handleAddWorkspace = useCallback(async () => {
    const folderPath = await pickFolder();
    if (!folderPath) return;
    try {
      const ws = await addWorkspace(folderPath);
      await switchWorkspace(ws.id);
    } catch (e) {
      console.error('Failed to add workspace:', e);
    }
  }, [addWorkspace, switchWorkspace]);

  const handleRemove = useCallback(
    async (e: React.MouseEvent, workspaceId: string) => {
      e.stopPropagation();
      if (!window.confirm('Remove this workspace from the list? Sessions will be preserved.')) return;
      try {
        await removeWorkspace(workspaceId);
      } catch (err) {
        console.error('Failed to remove workspace:', err);
      }
    },
    [removeWorkspace]
  );

  if (!activeWorkspace) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="w-full justify-between gap-1 truncate px-3 font-medium text-base text-primary" size="sm" variant="ghost">
          <span className="truncate" title={activeWorkspace.folderPath}>
            {activeWorkspace.displayName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {workspaces.map((ws) => (
          <DropdownMenuItem
            className="group flex items-center justify-between gap-2"
            key={ws.id}
            onClick={() => {
              if (ws.id !== activeWorkspace.id) {
                switchWorkspace(ws.id);
              }
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {ws.id === activeWorkspace.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="truncate font-medium">{ws.displayName}</span>
              </div>
              <p className="truncate text-muted-foreground text-xs">{ws.folderPath}</p>
            </div>
            {ws.id !== activeWorkspace.id && (
              <button
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                onClick={(e) => handleRemove(e, ws.id)}
                title="Remove workspace"
                type="button"
              >
                <X className="h-3.5 w-3.5 text-destructive" />
              </button>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleAddWorkspace}>
          <FolderPlus className="mr-2 h-4 w-4" />
          Add Workspace...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
