/**
 * Content enrichment utility.
 *
 * Detects plain text URLs and absolute file paths inside markdown
 * content (skipping code blocks) and converts them to markdown link
 * syntax so ReactMarkdown can render them as clickable links.
 */

import { analyzeFile, isAbsolutePath, isPathSafe, looksLikeFilePath } from './file-utils';

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Build a map of character ranges that live inside code blocks
 * (both fenced and inline).  We skip any match whose start
 * offset falls inside one of these ranges.
 */
function buildCodeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];

  // Fenced code blocks
  const fencedRe = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fencedRe.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  // Inline code — avoid matching inside already-found fences
  const inlineRe = /`[^`]+`/g;
  while ((m = inlineRe.exec(text)) !== null) {
    const inside = ranges.some(([s, e]) => m!.index >= s && m!.index < e);
    if (!inside) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  return ranges;
}

function isInsideCode(ranges: [number, number][], pos: number): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

/**
 * Check if a position is already inside a markdown link destination.
 * We look backwards from pos for the pattern `](` without hitting
 * a closing `)` in between.
 */
function isInsideMarkdownLink(text: string, pos: number): boolean {
  const before = text.slice(Math.max(0, pos - 200), pos);
  const bracketParen = before.lastIndexOf('](');
  if (bracketParen === -1) return false;
  const between = before.slice(bracketParen + 2);
  return !between.includes(')');
}

// ── Public API ──────────────────────────────────────────────────────

interface Match {
  start: number;
  end: number;
  original: string;
  replacement: string;
}

/**
 * Detect plain-text URLs and absolute file paths in markdown and wrap
 * them in markdown link syntax.
 *
 * - `https://example.com` becomes `[https://example.com](https://example.com)`
 * - `/Users/foo/bar.txt`  becomes `[/Users/foo/bar.txt](file:///Users/foo/bar.txt)`
 *
 * Existing markdown links, inline code, and fenced code blocks are
 * left untouched.
 */
export function enrichContentWithLinks(markdown: string): string {
  if (!markdown) return markdown;

  const codeRanges = buildCodeRanges(markdown);
  const matches: Match[] = [];

  // ── URL detection (http/https and file:// protocols) ──────────
  const urlRe = /(?:https?|file):\/\/[^\s<>)\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(markdown)) !== null) {
    const start = m.index;
    if (isInsideCode(codeRanges, start)) continue;
    if (isInsideMarkdownLink(markdown, start)) continue;
    // Skip if already wrapped as link destination [text](url)
    if (start > 0 && markdown[start - 1] === '(') continue;

    // Trim trailing punctuation that is unlikely part of URL
    const url = m[0].replace(/[.,;:!?]+$/, '');

    if (url.startsWith('file:///')) {
      // file:/// URL — extract the path portion for the display text
      const filePath = url.replace(/^file:\/\//, '');
      matches.push({
        start,
        end: start + url.length,
        original: url,
        replacement: `[${filePath}](${url})`,
      });
    } else {
      matches.push({
        start,
        end: start + url.length,
        original: url,
        replacement: `[${url}](${url})`,
      });
    }
  }

  // ── File path detection ──────────────────────────────────────────
  //
  // Order matters: broader regexes run first so they capture the
  // longest possible match.  Narrower regexes run after and skip
  // positions already covered by earlier matches.

  // 1. Paths with spaces — only match when ending with a file extension
  //    to avoid false positives in prose.  Segments may contain spaces,
  //    parens, commas, @, #, etc.  The path must end with .\w+ (extension).
  //    Mac: /dir/sub dir/file name.ext
  const spacePathRe = /(?:\/(?:[^\s/][^/\n]*[^\s/]|[^\s/]))(?:\/(?:[^\s/][^/\n]*[^\s/]|[^\s/]))*\.\w+/g;
  while ((m = spacePathRe.exec(markdown)) !== null) {
    const start = m.index;
    const candidate = m[0];

    if (isInsideCode(codeRanges, start)) continue;
    if (isInsideMarkdownLink(markdown, start)) continue;
    if (matches.some((x) => start >= x.start && start < x.end)) continue;
    if (!isAbsolutePath(candidate)) continue;
    if (!looksLikeFilePath(candidate)) continue;
    if (start > 0 && markdown[start - 1] === '(') continue;

    matches.push({
      start,
      end: start + candidate.length,
      original: candidate,
      replacement: `[${candidate}](file://${candidate})`,
    });
  }

  // 2. Simple paths (no spaces): /segment/segment/file.ext
  const pathRe = /(?:\/[\w.+-]+)+(?:\/[\w.+-]*)?/g;
  while ((m = pathRe.exec(markdown)) !== null) {
    const start = m.index;
    const candidate = m[0];

    if (isInsideCode(codeRanges, start)) continue;
    if (isInsideMarkdownLink(markdown, start)) continue;
    // Already captured by URL or space-path regex?
    if (matches.some((x) => start >= x.start && start < x.end)) continue;
    if (!isAbsolutePath(candidate)) continue;
    if (!looksLikeFilePath(candidate)) continue;
    // Skip if preceded by `(` — already a markdown link destination
    if (start > 0 && markdown[start - 1] === '(') continue;

    matches.push({
      start,
      end: start + candidate.length,
      original: candidate,
      replacement: `[${candidate}](file://${candidate})`,
    });
  }

  // 3. Windows paths: C:\dir\file.ext or D:/dir/file.ext
  const winPathRe = /[A-Za-z]:[\\/](?:[^\\/\s<>)]+[\\/])*[^\\/\s<>)]+\.\w+/g;
  while ((m = winPathRe.exec(markdown)) !== null) {
    const start = m.index;
    const candidate = m[0];

    if (isInsideCode(codeRanges, start)) continue;
    if (isInsideMarkdownLink(markdown, start)) continue;
    if (matches.some((x) => start >= x.start && start < x.end)) continue;
    if (!isAbsolutePath(candidate)) continue;
    if (start > 0 && markdown[start - 1] === '(') continue;

    matches.push({
      start,
      end: start + candidate.length,
      original: candidate,
      replacement: `[${candidate}](file://${candidate})`,
    });
  }

  // ── Apply replacements in reverse order to preserve indices ──────
  matches.sort((a, b) => b.start - a.start);

  let result = markdown;
  for (const match of matches) {
    result = result.slice(0, match.start) + match.replacement + result.slice(match.end);
  }

  return result;
}

