'use client';

import {
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Link,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type FileTreeNode, useFileTree } from '@/hooks/useFileTree';
import { openFilePath, revealInFinder, trashFile } from '@/lib/tauri-api';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'java', 'c', 'cpp', 'go', 'rb', 'swift', 'kt']);
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);

/**
 * System/hidden folders that should be hidden by default.
 * Covers both macOS and Windows conventions.
 *
 * macOS: dotfiles/dotfolders (e.g. .git, .DS_Store), __MACOSX
 * Windows: $RECYCLE.BIN, System Volume Information, Thumbs.db, desktop.ini
 * Cross-platform: node_modules, __pycache__, .venv, etc. are NOT hidden
 *   — only OS-level system entries are filtered here.
 */
const SYSTEM_ENTRIES_MACOS = new Set([
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '__MACOSX',
  '.DocumentRevisions-V100',
  '.TemporaryItems',
]);
const SYSTEM_ENTRIES_WINDOWS = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'Thumbs.db',
  'desktop.ini',
  'NTUSER.DAT',
  'ntuser.dat.LOG1',
  'ntuser.dat.LOG2',
  'ntuser.ini',
]);

/**
 * Returns true if the entry is considered "hidden" (dotfile/dotfolder or OS system entry).
 * Works for both macOS and Windows naming conventions.
 */
export function isHiddenEntry(name: string): boolean {
  // Dotfiles/dotfolders (macOS/Linux convention, also common on Windows via Git etc.)
  if (name.startsWith('.')) return true;
  // macOS/Windows temp edit files (e.g. ~$Document.docx, ~$Budget.xlsx)
  // Created by Microsoft Office and other apps as lock/temporary files
  if (name.startsWith('~$')) return true;
  // macOS system entries
  if (SYSTEM_ENTRIES_MACOS.has(name)) return true;
  // Windows system entries (case-insensitive)
  if (SYSTEM_ENTRIES_WINDOWS.has(name)) return true;
  return false;
}

export function getFileIcon(entry: { isDirectory: boolean; extension?: string; name: string }, isExpanded: boolean) {
  if (entry.isDirectory) {
    return isExpanded ? FolderOpen : Folder;
  }
  const ext = entry.extension?.toLowerCase();
  if (ext && IMAGE_EXTENSIONS.has(ext)) return Image;
  if (ext && CODE_EXTENSIONS.has(ext)) return FileCode;
  if (ext && CONFIG_EXTENSIONS.has(ext)) return FileJson;
  if (ext === 'md' || ext === 'txt' || ext === 'log') return FileText;
  return File;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Custom MIME type for intra-app file tree drag-and-drop. */
export const FILE_TREE_MIME = 'application/x-cowork-file-path';

/**
 * Module-level state for intra-app drag-and-drop.
 *
 * Tauri intercepts all drag events at the native webview level, which prevents
 * HTML5 dragover/drop DOM events from reaching React handlers. Instead, the
 * Tauri `onDragDropEvent` fires with `paths: []` for intra-webview drags.
 *
 * We store the dragged path here on dragStart and read it from the Tauri drop
 * handler when `paths` is empty.
 */
let pendingDragPath: string | null = null;

export function getPendingDragPath(): string | null {
  return pendingDragPath;
}

export function clearPendingDragPath(): void {
  pendingDragPath = null;
}

interface TreeRowProps {
  node: FileTreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (entry: DirectoryEntry) => void;
  onDelete: () => void;
  selectedPath?: string;
}

export function TreeRow({ node, depth, onToggle, onSelect, onDelete, selectedPath }: TreeRowProps) {
  const { entry, isExpanded, isLoading } = node;
  const Icon = getFileIcon(entry, isExpanded);
  const isSelected = !entry.isDirectory && entry.path === selectedPath;

  const handleClick = () => {
    if (entry.isDirectory) {
      onToggle(entry.path);
    } else {
      onSelect(entry);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    pendingDragPath = entry.path;
    e.dataTransfer.setData(FILE_TREE_MIME, entry.path);
    e.dataTransfer.setData('text/plain', entry.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entry.isDirectory) {
      revealInFinder(entry.path);
    } else {
      openFilePath(entry.path);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await trashFile(entry.path);
      onDelete();
    } catch {
      // Silently ignored — the file may have already been moved/deleted
    }
  };

  return (
    <>
      <div className="group/row relative">
        <button
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs',
            'transition-colors hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'cursor-grab active:cursor-grabbing',
            isSelected && 'bg-accent text-accent-foreground'
          )}
          draggable
          onClick={handleClick}
          onDragStart={handleDragStart}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          title={entry.path}
          type="button"
        >
          {entry.isDirectory && <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', isExpanded && 'rotate-90')} />}
          {!entry.isDirectory && <span className="w-3" />}
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <span className="relative shrink-0">
              <Icon className={cn('h-3.5 w-3.5', entry.isDirectory ? 'text-blue-500' : 'text-muted-foreground')} />
              {entry.isSymlink && <Link className="absolute -right-0.5 -bottom-0.5 h-2 w-2 text-muted-foreground" />}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {!entry.isDirectory && entry.size != null && (
            <span className="shrink-0 text-[10px] text-muted-foreground group-hover/row:hidden">{formatFileSize(entry.size)}</span>
          )}
        </button>
        <div className="absolute top-0 right-1 flex h-full items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={handleOpen}
            title={entry.isDirectory ? 'Open in file manager' : 'Open with default app'}
            type="button"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
            title="Move to trash"
            type="button"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              depth={depth + 1}
              key={child.entry.path}
              node={child}
              onDelete={onDelete}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function FileTreePanel() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const { selectedFile, openPreview } = useFilePreviewStore();
  const [showHidden, setShowHidden] = useState(false);

  const hiddenFilter = useMemo(() => {
    if (showHidden) return undefined;
    return (entry: { name: string }) => !isHiddenEntry(entry.name);
  }, [showHidden]);

  const { nodes, isLoadingRoot, error, searchQuery, loadRoot, toggleExpand, refreshRoot, setSearchQuery } = useFileTree(hiddenFilter);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Load root when workspace changes
  useEffect(() => {
    if (activeWorkspace?.folderPath) {
      loadRoot(activeWorkspace.folderPath);
    }
  }, [activeWorkspace?.folderPath, loadRoot]);

  // Subscribe to filesystem change events
  useEffect(() => {
    const api = getTauriAPI();
    const unlisten = api.onWorkspaceFsChanged?.(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        refreshRoot();
      }, 200);
    });
    return () => {
      unlisten?.();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refreshRoot]);

  const handleSelect = useCallback(
    (entry: DirectoryEntry) => {
      openPreview(entry);
    },
    [openPreview]
  );

  if (!activeWorkspace) {
    return <div className="px-3 py-8 text-center text-muted-foreground text-sm">No workspace selected</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search + hidden files toggle */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-border bg-background py-1 pr-2 pl-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
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

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {isLoadingRoot ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-center text-destructive text-xs">{error}</div>
        ) : nodes.length === 0 ? (
          <div className="px-2 py-8 text-center text-muted-foreground text-xs">{searchQuery ? 'No files found' : 'Empty directory'}</div>
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
