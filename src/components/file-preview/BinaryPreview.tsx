import { File } from 'lucide-react';

import { formatFileSize } from './preview-utils';

interface BinaryPreviewProps {
  fileName: string;
  fileSize?: number;
}

export function BinaryPreview({ fileName, fileSize }: BinaryPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center">
        <File className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
        <p className="mt-4 text-muted-foreground text-sm">{fileName}</p>
        <p className="mt-1 text-muted-foreground text-xs">Binary file</p>
        {fileSize !== undefined && <p className="mt-1 text-muted-foreground text-xs">{formatFileSize(fileSize)}</p>}
      </div>
    </div>
  );
}
