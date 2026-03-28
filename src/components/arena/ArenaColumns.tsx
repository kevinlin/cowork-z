import { useMemo, useState } from 'react';
import { ArenaColumn, StatusBadge } from '@/components/arena/ArenaColumn';
import { useArenaStore } from '@/stores/arenaStore';

export const ArenaColumns = () => {
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
  const columns = useArenaStore((s) => s.columns);
  const taskId0 = useArenaStore((s) => s.columns[0].taskId);
  const taskId1 = useArenaStore((s) => s.columns[1].taskId);
  const taskId2 = useArenaStore((s) => s.columns[2].taskId);
  const permissionRequests = useArenaStore((s) => s.permissionRequests);
  const questionRequest = useArenaStore((s) => s.questionRequest);

  const needsAttention = useMemo(() => {
    const taskIds = [taskId0, taskId1, taskId2];
    const flags: [boolean, boolean, boolean] = [false, false, false];
    for (const req of permissionRequests) {
      for (let i = 0; i < taskIds.length; i++) {
        if (taskIds[i] === req.taskId) flags[i as 0 | 1 | 2] = true;
      }
    }
    if (questionRequest) {
      for (let i = 0; i < taskIds.length; i++) {
        if (taskIds[i] === questionRequest.taskId) flags[i as 0 | 1 | 2] = true;
      }
    }
    return flags;
  }, [taskId0, taskId1, taskId2, permissionRequests, questionRequest]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex border-border border-b">
        {([0, 1, 2] as const).map((index) => {
          const col = columns[index];
          const label = col.modelDisplayName || col.modelId?.split('/').pop() || `Column ${index + 1}`;
          return (
            <button
              className={`flex flex-1 items-center justify-center gap-2 px-3 py-2 font-medium text-sm transition-colors ${
                activeTab === index
                  ? 'border-primary border-b-2 text-foreground'
                  : 'border-transparent border-b-2 text-muted-foreground hover:text-foreground'
              }`}
              key={index}
              onClick={() => setActiveTab(index)}
              type="button"
            >
              <span className="truncate">{label}</span>
              {col.status !== 'idle' && <StatusBadge status={col.status} />}
              {needsAttention[index] && activeTab !== index && (
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
              )}
            </button>
          );
        })}
      </div>

      <ArenaColumn index={activeTab} />
    </div>
  );
};
