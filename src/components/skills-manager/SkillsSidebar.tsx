import { homeDir } from '@tauri-apps/api/path';
import { useCallback, useEffect } from 'react';
import { useFileTree } from '@/hooks/useFileTree';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';
import { FolderSwitcher } from './FolderSwitcher';

function isHiddenEntry(entry: DirectoryEntry): boolean {
  return entry.name.startsWith('.');
}

export function SkillsSidebar() {
  const { targetFolder } = useSkillsManagerStore();
  const { openPreview } = useFilePreviewStore();

  const filterPredicate = useCallback((entry: DirectoryEntry) => !isHiddenEntry(entry), []);

  const { nodes, isLoadingRoot, searchQuery, loadRoot, toggleExpand, setSearchQuery } = useFileTree(filterPredicate);

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

      <div className="border-b p-2">
        <input
          className="w-full rounded border bg-background px-2 py-1 text-xs"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search installed skills..."
          type="text"
          value={searchQuery}
        />
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
