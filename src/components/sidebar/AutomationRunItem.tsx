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

export default function AutomationRunItem({ run, automationName, onClick }: AutomationRunItemProps) {
  const isUnread = !run.isRead && run.hasFindings;

  return (
    <button
      className={`w-full rounded-md border border-border p-2.5 text-left transition-colors hover:bg-accent/50 ${
        isUnread ? 'border-l-[3px] border-l-amber-500' : 'opacity-60'
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between">
        <span className={`truncate text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-foreground'}`}>{automationName}</span>
        <span className="ml-2 shrink-0 text-muted-foreground text-xs">{timeAgo(run.startedAt)}</span>
      </div>
      {run.status === 'running' && <div className="mt-1 text-blue-500 text-xs">Running...</div>}
      {run.status === 'completed' && run.hasFindings && <div className="mt-1 text-amber-500 text-xs">Has findings</div>}
      {run.status === 'completed' && !run.hasFindings && <div className="mt-1 text-green-500 text-xs">No issues found</div>}
      {run.status === 'failed' && <div className="mt-1 text-destructive text-xs">Failed</div>}
      {run.status === 'pending' && <div className="mt-1 text-muted-foreground text-xs">Pending...</div>}
    </button>
  );
}
