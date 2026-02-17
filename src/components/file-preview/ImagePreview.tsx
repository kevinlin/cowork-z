import { useState } from 'react';

import { AlertCircle } from 'lucide-react';

import { convertFileSrc } from '@/lib/tauri-api';

interface ImagePreviewProps {
  filePath: string;
  fileName: string;
}

export function ImagePreview({ filePath, fileName }: ImagePreviewProps) {
  const [error, setError] = useState(false);
  const assetUrl = convertFileSrc(filePath);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <p className="mt-4 text-destructive text-sm">Failed to load image: {fileName}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-4">
      <img alt={fileName} className="max-h-full max-w-full rounded object-contain" onError={() => setError(true)} src={assetUrl} />
    </div>
  );
}
