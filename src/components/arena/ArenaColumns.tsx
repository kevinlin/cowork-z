import { ArenaColumn } from '@/components/arena/ArenaColumn';

export const ArenaColumns = () => {
  return (
    <div className="flex flex-1 divide-x divide-border overflow-hidden">
      <ArenaColumn index={0} />
      <ArenaColumn index={1} />
      <ArenaColumn index={2} />
    </div>
  );
};
