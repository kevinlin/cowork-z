import * as React from 'react';
import { cn } from '@/lib/utils';

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(({ className, children, ...props }, ref) => (
  <div className={cn('overflow-y-auto', className)} ref={ref} {...props}>
    {children}
  </div>
));
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
