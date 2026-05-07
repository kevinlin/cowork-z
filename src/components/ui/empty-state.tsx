import type * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function EmptyState({ className, children, ...props }: EmptyStateProps) {
  return (
    <div className={cn('py-4 text-center text-muted-foreground text-sm', className)} data-slot="empty-state" {...props}>
      {children}
    </div>
  );
}

export { EmptyState };
