import {
  AlertCircle,
  ExternalLink,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import * as api from '@/lib/tauri-api';
import { cn } from '@/lib/utils';
import type { DirectoryEntry } from '@/shared/types/workspace';

import { BinaryPreview } from './BinaryPreview';
import { CodePreview } from './CodePreview';
import { HtmlPreview } from './HtmlPreview';
import { MarkdownPreview } from './MarkdownPreview';
import { MediaPreview } from './MediaPreview';
import { PdfPreview } from './PdfPreview';
import { getPreviewType, type PreviewType } from './preview-utils';
import { TextPreview } from './TextPreview';

interface FilePreviewPanelProps {
  file: DirectoryEntry;
  onClose: () => void;
  onAddToChat?: (file: DirectoryEntry) => void;
}

function getIcon(previewType: PreviewType) {
  switch (previewType) {
    case 'html':
      return LayoutTemplate;
    case 'image':
      return ImageIcon;
    case 'video':
      return Video;
    case 'pdf':
      return FileText;
    case 'code':
      return FileCode;
    default:
      return File;
  }
}

export function FilePreviewPanel({ file, onClose, onAddToChat }: FilePreviewPanelProps) {
  const previewType = getPreviewType(file);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Reset to docked mode when switching files
  useEffect(() => {
    setExpanded(false);
  }, [file.path]);

  // Escape exits fullscreen
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  // Load text content for code, markdown, text, html
  useEffect(() => {
    if (previewType === 'binary' || previewType === 'image' || previewType === 'video' || previewType === 'pdf') {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadContent = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const fileContent = await api.readFileContent(file.path);
        if (!cancelled) {
          setContent(fileContent);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadContent();
    return () => {
      cancelled = true;
    };
  }, [file.path, previewType]);

  const handleAddToChat = useCallback(() => {
    if (onAddToChat) {
      onAddToChat(file);
    }
  }, [file, onAddToChat]);

  const handleOpenExternal = useCallback(async () => {
    try {
      await api.openFilePath(file.path);
    } catch (err) {
      console.error('[FilePreviewPanel] Failed to open externally:', err);
    }
  }, [file.path]);

  const renderPreview = () => {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <p className="mt-4 text-destructive text-sm">{error}</p>
          </div>
        </div>
      );
    }

    switch (previewType) {
      case 'code':
        return <CodePreview content={content} extension={file.extension} />;
      case 'markdown':
        return <MarkdownPreview content={content} />;
      case 'html': {
        const parentDir = file.path.slice(0, Math.max(0, file.path.lastIndexOf(file.name)));
        const baseHref = api.convertFileSrc(parentDir);
        return <HtmlPreview baseHref={baseHref} content={content} />;
      }
      case 'image':
        return <MediaPreview fileName={file.name} filePath={file.path} />;
      case 'video':
        return <MediaPreview fileName={file.name} filePath={file.path} isVideo />;
      case 'pdf':
        return <PdfPreview fileName={file.name} filePath={file.path} />;
      case 'text':
        return <TextPreview content={content} />;
      case 'binary':
        return <BinaryPreview fileName={file.name} fileSize={file.size} />;
      default:
        return null;
    }
  };

  const Icon = getIcon(previewType);

  const panel = (
    <div
      className={cn(
        expanded ? 'fixed inset-0 z-50 bg-background/95 shadow-2xl backdrop-blur-xl' : 'h-full',
        expanded ? '' : 'border-border border-l'
      )}
    >
      <div className={cn('flex h-full flex-col', expanded ? 'bg-background/95' : 'bg-background')}>
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Icon className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground text-sm">{file.name}</p>
              <p className="truncate text-muted-foreground text-xs">{file.path}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? 'Dock preview' : 'Expand to full screen'}
              type="button"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={handleOpenExternal}
              title="Open with default application"
              type="button"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            {onAddToChat && (
              <button
                className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                onClick={handleAddToChat}
                title="Add to chat context"
                type="button"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span>Add to Chat</span>
              </button>
            )}
            <button
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onClose}
              title="Close preview"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">{renderPreview()}</div>
      </div>
    </div>
  );

  if (expanded) {
    return createPortal(panel, document.body);
  }

  return panel;
}
