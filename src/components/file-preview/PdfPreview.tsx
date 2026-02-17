import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import * as api from '@/lib/tauri-api';

interface PdfPreviewProps {
  filePath: string;
  fileName: string;
}

export function PdfPreview({ filePath, fileName }: PdfPreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const base64 = await api.readBinaryFile(filePath);
        if (!cancelled) {
          setDataUrl(`data:application/pdf;base64,${base64}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to load PDF: ${fileName}`);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [filePath, fileName]);

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

  return (
    <div className="h-full w-full">
      {dataUrl && <embed className="h-full w-full" src={dataUrl} type="application/pdf" />}
    </div>
  );
}
