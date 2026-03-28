import { useState } from 'react';
import { ArenaColumn, StatusBadge } from '@/components/arena/ArenaColumn';
import { useArenaStore } from '@/stores/arenaStore';

export const ArenaColumns = () => {
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
  const columns = useArenaStore((s) => s.columns);

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
            </button>
          );
        })}
      </div>

      <ArenaColumn index={activeTab} />
    </div>
  );
};
