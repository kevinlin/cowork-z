'use client';

import { X } from 'lucide-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { FilePreviewPanel } from '@/components/file-preview';
import CollapsibleSection from '@/components/sidebar/CollapsibleSection';
import FileTreePanel from '@/components/sidebar/FileTreePanel';
import FoldersPanel from '@/components/sidebar/FoldersPanel';
import { TodoPanel } from '@/components/sidebar/TodoPanel';
import { formatPathForChat } from '@/lib/file-utils';
import { cn } from '@/lib/utils';
import type { Todo } from '@/shared';
import type { DirectoryEntry } from '@/shared/types/workspace';
import { selectActiveFile, useFilePreviewStore } from '@/stores/filePreviewStore';
import { useTaskStore } from '@/stores/taskStore';
import { clampRailWidth, RAIL_DEFAULT_WIDTH, RAIL_KEYBOARD_STEP, RAIL_MIN_WIDTH, railMaxWidth, widthOnOpen } from './rail-width';

// Stable empty array to avoid creating new references in selectors
const EMPTY_TODOS: Todo[] = [];

const TAB_CLASS = 'flex shrink-0 items-center gap-1 font-medium text-xs transition-colors';
const tabStateClass = (active: boolean) =>
  active ? 'border-primary border-b-2 text-foreground' : 'text-muted-foreground hover:text-foreground';

interface RightRailProps {
  /** Hidden with display:none, never unmounted, so tree, section and tab state survive (4.7.1 AC#6) */
  hidden: boolean;
  /** The main content wrapper (chat + rail). Its width drives clamping and widen-on-open. */
  contentRef: RefObject<HTMLDivElement | null>;
}

