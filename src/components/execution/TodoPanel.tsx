'use client';

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Todo } from '@/shared';

interface TodoPanelProps {
  todos: Todo[];
  className?: string;
}

const STATUS_CONFIG: Record<Todo['status'], { icon: typeof Circle; color: string; animate?: boolean }> = {
  pending: { icon: Circle, color: 'text-muted-foreground' },
  in_progress: { icon: Loader2, color: 'text-primary', animate: true },
  completed: { icon: CheckCircle2, color: 'text-green-600' },
  cancelled: { icon: XCircle, color: 'text-muted-foreground/50' },
};

const STATUS_ORDER: Record<Todo['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
};

export const TodoPanel = memo(function TodoPanel({ todos, className }: TodoPanelProps) {
  const sortedTodos = useMemo(
    () => [...todos].sort((a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4)),
    [todos]
  );

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const totalCount = todos.length;

  if (totalCount === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      {/* Progress bar */}
      <div className="flex items-center gap-2 px-1">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">{completedCount}/{totalCount}</span>
      </div>
      {/* Todo items */}
      {sortedTodos.map((todo) => {
        const config = STATUS_CONFIG[todo.status];
        const Icon = config.icon;
        return (
          <div
            className={cn('flex items-center gap-1.5 rounded px-1 py-0.5 text-xs', todo.status === 'completed' && 'opacity-60')}
            key={todo.id}
          >
            <Icon className={cn('h-3 w-3 shrink-0', config.color, config.animate && 'animate-spin')} />
            <span className={cn('flex-1 truncate', todo.status === 'completed' && 'line-through text-muted-foreground')}>
              {todo.content}
            </span>
            {todo.priority === 'high' && (
              <span className="shrink-0 rounded-full bg-red-500/10 px-1 py-0.5 text-red-600 text-[10px] leading-none">!</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
