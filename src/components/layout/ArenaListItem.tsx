import { Columns3, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ArenaListItem as ArenaListItemType } from '@/shared';
import { useArenaStore } from '@/stores/arenaStore';

interface ArenaListItemProps {
  arena: ArenaListItemType;
}

const StatusDot = ({ status }: { status: string }) => {
  const colorClass =
    status === 'running' || status === 'starting' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-zinc-400 dark:bg-zinc-500';

  return <span className={cn('h-2 w-2 shrink-0 rounded-full', colorClass)} />;
};

export default function ArenaListItem({ arena }: ArenaListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === `/arena/${arena.id}`;
  const deleteArena = useArenaStore((state) => state.deleteArena);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const handleClick = () => {
    navigate(`/arena/${arena.id}`);
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
          'w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200',
          'text-foreground hover:bg-accent hover:text-accent-foreground',
          'group relative flex cursor-pointer items-center gap-2',
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
        {isRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : (
          <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="block flex-1 truncate">{arena.prompt}</span>
        <StatusDot status={arena.status} />
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
