'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
  action?: ReactNode;
  className?: string;
}

export default function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  disabled = false,
  action,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggleOpen = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={cn('border-border border-t', className)}>
      {/* Header */}
      <button
        className={cn(
          'flex w-full items-center justify-between px-3 py-2 text-left text-muted-foreground text-xs font-medium uppercase tracking-wide',
          'hover:bg-accent/50 transition-colors',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        disabled={disabled}
        onClick={toggleOpen}
        type="button"
      >
        <div className="flex items-center gap-1">
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>{title}</span>
        </div>
        {action && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {action}
          </div>
        )}
      </button>

      {/* Collapsible Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <div className="px-2 pb-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
