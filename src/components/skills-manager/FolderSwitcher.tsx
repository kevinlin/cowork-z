import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

const FOLDER_OPTIONS = [
  { value: 'opencode', label: 'OpenCode Skills', path: '~/.config/opencode/skills/' },
  { value: 'claude', label: 'Claude Skills', path: '~/.claude/skills/' },
  { value: 'agents', label: 'Agent Skills', path: '~/.agents/skills/' },
] as const;

export function FolderSwitcher() {
  const { targetFolder, setTargetFolder } = useSkillsManagerStore();

  return (
    <div className="border-b p-2">
      <Select onValueChange={(v) => setTargetFolder(v as 'opencode' | 'claude' | 'agents')} value={targetFolder}>
        <SelectTrigger className="h-8 border-primary/40 font-medium text-primary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FOLDER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div>
                <div className="font-medium">{opt.label}</div>
                <div className="text-muted-foreground text-xs">{opt.path}</div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
