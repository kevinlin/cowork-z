import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Task } from '@/shared';
import { useTaskStore } from '../../stores/taskStore';

interface TaskHistoryProps {
  limit?: number;
  showTitle?: boolean;
}

export default function TaskHistory({ limit, showTitle = true }: TaskHistoryProps) {
  const { tasks, loadTasks, deleteTask, clearHistory } = useTaskStore();

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const displayedTasks = limit ? tasks.slice(0, limit) : tasks;

  if (displayedTasks.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-text-muted">No tasks yet. Start by describing what you want to accomplish.</p>
      </div>
    );
  }

  return (
    <div>
      {showTitle && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium text-lg text-text">Recent Tasks</h2>
          {tasks.length > 0 && !limit && (
            <button
              className="text-sm text-text-muted transition-colors hover:text-danger"
              onClick={() => {
                if (confirm('Are you sure you want to clear all task history?')) {
                  clearHistory();
                }
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {displayedTasks.map((task) => (
          <TaskHistoryItem key={task.id} onDelete={() => deleteTask(task.id)} task={task} />
        ))}
      </div>

      {limit && tasks.length > limit && (
        <Link className="mt-4 block text-center text-sm text-text-muted transition-colors hover:text-text" to="/history">
          View all {tasks.length} tasks
        </Link>
      )}
    </div>
  );
}

function TaskHistoryItem({ task, onDelete }: { task: Task; onDelete: () => void }) {
  const statusConfig: Record<string, { color: string; label: string }> = {
    completed: { color: 'bg-success', label: 'Completed' },
    running: { color: 'bg-accent-blue', label: 'Running' },
    failed: { color: 'bg-danger', label: 'Failed' },
    cancelled: { color: 'bg-text-muted', label: 'Cancelled' },
    pending: { color: 'bg-warning', label: 'Pending' },
    waiting_permission: { color: 'bg-warning', label: 'Waiting' },
  };

  const config = statusConfig[task.status] || statusConfig.pending;
  const timeAgo = getTimeAgo(task.createdAt);

  return (
    <Link
      className="flex items-center gap-4 rounded-card border border-border bg-background-card p-4 transition-all hover:shadow-card-hover"
      to={`/execution/${task.id}`}
    >
      <div className={`h-2 w-2 rounded-full ${config.color}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text" title={task.summary || task.prompt}>
          {task.summary || task.prompt}
        </p>
        <p className="mt-1 text-text-muted text-xs">
          {config.label} · {timeAgo} · {task.messages.length} messages
        </p>
      </div>
      <button
        className="p-2 text-text-muted transition-colors hover:text-danger"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm('Delete this task?')) {
            onDelete();
          }
        }}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </button>
    </Link>
  );
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
