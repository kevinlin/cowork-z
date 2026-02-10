'use client';

import { CheckCircle2, Clock, Loader2, PauseCircle, Square, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Task } from '@/shared';
import { useTaskStore } from '@/stores/taskStore';

interface ConversationListItemProps {
  task: Task;
}

export default function ConversationListItem({ task }: ConversationListItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === `/execution/${task.id}`;
  const deleteTask = useTaskStore((state) => state.deleteTask);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const handleClick = () => {
    navigate(`/execution/${task.id}`);
  };

  const handleDelete = async (confirmedOverride?: boolean) => {
    const confirmed = confirmedOverride ?? window.confirm('Are you sure you want to delete this task?');

    if (!confirmed) {
      return;
    }

    try {
      await deleteTask(task.id);

      // Navigate to home if deleting the currently active task
      if (isActive) {
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    setIsDeleteDialogOpen(false);
    await handleDelete(true);
  };

  const getStatusIcon = () => {
    switch (task.status) {
      case 'running':
        return <Loader2 className="h-3 w-3 shrink-0 animate-spin-ccw text-primary" />;
      case 'completed':
        return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />;
      case 'failed':
        return <XCircle className="h-3 w-3 shrink-0 text-red-500" />;
      case 'cancelled':
        return <Square className="h-3 w-3 shrink-0 text-zinc-400" />;
      case 'interrupted':
        return <PauseCircle className="h-3 w-3 shrink-0 text-amber-500" />;
      case 'queued':
        return <Clock className="h-3 w-3 shrink-0 text-amber-500" />;
      default:
        return null;
    }
  };

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
        title={task.summary || task.prompt}
      >
        {getStatusIcon()}
        <span className="block flex-1 truncate">{task.summary || task.prompt}</span>
        <button
          aria-label="Delete task"
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
        <DialogContent className="max-w-sm" data-testid="delete-task-dialog">
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>This will remove the task and its messages from your history.</DialogDescription>
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
