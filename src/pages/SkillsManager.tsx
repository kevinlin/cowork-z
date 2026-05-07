import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FilePreviewPanel } from '@/components/file-preview';
import { RepoSkillsGrid } from '@/components/skills-manager/RepoSkillsGrid';
import { RepoToolbar } from '@/components/skills-manager/RepoToolbar';
import { SkillsSidebar } from '@/components/skills-manager/SkillsSidebar';
import { SkillsStatusBar } from '@/components/skills-manager/SkillsStatusBar';
import { useTheme } from '@/hooks/useTheme';
import { PENDING_FOCUS_REPO_KEY, readAndClearPendingFocusRepo } from '@/lib/skills-window';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 400;
const DEFAULT_SIDEBAR = 250;

const PREVIEW_MIN_WIDTH = 280;
const PREVIEW_MAX_WIDTH = 700;
const PREVIEW_DEFAULT_WIDTH = 400;

export default function SkillsManagerPage() {
  const { refreshAll } = useSkillsManagerStore();
  const { selectedFile, isPreviewOpen, closePreview } = useFilePreviewStore();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_DEFAULT_WIDTH);
  const sidebarResizingRef = useRef(false);
  const previewResizingRef = useRef(false);

  useTheme();

  useEffect(() => {
    refreshAll();

    const api = getTauriAPI();
    const unlisten = api.onSkillsChanged(() => {
      refreshAll();
    });

    return () => {
      unlisten();
    };
  }, [refreshAll]);

  useEffect(() => {
    let cancelled = false;

    const processPending = async () => {
      const pending = readAndClearPendingFocusRepo();
      if (!pending) return;

      const store = useSkillsManagerStore.getState();
      // Make sure the latest repo list is loaded before checking for matches
      await store.fetchRepos();
      if (cancelled) return;

      const existing = useSkillsManagerStore.getState().repos.find((r) => r.url === pending.url);
      if (existing) {
        useSkillsManagerStore.getState().setSelectedRepoId(existing.id);
        return;
      }

      try {
        const added = await useSkillsManagerStore.getState().addRepo({
          url: pending.url,
          branch: pending.branch,
        });
        if (cancelled) return;
        useSkillsManagerStore.getState().setSelectedRepoId(added.id);
        toast.success('Repository added', { description: added.name });
      } catch (e) {
        if (cancelled) return;
        toast.error('Failed to add repository', {
          description: 'Add an access token if this is a private repo.',
        });
        useSkillsManagerStore.getState().setPrefillAddRepoUrl(pending.url);
        useSkillsManagerStore.getState().setAddRepoDialogOpen(true);
      }
    };

    processPending();

    const onStorage = (event: StorageEvent) => {
      if (event.key !== PENDING_FOCUS_REPO_KEY || !event.newValue) return;
      processPending();
    };

    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPreviewOpen) {
        closePreview();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPreviewOpen, closePreview]);

  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      sidebarResizingRef.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!sidebarResizingRef.current) return;
        const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + (ev.clientX - startX)));
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        sidebarResizingRef.current = false;
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
    [sidebarWidth]
  );

  const handlePreviewResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      previewResizingRef.current = true;
      const startX = e.clientX;
      const startWidth = previewWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!previewResizingRef.current) return;
        const delta = startX - ev.clientX;
        const newWidth = Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, startWidth + delta));
        setPreviewWidth(newWidth);
      };

      const onMouseUp = () => {
        previewResizingRef.current = false;
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
    [previewWidth]
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 overflow-hidden">
        <div className="shrink-0 border-r" style={{ width: sidebarWidth }}>
          <SkillsSidebar />
        </div>

        <div
          aria-valuenow={sidebarWidth}
          className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={handleSidebarResizeStart}
          role="separator"
          tabIndex={0}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <RepoToolbar />
          <RepoSkillsGrid />
        </div>

        {isPreviewOpen && selectedFile && (
          <>
            <div
              aria-label="Resize file preview"
              aria-valuemax={PREVIEW_MAX_WIDTH}
              aria-valuemin={PREVIEW_MIN_WIDTH}
              aria-valuenow={previewWidth}
              className="group relative w-0 shrink-0 cursor-col-resize"
              onMouseDown={handlePreviewResizeStart}
              role="separator"
              tabIndex={0}
            >
              <div className="absolute top-0 bottom-0 -left-1 z-10 w-2 transition-colors group-hover:bg-primary/20 group-active:bg-primary/30" />
            </div>
            <div className="shrink-0" style={{ width: previewWidth }}>
              <FilePreviewPanel file={selectedFile} onClose={closePreview} />
            </div>
          </>
        )}
      </div>

      <SkillsStatusBar />
    </div>
  );
}
