import { ChevronRight, Columns3, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TaskStatusIcon } from '@/components/ui/task-status-icon';
import { cn } from '@/lib/utils';
import type { ArenaChildTask, ArenaListItem as ArenaListItemType } from '@/shared';
import { useArenaStore } from '@/stores/arenaStore';

interface ArenaListItemProps {
  arena: ArenaListItemType;
}

function getChildDisplayName(task: ArenaChildTask): string {
  if (task.summary) return task.summary;
  if (task.modelId) {
    const parts = task.modelId.split('/');
    return parts[parts.length - 1];
  }
  return `Agent ${(task.arenaSlot ?? 0) + 1}`;
}

export default function ArenaListItem({ arena }: ArenaListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === `/arena/${arena.id}`;
  const deleteArena = useArenaStore((state) => state.deleteArena);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    navigate(`/arena/${arena.id}`);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setIsDeleteDialogOpen(false);
    try {
      await deleteArena(arena.id);
      if (isActive) {
        navigate('/');
      }
    } catch (err) {
      console.error('Failed to delete arena:', err);
    }
  };

  const isRunning = arena.status === 'running' || arena.status === 'starting';

  return (
    <>
      <div
        className={cn(
          'w-full rounded-md px-2 py-2 text-left text-sm transition-colors duration-200',
          'text-foreground hover:bg-accent hover:text-accent-foreground',
          'group relative flex cursor-pointer items-center gap-1.5',
          isActive && 'bg-accent text-accent-foreground'
        )}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        title={arena.prompt}
      >
        <button
          aria-label={expanded ? 'Collapse arena sessions' : 'Expand arena sessions'}
          className="shrink-0 rounded p-0.5 hover:bg-accent-foreground/10"
          onClick={handleToggleExpand}
          type="button"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        </button>
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : (
          <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="block flex-1 truncate">{arena.prompt}</span>
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            arena.status === 'running' || arena.status === 'starting'
              ? 'bg-green-500'
              : arena.status === 'failed'
                ? 'bg-red-500'
                : 'bg-zinc-400 dark:bg-zinc-500'
          )}
        />
        <button
          aria-label="Delete arena"
          className={cn(
            'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
            'rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/20',
            'text-muted-foreground hover:text-red-600 dark:hover:text-red-400',
            'shrink-0'
          )}
          onClick={handleDeleteClick}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {expanded && arena.tasks.length > 0 && (
        <div className="space-y-0.5">
          {arena.tasks.map((task) => {
            const displayName = getChildDisplayName(task);
            return (
              <div
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 pl-9 text-left text-xs transition-colors duration-200',
                  'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  location.pathname === `/execution/${task.id}` && 'bg-accent text-accent-foreground'
                )}
                key={task.id}
                onClick={() => navigate(`/execution/${task.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/execution/${task.id}`);
                  }
                }}
                role="button"
                tabIndex={0}
                title={displayName}
              >
                <TaskStatusIcon status={task.status} />
                <span className="flex-1 truncate">{displayName}</span>
              </div>
            );
          })}
        </div>
      )}

      <Dialog onOpenChange={setIsDeleteDialogOpen} open={isDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete arena</DialogTitle>
            <DialogDescription>This will remove the arena session and all its tasks from your history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setIsDeleteDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={confirmDelete} variant="destructive">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
