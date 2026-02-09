/**
 * Icon mapping utility for file categories and URL types.
 *
 * Maps file categories to Lucide React icons for use in
 * the rich link and media display components.
 */

import type { LucideIcon } from 'lucide-react';
import { ExternalLink, File, FileArchive, FileCode, FileImage, FileText, FileVideo, Globe } from 'lucide-react';

import type { FileCategory } from './file-utils';

const FILE_ICON_MAP: Record<FileCategory, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  code: FileCode,
  document: FileText,
  archive: FileArchive,
  unknown: File,
};

/** Returns the appropriate Lucide icon for a file category. */
export function getFileIcon(category: FileCategory): LucideIcon {
  return FILE_ICON_MAP[category] ?? File;
}

/** Returns the Globe icon for external URLs. */
export function getUrlIcon(): LucideIcon {
  return Globe;
}

/** Returns the ExternalLink icon. */
export function getExternalLinkIcon(): LucideIcon {
  return ExternalLink;
}
