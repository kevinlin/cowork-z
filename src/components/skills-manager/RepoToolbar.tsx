import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { openExternal } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { AddRepoDialog } from './AddRepoDialog';

function gitUrlToWebUrl(gitUrl: string): string | null {
  try {
    const cleaned = gitUrl.replace(/\.git$/, '');
    const url = new URL(cleaned);
    if (url.protocol === 'https:' || url.protocol === 'http:') return cleaned;
  } catch {
    // SSH-style: git@github.com:org/repo.git
    const m = gitUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (m) return `https://${m[1]}/${m[2]}`;
  }
  return null;
}

export function RepoToolbar() {
  const { repos, selectedRepoId, setSelectedRepoId, removeRepo, refreshAll, addRepoDialogOpen, setAddRepoDialogOpen } =
    useSkillsManagerStore();
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState(false);

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

        {selectedRepoId &&
          (() => {
            const repo = repos.find((r) => r.id === selectedRepoId);
            const webUrl = repo ? gitUrlToWebUrl(repo.url) : null;
            if (!webUrl) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button className="h-8 w-8 p-0" onClick={() => openExternal(webUrl)} size="sm" variant="outline">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  <p className="text-xs">{webUrl}</p>
                </TooltipContent>
              </Tooltip>
            );
          })()}

        <Button className="h-8 text-xs" onClick={() => setAddRepoDialogOpen(true)} size="sm" variant="outline">
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

      <AddRepoDialog onOpenChange={setAddRepoDialogOpen} open={addRepoDialogOpen} />
    </>
  );
}