export default function RightRail({ hidden, contentRef }: RightRailProps) {
  const tabs = useFilePreviewStore((s) => s.tabs);
  const activePath = useFilePreviewStore((s) => s.activePath);
  const openSeq = useFilePreviewStore((s) => s.openSeq);
  const activeFile = useFilePreviewStore(selectActiveFile);
  const setActive = useFilePreviewStore((s) => s.setActive);
  const closeTab = useFilePreviewStore((s) => s.closeTab);

  // Todos section: same open logic it had in the left sidebar — starts open only
  // if todos already exist, and auto-expands when todos arrive (3.3 AC#5).
  const todos = useTaskStore((s) => s.todos.get(s.currentTask?.id ?? '') ?? EMPTY_TODOS);
  const hasTodos = todos.length > 0;
  const [todosOpen, setTodosOpen] = useState(hasTodos);
  useEffect(() => {
    if (hasTodos) {
      setTodosOpen(true);
    }
  }, [hasTodos]);

  // ── Width ─────────────────────────────────────────────────────────
  const contentWidth = useCallback(() => contentRef.current?.clientWidth ?? 0, [contentRef]);
  const [width, setWidth] = useState(RAIL_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  // Width before a preview auto-widened the rail. A manual resize clears it,
  // so closing the last tab only snaps back if the user never took over.
  const widthBeforeWiden = useRef<number | null>(null);

  // Clamp once mounted (the ref is attached by then) and whenever the main content
  // changes width. A ResizeObserver on the wrapper catches a window resize and a
  // left-sidebar drag alike, and keeps working while the rail is hidden (4.7.3 AC#4).
  useEffect(() => {
    const onResize = () => setWidth((w) => clampRailWidth(w, contentWidth()));
    onResize();
    const wrapper = contentRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(onResize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [contentRef, contentWidth]);

  // Every open (openSeq bump) widens to half the main content (4.7.5).
  const seenOpenSeq = useRef(openSeq);
  useEffect(() => {
    if (openSeq === seenOpenSeq.current) return;
    seenOpenSeq.current = openSeq;
    const next = widthOnOpen(width, contentWidth());
    if (next !== width) {
      if (widthBeforeWiden.current === null) {
        widthBeforeWiden.current = width;
      }
      setWidth(next);
    }
  }, [openSeq, width, contentWidth]);

  // No tabs left (last one closed, or a workspace switch): restore the pre-widen width.
  const tabCount = tabs.length;
  useEffect(() => {
    if (tabCount > 0 || widthBeforeWiden.current === null) return;
    setWidth(clampRailWidth(widthBeforeWiden.current, contentWidth()));
    widthBeforeWiden.current = null;
  }, [tabCount, contentWidth]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        widthBeforeWiden.current = null;
        // The handle is on the left edge: dragging left widens the rail.
        setWidth(clampRailWidth(startWidth + (startX - ev.clientX), contentWidth()));
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, contentWidth]
  );

  const handleResizeKey = (e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = RAIL_KEYBOARD_STEP;
    if (e.key === 'ArrowRight') delta = -RAIL_KEYBOARD_STEP;
    if (delta === 0) return;
    e.preventDefault();
    widthBeforeWiden.current = null;
    setWidth((w) => clampRailWidth(w + delta, contentWidth()));
  };

  // ── Tabs ──────────────────────────────────────────────────────────
  const activeTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activePath !== null) {
      activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activePath]);

  // Closing a tab removes the focused X from the DOM; hand focus to the newly
  // active tab once the store update has rendered (4.7.4 AC#8).
  const tablistRef = useRef<HTMLDivElement>(null);
  const refocusActiveTab = useRef(false);
  useEffect(() => {
    if (!refocusActiveTab.current) return;
    refocusActiveTab.current = false;
    tablistRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [activePath, tabs]);

  const handleCloseTab = (path: string) => {
    refocusActiveTab.current = true;
    closeTab(path);
  };

  const handleAddToChat = useCallback((file: DirectoryEntry) => {
    const formatted = formatPathForChat(file.path);
    if (formatted) {
      window.dispatchEvent(new CustomEvent('add-to-chat', { detail: { text: formatted } }));
    }
  }, []);

  const filesActive = activePath === null;

  return (
    <aside
      aria-label="Side panel"
      className={cn('relative h-full shrink-0 flex-col border-border border-l bg-card', hidden ? 'hidden' : 'flex')}
      id="right-rail"
      style={{ width }}
    >
      <div
        aria-label="Resize side panel"
        aria-orientation="vertical"
        aria-valuemax={railMaxWidth(contentWidth())}
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuenow={width}
        className={cn('sidebar-resize-handle rail-resize-handle', isResizing && 'active')}
        onKeyDown={handleResizeKey}
        onMouseDown={handleResizeStart}
        role="separator"
        tabIndex={0}
      />

      {/* Tab strip: pinned Files tab, then one closable tab per preview */}
      <div aria-label="Side panel tabs" className="flex shrink-0 overflow-x-auto border-border border-b" ref={tablistRef} role="tablist">
        <button
          aria-controls="right-rail-files"
          aria-selected={filesActive}
          className={cn(TAB_CLASS, 'px-3 py-2', tabStateClass(filesActive))}
          onClick={() => setActive(null)}
          role="tab"
          type="button"
        >
          Files
        </button>
        {tabs.map((tab) => {
          const isActive = tab.path === activePath;
          return (
            <div
              className={cn(TAB_CLASS, 'border-border border-l', tabStateClass(isActive))}
              key={tab.path}
              ref={isActive ? activeTabRef : undefined}
            >
              <button
                aria-controls="right-rail-preview"
                aria-selected={isActive}
                className="max-w-40 truncate py-2 pl-3"
                onClick={() => setActive(tab.path)}
                role="tab"
                title={tab.path}
                type="button"
              >
                {tab.name}
              </button>
              <button
                aria-label={`Close ${tab.name}`}
                className="mr-2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => handleCloseTab(tab.path)}
                title={`Close ${tab.name}`}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Files body stays mounted while a preview is active (4.7.2 AC#5) */}
      <div
        aria-label="Files"
        className={cn('min-h-0 flex-1 flex-col', filesActive ? 'flex' : 'hidden')}
        id="right-rail-files"
        role="tabpanel"
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          <FileTreePanel />
        </div>
        {/* Pinned sections, capped so the tree always keeps visible space (4.7.2 AC#4) */}
        <div className="max-h-[50%] shrink-0 overflow-y-auto border-border border-t">
          <FoldersPanel />
          <CollapsibleSection onOpenChange={setTodosOpen} open={todosOpen} title="Todos">
            {hasTodos ? (
              <TodoPanel todos={todos} />
            ) : (
              <div className="px-2 py-3 text-center text-muted-foreground text-xs">No active todos</div>
            )}
          </CollapsibleSection>
        </div>
      </div>

      {/* Only the active preview is mounted; switching tabs re-reads the file */}
      {activeFile && (
        <div aria-label={activeFile.name} className="min-h-0 flex-1" id="right-rail-preview" role="tabpanel">
          <FilePreviewPanel file={activeFile} key={activeFile.path} onAddToChat={handleAddToChat} />
        </div>
      )}
    </aside>
  );
}
