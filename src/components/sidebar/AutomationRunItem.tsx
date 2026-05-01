import type { AutomationRun } from '@/shared';

interface AutomationRunItemProps {
  run: AutomationRun;
  automationName: string;
  onClick: () => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusLabel(run: AutomationRun): { text: string; className: string } {
  if (run.status === 'running') return { text: 'Running…', className: 'text-blue-500' };
  if (run.status === 'completed' && run.hasFindings) return { text: 'Has findings', className: 'text-amber-500' };
  if (run.status === 'completed') return { text: 'No issues', className: 'text-green-500' };
  if (run.status === 'failed') return { text: 'Failed', className: 'text-destructive' };
  if (run.status === 'pending') return { text: 'Pending…', className: 'text-muted-foreground' };
  return { text: '', className: '' };
}

export default function AutomationRunItem({ run, automationName, onClick }: AutomationRunItemProps) {
  const isUnread = !run.isRead && run.hasFindings;
  const status = statusLabel(run);

  return (
    <button
      className={`w-full rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent/50 ${
        isUnread ? 'border-l-[3px] border-l-amber-500' : 'opacity-60'
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`shrink-0 text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground'}`}>{automationName}</span>
        {status.text && <span className={`min-w-0 truncate text-xs ${status.className}`}>{status.text}</span>}
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">{timeAgo(run.startedAt)}</span>
      </div>
    </button>
  );
}
