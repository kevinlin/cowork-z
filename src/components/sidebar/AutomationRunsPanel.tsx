import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAutomationStore } from '@/stores/automationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import AutomationRunItem from './AutomationRunItem';

export default function AutomationRunsPanel() {
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const navigate = useNavigate();

  const { automations, runs, loadAutomations, loadRuns, markAllRead } = useAutomationStore();
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadAutomations(activeWorkspace.id);
    }
  }, [activeWorkspace?.id, loadAutomations]);

  useEffect(() => {
    if (activeWorkspace?.id) {
      loadRuns(activeWorkspace.id, filter === 'unread');
    }
  }, [activeWorkspace?.id, filter, loadRuns]);

  const automationNames = useMemo(() => new Map(automations.map((a) => [a.id, a.name])), [automations]);

  const handleRunClick = (run: { taskId: string | null }) => {
    if (run.taskId) {
      navigate(`/execution/${run.taskId}`);
    }
  };

  if (!activeWorkspace) {
    return <div className="p-4 text-center text-muted-foreground text-xs">No workspace selected</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-border border-b px-3 py-2">
        <div className="flex gap-1">
          <button
            className={`rounded px-2 py-0.5 text-xs ${
              filter === 'unread' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setFilter('unread')}
            type="button"
          >
            Unread
          </button>
          <button
            className={`rounded px-2 py-0.5 text-xs ${
              filter === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setFilter('all')}
            type="button"
          >
            All
          </button>
        </div>
        <button
          className="text-muted-foreground text-xs hover:text-foreground"
          onClick={() => activeWorkspace && markAllRead(activeWorkspace.id)}
          type="button"
        >
          Mark all read
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-xs">
            {filter === 'unread' ? 'No unread automation runs' : 'No automation runs yet'}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {runs.map((run) => (
            <AutomationRunItem
              automationName={automationNames.get(run.automationId) ?? 'Automation'}
              key={run.id}
              onClick={() => handleRunClick(run)}
              run={run}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
