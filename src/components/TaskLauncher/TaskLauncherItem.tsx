'use client';

import { AlertCircle, CheckCircle2, FolderOpen, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task, Workspace } from '@/shared';

interface TaskLauncherItemProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
  workspace?: Workspace;
  activeWorkspaceId?: string;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getStatusIcon(status: Task['status']) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />;
    case 'completed':
      return <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />;
    case 'failed':
      return <XCircle className="h-3 w-3 shrink-0 text-destructive" />;
    case 'cancelled':
    case 'interrupted':
      return <AlertCircle className="h-3 w-3 shrink-0 text-yellow-500" />;
    default:
      return null;
  }
}

export default function TaskLauncherItem({ task, isSelected, onClick, workspace, activeWorkspaceId }: TaskLauncherItemProps) {
  const isDifferentWorkspace = task.workspaceId && task.workspaceId !== activeWorkspaceId;

  return (
    <button
      className={cn(
        'w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-100',
        'flex items-center gap-2',
        isSelected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent'
      )}
      onClick={onClick}
    >
      {getStatusIcon(task.status)}
      <span className="min-w-0 flex-1 truncate">{task.prompt}</span>
      {workspace && (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 text-xs',
            isSelected ? 'text-primary-foreground/70' : isDifferentWorkspace ? 'text-primary' : 'text-muted-foreground'
          )}
          title={workspace.folderPath}
        >
          <FolderOpen className="h-3 w-3" />
          {workspace.displayName}
        </span>
      )}
      <span className={cn('shrink-0 text-xs', isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
        {formatRelativeDate(task.createdAt)}
      </span>
    </button>
  );
}
