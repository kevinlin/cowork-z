import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

export function SkillsStatusBar() {
  const { repos, repoSkills, installedSkills } = useSkillsManagerStore();

  return (
    <div className="flex h-6 items-center gap-3 border-t px-4 text-muted-foreground text-xs">
      <span>
        {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
      </span>
      <span>
        {repoSkills.length} remote {repoSkills.length === 1 ? 'skill' : 'skills'}
      </span>
      <span>{installedSkills.length} installed</span>
    </div>
  );
}
