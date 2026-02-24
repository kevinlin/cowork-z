'use client';

import { CheckCircle2, Clock, Loader2, PauseCircle, Pencil, Square, Trash2, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const setTaskSummary = useTaskStore((state) => state.setTaskSummary);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRenameRef = useRef(false);

  const displayName = task.summary || task.prompt;

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      const el = inputRef.current;
      requestAnimationFrame(() => {
        el.focus();
        el.select();
      });
    }
  }, [isRenaming]);

  const handleClick = () => {
    if (isRenaming) return;
    navigate(`/execution/${task.id}`);
  };

  const handleDelete = async (confirmedOverride?: boolean) => {
    const confirmed = confirmedOverride ?? window.confirm('Are you sure you want to delete this task?');

    if (!confirmed) {
      return;
    }

    try {
      await deleteTask(task.id);

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

  const commitRename = () => {
    const newName = inputRef.current?.value.trim();
    if (newName && newName !== displayName) {
      setTaskSummary(task.id, newName);
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuOpen(true);
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
      <DropdownMenu
        onOpenChange={(open) => {
          setContextMenuOpen(open);
          if (!open && pendingRenameRef.current) {
            pendingRenameRef.current = false;
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setIsRenaming(true);
              });
            });
          }
        }}
        open={contextMenuOpen}
      >
        <DropdownMenuTrigger asChild>
          <div
            className={cn(
              'w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200',
              'text-foreground hover:bg-accent hover:text-accent-foreground',
              'group relative flex cursor-pointer items-center gap-2',
              isActive && 'bg-accent text-accent-foreground'
            )}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onKeyDown={(e) => {
              if (isRenaming) {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelRename();
                }
                return;
              }
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }}
            onPointerDown={(e) => {
              if (e.button === 0 && !isRenaming) {
                e.preventDefault();
              }
            }}
            role="button"
            tabIndex={0}
            title={isRenaming ? undefined : displayName}
          >
            {getStatusIcon()}
            {isRenaming ? (
              <input
                className="block flex-1 rounded border border-input bg-background px-1 py-0 text-foreground text-sm caret-foreground outline-none focus:ring-1 focus:ring-ring"
                defaultValue={displayName}
                onBlur={(e) => {
                  const goingTo = e.relatedTarget as HTMLElement | null;
                  const self = e.currentTarget as HTMLElement;
                  const isInternalFocusMove =
                    !goingTo || goingTo === document.body || goingTo.contains(self) || self.parentElement?.contains(goingTo);
                  if (isInternalFocusMove) {
                    inputRef.current?.focus();
                    return;
                  }
                  commitRename();
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  handleRenameKeyDown(e);
                }}
                ref={inputRef}
              />
            ) : (
              <span className="block flex-1 truncate">{displayName}</span>
            )}
            <button
              aria-label="Delete task"
              className={cn(
                'opacity-0 transition-opacity duration-200 group-hover:opacity-100',
                'rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/20',
                'text-muted-foreground hover:text-red-600 dark:hover:text-red-400',
                'shrink-0',
                isRenaming && 'hidden'
              )}
              onClick={handleDeleteClick}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onSelect={() => {
              pendingRenameRef.current = true;
            }}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setIsDeleteDialogOpen(true);
            }}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
