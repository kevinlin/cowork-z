import { homeDir } from '@tauri-apps/api/path';
import { Eye, EyeOff, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHiddenEntry } from '@/components/sidebar/FileTreePanel';
import { useFileTree } from '@/hooks/useFileTree';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { FolderSwitcher } from './FolderSwitcher';

export function SkillsSidebar() {
  const { targetFolder } = useSkillsManagerStore();
  const { openPreview } = useFilePreviewStore();
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

  const handleFileClick = useCallback(
    (entry: DirectoryEntry) => {
      if (entry.isDirectory) {
        toggleExpand(entry.path);
      } else {
        openPreview(entry);
      }
    },
    [toggleExpand, openPreview]
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

      <div className="flex-1 overflow-auto p-1">
        {isLoadingRoot ? (
          <div className="p-2 text-muted-foreground text-xs">Loading...</div>
        ) : nodes.length === 0 ? (
          <div className="p-2 text-muted-foreground text-xs">No skills installed</div>
        ) : (
          <FileTreeNodes nodes={nodes} onFileClick={handleFileClick} onToggle={toggleExpand} />
        )}
      </div>
    </div>
  );
}

function FileTreeNodes({
  nodes,
  onFileClick,
  onToggle,
  depth = 0,
}: {
  nodes: ReturnType<typeof useFileTree>['nodes'];
  onFileClick: (entry: DirectoryEntry) => void;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.entry.path}>
          <button
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
            onClick={() => {
              if (node.entry.isDirectory) {
                onToggle(node.entry.path);
              } else {
                onFileClick(node.entry);
              }
            }}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            type="button"
          >
            <span className="shrink-0 text-muted-foreground">
              {node.entry.isDirectory ? (node.isExpanded ? '\u25BE' : '\u25B8') : '\u00B7'}
            </span>
            <span className="truncate">{node.entry.name}</span>
          </button>
          {node.isExpanded && node.children && (
            <FileTreeNodes depth={depth + 1} nodes={node.children} onFileClick={onFileClick} onToggle={onToggle} />
          )}
        </div>
      ))}
    </>
  );
}