/**
 * Extract absolute file paths that reference previewable media
 * (images / videos).  Used by the MediaGallery component to render
 * thumbnail previews below the message content.
 *
 * Unlike `enrichContentWithLinks`, this function also extracts paths
 * from inside code blocks — thumbnails are rendered separately and
 * don't modify the code block text.  This handles the common case
 * where agents list file:// URLs inside fenced code blocks.
 */
export function extractMediaPaths(content: string): string[] {
  if (!content) return [];

  const paths: string[] = [];
  const seen = new Set<string>();

  const addIfPreviewable = (candidate: string) => {
    if (!isAbsolutePath(candidate)) return;
    if (!looksLikeFilePath(candidate)) return;
    // Same safety gate as chat links — thumbnails feed convertFileSrc and
    // the preview panel's file reads (2026-06-12 review #10)
    if (!isPathSafe(candidate)) return;
    const info = analyzeFile(candidate);
    if (info.previewable && !seen.has(candidate)) {
      seen.add(candidate);
      paths.push(candidate);
    }
  };

  // 1. Extract paths from file:// URLs (anywhere, including code blocks).
  //    Captures everything after file:/// up to whitespace or common
  //    delimiters. Handles paths with spaces when backtick-wrapped
  //    (e.g., `file:///Users/name/My Photos/img.png`).
  const fileUrlRe = /file:\/\/\/([^\n<>)\]`]+)/g;
  let m: RegExpExecArray | null;
  while ((m = fileUrlRe.exec(content)) !== null) {
    // Trim trailing punctuation that is unlikely part of the path
    const rawPath = m[1].replace(/[.,;:!?]+$/, '');
    addIfPreviewable(`/${rawPath}`);
  }

  // 2. Extract bare absolute paths (everywhere, including code blocks).
  //    Thumbnails are rendered separately and don't modify code block text,
  //    so it's safe to scan inside fenced/inline code.  The addIfPreviewable
  //    helper already filters to image/video extensions, avoiding false positives.

  // 2a. Simple Unix/macOS paths (no spaces)
  const pathRe = /(?:\/[\w.+-]+)+(?:\/[\w.+-]*)?/g;
  while ((m = pathRe.exec(content)) !== null) {
    // Skip if part of a ~/... or C:/... path (handled by later regexes)
    if (m.index > 0) {
      const prev = content[m.index - 1];
      if (prev === '~' || prev === ':') continue;
    }
    addIfPreviewable(m[0]);
  }

  // 2b. Unix/macOS paths with spaces (must end with a file extension)
  const spacePathRe = /(?:\/(?:[^\s/][^/\n]*[^\s/]|[^\s/]))(?:\/(?:[^\s/][^/\n]*[^\s/]|[^\s/]))*\.\w+/g;
  while ((m = spacePathRe.exec(content)) !== null) {
    if (m.index > 0) {
      const prev = content[m.index - 1];
      if (prev === '~' || prev === ':') continue;
    }
    addIfPreviewable(m[0]);
  }

  // 2c. Home-relative paths: ~/dir/file.ext
  const homePathRe = /~\/[\w.+-][^\s<>)\]`]*/g;
  while ((m = homePathRe.exec(content)) !== null) {
    addIfPreviewable(m[0]);
  }

  // 2d. Windows paths: C:\dir\file.ext or D:/dir/file.ext
  const winPathRe = /[A-Za-z]:[\\/](?:[^\\/\s<>)]+[\\/])*[^\\/\s<>)]+\.\w+/g;
  while ((m = winPathRe.exec(content)) !== null) {
    addIfPreviewable(m[0]);
  }

  return paths;
}
