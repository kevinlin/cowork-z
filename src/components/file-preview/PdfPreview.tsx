import { convertFileSrc } from '@/lib/tauri-api';

interface PdfPreviewProps {
  filePath: string;
  fileName: string;
}

// PDFs are served through the asset protocol (scoped to workspace/granted
// folders) rather than inlined as base64 data: URIs, so the CSP can keep
// `object-src` free of `data:` (technical review 2026-06-12 #29).
export function PdfPreview({ filePath, fileName }: PdfPreviewProps) {
  const assetUrl = convertFileSrc(filePath);

  return (
    <div className="h-full w-full">
      <embed aria-label={fileName} className="h-full w-full" src={assetUrl} type="application/pdf" />
    </div>
  );
}
