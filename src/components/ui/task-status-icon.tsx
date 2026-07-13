import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Clock, Loader2, PauseCircle, Square, XCircle } from 'lucide-react';
import { useState } from 'react';
import { springs } from '@/lib/animations';

export function TaskStatusIcon({ status }: { status: string }) {
  const reduceMotion = useReducedMotion();
  // Prev-status tracking so the check only pops when a task finishes while
  // on screen (running → completed), never for tasks that load already done.
  const [prevStatus, setPrevStatus] = useState(status);
  const [justCompleted, setJustCompleted] = useState(false);

  if (status !== prevStatus) {
    setPrevStatus(status);
    setJustCompleted((prevStatus === 'running' || prevStatus === 'starting') && status === 'completed');
  }

  switch (status) {
    case 'running':
    case 'starting':
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin-ccw text-primary" />;
    case 'completed':
      if (justCompleted && !reduceMotion) {
        return (
          <motion.span animate={{ scale: 1 }} className="flex shrink-0" initial={{ scale: 0 }} transition={springs.bouncy}>
            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
          </motion.span>
        );
      }
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
}
