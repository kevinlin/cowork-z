'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

// Context to share animation state with content
const DialogAnimationContext = React.createContext<{ isOpen: boolean }>({
  isOpen: false,
});

// Animation duration for exit (keep in sync with motion transitions below)
const EXIT_ANIMATION_DURATION = 100;

// Dialog with exit animation support
function Dialog({ open, onOpenChange, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  // Track if we should show the dialog (delays close for exit animation)
  const [shouldShow, setShouldShow] = React.useState(!!open);

  React.useEffect(() => {
    if (open) {
      setShouldShow(true);
    } else if (shouldShow) {
      // Only delay if we were previously showing
      const timer = setTimeout(() => setShouldShow(false), EXIT_ANIMATION_DURATION);
      return () => clearTimeout(timer);
    }
  }, [open, shouldShow]);

  return (
    <DialogAnimationContext.Provider value={{ isOpen: !!open }}>
      <DialogPrimitive.Root data-slot="dialog" onOpenChange={onOpenChange} open={shouldShow} {...props} />
    </DialogAnimationContext.Provider>
  );
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// DialogOverlay is handled inline in DialogContent for animation coordination

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { isOpen } = React.useContext(DialogAnimationContext);

  return (
    <DialogPortal>
      <DialogPrimitive.Overlay asChild>
        <motion.div
          animate={{ opacity: isOpen ? 1 : 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          transition={{ duration: EXIT_ANIMATION_DURATION / 1000 }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        data-slot="dialog-content"
        ref={ref}
        {...props}
      >
        <motion.div
          animate={{
            opacity: isOpen ? 1 : 0,
            scale: isOpen ? 1 : 0.95,
            y: isOpen ? 0 : -10,
          }}
          className={cn('relative grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg', className)}
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{
            duration: EXIT_ANIMATION_DURATION / 1000,
            ease: 'easeOut',
          }}
        >
          {children}
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} data-slot="dialog-header" {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} data-slot="dialog-footer" {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-semibold text-lg leading-none tracking-tight', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-muted-foreground text-sm', className)} data-slot="dialog-description" {...props} />
  );
}

export { Dialog, DialogPortal, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
