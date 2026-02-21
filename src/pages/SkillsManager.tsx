import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePreviewPanel } from '@/components/file-preview';
import { RepoSkillsGrid } from '@/components/skills-manager/RepoSkillsGrid';
import { RepoToolbar } from '@/components/skills-manager/RepoToolbar';
import { SkillsSidebar } from '@/components/skills-manager/SkillsSidebar';
import { SkillsStatusBar } from '@/components/skills-manager/SkillsStatusBar';
import { getTauriAPI } from '@/lib/tauri-api-interface';
import { useFilePreviewStore } from '@/stores/filePreviewStore';
import { useSkillsManagerStore } from '@/stores/skillsManagerStore';

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 400;
const DEFAULT_SIDEBAR = 250;

export default function SkillsManagerPage() {
  const { refreshAll } = useSkillsManagerStore();
  const { selectedFile, isPreviewOpen, closePreview } = useFilePreviewStore();
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const resizingRef = useRef(false);

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
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPreviewOpen) {
        closePreview();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPreviewOpen, closePreview]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth + (ev.clientX - startX)));
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [sidebarWidth]
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
          onMouseDown={handleResizeStart}
          role="separator"
          tabIndex={0}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          <RepoToolbar />
          <RepoSkillsGrid />
        </div>

        {isPreviewOpen && selectedFile && (
          <>
            <div className="w-px bg-border" />
            <div className="w-[400px] shrink-0">
              <FilePreviewPanel file={selectedFile} onClose={closePreview} />
            </div>
          </>
        )}
      </div>

      <SkillsStatusBar />
    </div>
  );
}
