import { AnimatePresence, motion } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { staggerContainer } from '@/lib/animations';
import type { ArenaListItem as ArenaListItemType, Task } from '@/shared';
import ArenaListItem from './ArenaListItem';
import ConversationListItem from './ConversationListItem';

type MergedEntry = { type: 'arena'; item: ArenaListItemType; createdAt: string } | { type: 'task'; item: Task; createdAt: string };

interface SessionPanelProps {
  mergedList: MergedEntry[];
}

export default function SessionPanel({ mergedList }: SessionPanelProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-1 p-2">
        <AnimatePresence mode="wait">
          {mergedList.length === 0 ? (
            <motion.div
              animate={{ opacity: 1 }}
              className="px-3 py-8 text-center text-muted-foreground text-sm"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="empty"
            >
              No conversations yet
            </motion.div>
          ) : (
            <motion.div animate="animate" className="space-y-1" initial="initial" key="task-list" variants={staggerContainer}>
              {mergedList.map((entry) =>
                entry.type === 'arena' ? (
                  <ArenaListItem arena={entry.item} key={entry.item.id} />
                ) : (
                  <ConversationListItem key={entry.item.id} task={entry.item} />
                )
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ScrollArea>
  );
}
