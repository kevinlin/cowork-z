import { CheckCircle2, Clock, Loader2, PauseCircle, Square, XCircle } from 'lucide-react';

export function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
    case 'starting':
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
}
