import { Clock, MoreVertical, Pause, Play, Trash2, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Automation } from '@/shared';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function parseCronField(field: string, max: number): number[] {
  const values: number[] = [];
  for (const part of field.split(',')) {
    const rangeParts = part.split('-');
    if (rangeParts.length === 2) {
      const start = Number.parseInt(rangeParts[0], 10);
      const end = Number.parseInt(rangeParts[1], 10);
      for (let i = start; i <= end; i++) values.push(i);
    } else if (part === '*') {
      for (let i = 0; i <= max; i++) values.push(i);
    } else {
      values.push(Number.parseInt(part, 10));
    }
  }
  return values.sort((a, b) => a - b);
}

function getNextCronDate(cron: string): Date | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const minutes = parseCronField(fields[0], 59);
  const hours = parseCronField(fields[1], 23);
  const daysOfWeek = parseCronField(fields[4], 7).map((d) => d % 7);

  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    candidate.setFullYear(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    if (!daysOfWeek.includes(candidate.getDay())) continue;

    for (const h of hours) {
      for (const m of minutes) {
        candidate.setHours(h, m, 0, 0);
        if (candidate > now) return candidate;
      }
    }
  }
  return null;
}

function getNextRunDisplay(cron: string): string | null {
  const next = getNextCronDate(cron);
  if (!next) return null;

  const timeStr = next.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s+/g, ' ');

  const fields = cron.trim().split(/\s+/);
  const dowField = fields[4];
  const isSpecificDay = dowField !== '*' && !/[-,]/.test(dowField);

  if (isSpecificDay) {
    return `${WEEKDAY_NAMES[next.getDay()]} ${timeStr}`;
  }

  return timeStr;
}

interface AutomationCardProps {
  automation: Automation;
  onEdit: (automation: Automation) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function AutomationCard({ automation, onEdit, onToggleEnabled, onRunNow, onDelete }: AutomationCardProps) {
  const nextRunDisplay = useMemo(
    () => (automation.enabled ? getNextRunDisplay(automation.scheduleCron) : null),
    [automation.scheduleCron, automation.enabled]
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
