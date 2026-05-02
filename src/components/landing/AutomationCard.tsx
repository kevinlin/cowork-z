import { Clock, MoreVertical, Pause, Play, Trash2, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { WEEKDAY_NAMES } from '@/lib/cron-utils';
import type { Automation } from '@/shared';

interface AutomationCardProps {
  automation: Automation;
  nextRunAt: string | null;
  onEdit: (automation: Automation) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatNextRun(isoTimestamp: string, cron: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '';

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ');

  const fields = cron.trim().split(/\s+/);
  const dowField = fields[4];
  const isSpecificDay = dowField !== '*' && !/[-,]/.test(dowField);

  if (isSpecificDay) {
    return `${WEEKDAY_NAMES[date.getDay()]} ${timeStr}`;
  }

  return timeStr;
}

export default function AutomationCard({ automation, nextRunAt, onEdit, onToggleEnabled, onRunNow, onDelete }: AutomationCardProps) {
  const nextRunDisplay = useMemo(
    () => (automation.enabled && nextRunAt ? formatNextRun(nextRunAt, automation.scheduleCron) : null),
    [automation.scheduleCron, automation.enabled, nextRunAt]
  );

  return (
    <div
      className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:bg-accent/50"
      onClick={() => onEdit(automation)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onEdit(automation);
      }}
      role="button"
      tabIndex={0}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-sm">{automation.name}</span>
          {automation.enabled ? (
            <span className="flex items-center gap-1 text-green-500 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Disabled</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <Clock className="h-3 w-3" />
          <span>{automation.scheduleDisplay}</span>
          {nextRunDisplay && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>Next: {nextRunDisplay}</span>
            </>
          )}
        </div>
      </div>

      <button
        aria-checked={automation.enabled}
        aria-label={automation.enabled ? 'Disable automation' : 'Enable automation'}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          automation.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleEnabled(automation.id, !automation.enabled);
        }}
        role="switch"
        type="button"
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            automation.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
            type="button"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onRunNow(automation.id);
            }}
          >
            <Zap className="mr-2 h-4 w-4" />
            Run Now
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onToggleEnabled(automation.id, !automation.enabled);
            }}
          >
            {automation.enabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {automation.enabled ? 'Disable' : 'Enable'}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(automation.id);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
