import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { AddRepoDialog } from './AddRepoDialog';

export function RepoToolbar() {
  const { repos, selectedRepoId, setSelectedRepoId, removeRepo, refreshAll } = useSkillsManagerStore();
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showAddRepo, setShowAddRepo] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const api = getTauriAPI();
      await api.skillReposSyncAll();
      await refreshAll();
    } finally {
      setSyncing(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedRepoId) return;
    const repo = repos.find((r) => r.id === selectedRepoId);
    const name = repo?.name ?? 'this repository';
    if (!window.confirm(`Remove "${name}"? This will delete the local cache and all discovered skills from this repo.`)) return;
    setRemoving(true);
    try {
      await removeRepo(selectedRepoId);
    } finally {
      setRemoving(false);
    }
  };

  const lastSynced = repos.reduce<string | null>((latest, r) => {
    if (!r.lastSyncedAt) return latest;
    if (!latest) return r.lastSyncedAt;
    return r.lastSyncedAt > latest ? r.lastSyncedAt : latest;
  }, null);

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Select onValueChange={(v) => setSelectedRepoId(v === 'all' ? null : v)} value={selectedRepoId ?? 'all'}>
          <SelectTrigger className={`h-8 w-[300px] ${selectedRepoId ? 'border-primary/40 font-medium text-base text-primary' : ''}`}>
            <SelectValue placeholder="All Repos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Repos</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button className="h-8 text-xs" onClick={() => setShowAddRepo(true)} size="sm" variant="outline">
          <Plus className="mr-1 h-3 w-3" />
          Add Repo
        </Button>

        <Button className="h-8 text-xs" disabled={syncing || repos.length === 0} onClick={handleSync} size="sm" variant="outline">
          <RefreshCw className={`mr-1 h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
          Sync
        </Button>

        {selectedRepoId && (
          <Button
            className="h-8 text-destructive text-xs hover:bg-destructive/10 hover:text-destructive"
            disabled={removing}
            onClick={handleRemove}
            size="sm"
            title="Remove selected repository"
            variant="ghost"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            {removing ? 'Removing...' : 'Remove'}
          </Button>
        )}

        <div className="ml-auto text-muted-foreground text-xs">
          {lastSynced
            ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}`
            : repos.length > 0
              ? 'Not synced yet'
              : 'No repos added'}
        </div>
      </div>

      <AddRepoDialog onOpenChange={setShowAddRepo} open={showAddRepo} />
    </>
  );
}
