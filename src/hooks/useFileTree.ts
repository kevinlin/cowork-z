import { useCallback, useRef, useState } from 'react';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import type { DirectoryEntry } from '@/shared';

export interface FileTreeNode {
  entry: DirectoryEntry;
  children?: FileTreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
}

interface FileTreeState {
  nodes: FileTreeNode[];
  isLoadingRoot: boolean;
  error: string | null;
  searchQuery: string;
}

export function useFileTree() {
  const [state, setState] = useState<FileTreeState>({
    nodes: [],
    isLoadingRoot: false,
    error: null,
    searchQuery: '',
  });

  const rootPathRef = useRef<string | null>(null);

  const loadRoot = useCallback(async (rootPath: string) => {
    rootPathRef.current = rootPath;
    setState((s) => ({ ...s, isLoadingRoot: true, error: null }));
    try {
      const api = getTauriAPI();
      const entries = await api.readDirectory(rootPath);
      const nodes = entries.map(
        (entry): FileTreeNode => ({
          entry,
          isExpanded: false,
          isLoading: false,
        })
      );
      setState({ nodes, isLoadingRoot: false, error: null, searchQuery: '' });
    } catch (e) {
      setState((s) => ({ ...s, isLoadingRoot: false, error: String(e) }));
    }
  }, []);

  const toggleExpand = useCallback(
    async (path: string) => {
      const expandNode = async (nodes: FileTreeNode[]): Promise<FileTreeNode[]> => {
        const result: FileTreeNode[] = [];
        for (const node of nodes) {
          if (node.entry.path === path) {
            if (node.isExpanded) {
              result.push({ ...node, isExpanded: false });
            } else if (node.children) {
              result.push({ ...node, isExpanded: true });
            } else {
              // Need to load children
              result.push({ ...node, isLoading: true, isExpanded: true });
              try {
                const api = getTauriAPI();
                const entries = await api.readDirectory(path);
                const children = entries.map(
                  (entry): FileTreeNode => ({
                    entry,
                    isExpanded: false,
                    isLoading: false,
                  })
                );
                // Update with loaded children
                setState((s) => ({
                  ...s,
                  nodes: updateNodeInTree(s.nodes, path, (n) => ({
                    ...n,
                    children,
                    isLoading: false,
                    isExpanded: true,
                  })),
                }));
                return result; // Early return; state already updated
              } catch {
                setState((s) => ({
                  ...s,
                  nodes: updateNodeInTree(s.nodes, path, (n) => ({
                    ...n,
                    isLoading: false,
                    isExpanded: false,
                  })),
                }));
                return result;
              }
            }
          } else if (node.children) {
            result.push({ ...node, children: await expandNode(node.children) });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      setState((s) => {
        // Start immediate toggle for non-loading cases
        const target = findNode(s.nodes, path);
        if (target && (target.isExpanded || target.children)) {
          return {
            ...s,
            nodes: updateNodeInTree(s.nodes, path, (n) => ({
              ...n,
              isExpanded: !n.isExpanded,
            })),
          };
        }
        // Mark as loading
        return {
          ...s,
          nodes: updateNodeInTree(s.nodes, path, (n) => ({
            ...n,
            isLoading: true,
            isExpanded: true,
          })),
        };
      });

      // Load children if needed
      const target = findNode(state.nodes, path);
      if (target && !target.isExpanded && !target.children && target.entry.isDirectory) {
        try {
          const api = getTauriAPI();
          const entries = await api.readDirectory(path);
          const children = entries.map(
            (entry): FileTreeNode => ({
              entry,
              isExpanded: false,
              isLoading: false,
            })
          );
          setState((s) => ({
            ...s,
            nodes: updateNodeInTree(s.nodes, path, (n) => ({
              ...n,
              children,
              isLoading: false,
              isExpanded: true,
            })),
          }));
        } catch {
          setState((s) => ({
            ...s,
            nodes: updateNodeInTree(s.nodes, path, (n) => ({
              ...n,
              isLoading: false,
              isExpanded: false,
            })),
          }));
        }
      }
    },
    [state.nodes]
  );

  const refreshRoot = useCallback(() => {
    if (rootPathRef.current) {
      loadRoot(rootPathRef.current);
    }
  }, [loadRoot]);

  const setSearchQuery = useCallback((query: string) => {
    setState((s) => ({ ...s, searchQuery: query }));
  }, []);

  // Filter nodes based on search query
  const filteredNodes = state.searchQuery ? filterNodes(state.nodes, state.searchQuery.toLowerCase()) : state.nodes;

  return {
    nodes: filteredNodes,
    isLoadingRoot: state.isLoadingRoot,
    error: state.error,
    searchQuery: state.searchQuery,
    loadRoot,
    toggleExpand,
    refreshRoot,
    setSearchQuery,
  };
}

function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.entry.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateNodeInTree(nodes: FileTreeNode[], path: string, updater: (node: FileTreeNode) => FileTreeNode): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === path) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, path, updater) };
    }
    return node;
  });
}

function filterNodes(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    const nameMatches = node.entry.name.toLowerCase().includes(query);
    const filteredChildren = node.children ? filterNodes(node.children, query) : [];
    if (nameMatches || filteredChildren.length > 0) {
      result.push({
        ...node,
        isExpanded: filteredChildren.length > 0 ? true : node.isExpanded,
        children: node.children ? filteredChildren : undefined,
      });
    }
  }
  return result;
}
