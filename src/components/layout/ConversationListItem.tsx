'use client';

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Task } from '@/shared';
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle, Clock, Square, PauseCircle, X } from 'lucide-react';
import { useTaskStore } from '@/stores/taskStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
        return <Loader2 className="h-3 w-3 animate-spin-ccw text-primary shrink-0" />;
      case 'completed':
        return <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />;
      case 'failed':
        return <XCircle className="h-3 w-3 text-red-500 shrink-0" />;
      case 'cancelled':
        return <Square className="h-3 w-3 text-zinc-400 shrink-0" />;
      case 'interrupted':
        return <PauseCircle className="h-3 w-3 text-amber-500 shrink-0" />;
      case 'queued':
        return <Clock className="h-3 w-3 text-amber-500 shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        title={task.summary || task.prompt}
        className={cn(
          'w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-200',
          'text-zinc-700 hover:bg-accent hover:text-accent-foreground',
          'flex items-center gap-2 group relative cursor-pointer',
          isActive && 'bg-accent text-accent-foreground'
        )}
      >
        {getStatusIcon()}
        <span className="block truncate flex-1">{task.summary || task.prompt}</span>
        <button
          type="button"
          onClick={handleDeleteClick}
          className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
            'p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20',
            'text-zinc-400 hover:text-red-600 dark:hover:text-red-400',
            'shrink-0'
          )}
          aria-label="Delete task"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="delete-task-dialog">
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>
              This will remove the task and its messages from your history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
