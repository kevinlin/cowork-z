import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [authToken, setAuthToken] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const { refreshAll } = useSkillsManagerStore();

  const handleAdd = async () => {
    if (!url.trim()) {
      setError('Repository URL is required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const api = getTauriAPI();
      await api.skillReposAdd(url.trim(), branch.trim() || undefined, authToken.trim() || undefined);
      await refreshAll();
      setUrl('');
      setBranch('main');
      setAuthToken('');
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Skill Repository</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input id="repo-url" onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" value={url} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-branch">Branch</Label>
            <Input id="repo-branch" onChange={(e) => setBranch(e.target.value)} placeholder="main" value={branch} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-token">
              Personal Access Token <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input id="repo-token" onChange={(e) => setAuthToken(e.target.value)} placeholder="ghp_..." type="password" value={authToken} />
            <p className="text-muted-foreground text-xs">Required for private repositories. Stored in your OS keychain.</p>
          </div>
          {error && <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-destructive text-xs">{error}</div>}
        </div>
        <DialogFooter>
          <Button disabled={adding} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={adding || !url.trim()} onClick={handleAdd}>
            {adding ? 'Cloning...' : 'Add Repository'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
