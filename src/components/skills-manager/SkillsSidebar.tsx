import { homeDir } from '@tauri-apps/api/path';
import { Eye, EyeOff, Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHiddenEntry, TreeRow } from '@/components/sidebar/FileTreePanel';
import { useFileTree } from '@/hooks/useFileTree';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { FolderSwitcher } from './FolderSwitcher';

export function SkillsSidebar() {
  const { targetFolder } = useSkillsManagerStore();
  const { selectedFile, openPreview } = useFilePreviewStore();
  const [showHidden, setShowHidden] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const hiddenFilter = useMemo(() => {
    if (showHidden) return undefined;
    return (entry: { name: string }) => !isHiddenEntry(entry.name);
  }, [showHidden]);

  const { nodes, isLoadingRoot, searchQuery, loadRoot, toggleExpand, refreshRoot, setSearchQuery } = useFileTree(hiddenFilter);

  useEffect(() => {
    const loadFolder = async () => {
      const home = await homeDir();
      const homePath = home.endsWith('/') ? home : `${home}/`;
      const paths: Record<string, string> = {
        opencode: `${homePath}.config/opencode/skills`,
        claude: `${homePath}.claude/skills`,
        agents: `${homePath}.agents/skills`,
      };
      const path = paths[targetFolder];
      if (path) {
        loadRoot(path);
      }
    };
    loadFolder();
  }, [targetFolder, loadRoot]);

  useEffect(() => {
    const api = getTauriAPI();
    const unlisten = api.onSkillsChanged(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        refreshRoot();
      }, 200);
    });
    return () => {
      unlisten();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refreshRoot]);

  const handleSelect = useCallback(
    (entry: DirectoryEntry) => {
      openPreview(entry);
    },
    [openPreview]
  );

  return (
    <div className="flex h-full flex-col">
      <FolderSwitcher />

      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-border bg-background py-1 pr-2 pl-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search installed skills..."
            type="text"
            value={searchQuery}
          />
        </div>
        <button
          className={cn(
            'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            showHidden && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setShowHidden((v) => !v)}
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          type="button"
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {isLoadingRoot ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="px-2 py-8 text-center text-muted-foreground text-xs">
            {searchQuery ? 'No files found' : 'No skills installed'}
          </div>
        ) : (
          nodes.map((node) => (
            <TreeRow
              depth={0}
              key={node.entry.path}
              node={node}
              onDelete={refreshRoot}
              onSelect={handleSelect}
              onToggle={toggleExpand}
              selectedPath={selectedFile?.path}
            />
          ))
        )}
      </div>
    </div>
  );
}
