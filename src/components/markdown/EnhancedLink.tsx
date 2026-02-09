/**
 * EnhancedLink — custom ReactMarkdown link and code components.
 *
 * Renders links with appropriate icons (file type or globe) and
 * intercepts click events to use Tauri APIs:
 * - File paths → revealInFinder()
 * - URLs → openExternal()
 *
 * Also provides a custom `code` component that detects file:///
 * URLs and absolute file paths inside inline backtick code and
 * renders them as clickable EnhancedLink elements instead of
 * plain `<code>` text.
 */

import { memo, useCallback } from 'react';
import type { Components } from 'react-markdown';

import { getFileCategory, getFileExtension, isAbsolutePath, isPathSafe } from '@/lib/file-utils';
import { getFileIcon, getUrlIcon } from '@/lib/icon-utils';
import * as api from '@/lib/tauri-api';

// ── Helpers ─────────────────────────────────────────────────────────

function isFileUrl(href: string): boolean {
  return href.startsWith('file://');
}

function extractFilePath(href: string): string {
  return href.replace(/^file:\/\//, '');
}

/**
 * Truncate a display string if it is very long.
 * Keeps first 40 chars + "…" + last 17 chars.
 */
function truncateDisplay(text: string, maxLength = 60): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, 40)}…${text.slice(-17)}`;
}

// ── Component ───────────────────────────────────────────────────────

interface EnhancedLinkProps {
  href?: string;
  children?: React.ReactNode;
}

const EnhancedLink = memo(function EnhancedLink({ href, children }: EnhancedLinkProps) {
  const isFile = href ? isFileUrl(href) : false;
  const filePath = isFile && href ? extractFilePath(href) : '';

  // Pick icon
  const Icon = (() => {
    if (isFile) {
      const ext = getFileExtension(filePath);
      const category = getFileCategory(ext);
      return getFileIcon(category);
    }
    return getUrlIcon();
  })();

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      if (!href) return;

      if (isFile) {
        const path = extractFilePath(href);
        if (!isPathSafe(path)) {
          console.warn('[EnhancedLink] Blocked unsafe path:', path);
          return;
        }
        try {
          await api.revealInFinder(path);
        } catch (err) {
          console.error('[EnhancedLink] Failed to reveal in Finder:', err);
        }
      } else {
        try {
          await api.openExternal(href);
        } catch (err) {
          console.error('[EnhancedLink] Failed to open URL:', err);
        }
      }
    },
    [href, isFile]
  );

  const displayText = typeof children === 'string' ? truncateDisplay(children) : children;

  return (
    <a
      className="inline-flex cursor-pointer items-center gap-1 break-all text-primary underline hover:opacity-80"
      href={href}
      onClick={handleClick}
      rel="noopener noreferrer"
      title={href}
    >
      <Icon className="inline-block h-3.5 w-3.5 shrink-0" />
      <span>{displayText}</span>
    </a>
  );
});

// ── Inline-code path detection ──────────────────────────────────────

/**
 * Detect whether an inline code string is a `file:///` URL or an
 * absolute file path (Mac / Windows).  Returns an href suitable for
 * EnhancedLink, or `null` if the text is ordinary code.
 */
function inlineCodeToHref(text: string): string | null {
  // file:/// URL
  if (text.startsWith('file:///')) return text;
  // Absolute path (Mac or Windows)
  if (isAbsolutePath(text)) return `file://${text}`;
  return null;
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Returns a `components` object for ReactMarkdown that uses
 * EnhancedLink for all `<a>` elements, and a custom `code`
 * component that renders file paths / file:/// URLs as clickable
 * links instead of plain inline code.
 */
export function createMarkdownComponents(): Partial<Components> {
  return {
    a: ({ href, children }) => <EnhancedLink href={href ?? undefined}>{children}</EnhancedLink>,
    code: ({ children, className, ...rest }) => {
      // Only intercept inline code (no className means no language tag
      // from a fenced block; react-markdown adds "language-*" classes
      // to fenced code block <code> elements).
      if (className) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      }

      const text = typeof children === 'string' ? children.trim() : '';
      if (text) {
        const href = inlineCodeToHref(text);
        if (href) {
          return <EnhancedLink href={href}>{text}</EnhancedLink>;
        }
      }

      return <code {...rest}>{children}</code>;
    },
  };
}

export { EnhancedLink };
