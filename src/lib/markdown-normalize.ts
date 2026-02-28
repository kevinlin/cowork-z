/**
 * Markdown block-level normalization.
 *
 * LLMs sometimes emit block-level markdown elements (tables, fenced code
 * blocks, headings) immediately after paragraph text — either on the same
 * line or on the next line without a blank-line separator.  remarkGfm
 * treats such elements as inline text, so they render as raw pipe
 * characters / hashes instead of rich HTML.
 *
 * This module splits inline block starts and inserts missing blank lines
 * so ReactMarkdown + remarkGfm can parse them correctly.
 */

const TABLE_SEPARATOR_RE = /^\|[\s:|-]+\|$/;
const HEADING_RE = /^#{1,6}\s/;

/**
 * Split lines where a GFM table header is glued to the end of a text
 * line (e.g. `Some text.| A | B |`).  We detect this by looking for a
 * non-pipe character followed by `|` that starts a table header, where
 * the *next* line is a table separator row (`|---|---|`).
 *
 * Only the first such occurrence per line is split — nested pipes inside
 * prose (e.g. `a || b`) are left alone because the next-line check
 * prevents false positives.
 */
function splitInlineTableHeaders(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const hasTableSepNext = TABLE_SEPARATOR_RE.test(nextLine);

    if (!hasTableSepNext) {
      result.push(line);
      continue;
    }

    // Skip lines that already start with `|` — they're proper table rows.
    const trimmed = line.trimStart();
    if (trimmed.startsWith('|')) {
      result.push(line);
      continue;
    }

    // Look for prose text followed by a table header on the same line.
    // The table portion must start with `|` and contain at least two `|`
    // characters (i.e. `| col1 | col2 |`).
    const pipeIdx = line.indexOf('|');
    if (pipeIdx > 0) {
      const textPart = line.slice(0, pipeIdx).trimEnd();
      const tablePart = line.slice(pipeIdx);
      if (textPart.length > 0) {
        result.push(textPart);
        result.push(tablePart);
        continue;
      }
    }

    result.push(line);
  }

  return result;
}

/**
 * Ensure blank lines before GFM block elements that require them.
 *
 * Handles:
 * - Tables (header row followed by `|---|` separator), including headers
 *   glued to the end of a prose line
 * - Fenced code blocks (opening ```)
 * - ATX headings (`# … ######`)
 *
 * Content inside fenced code blocks is never modified.
 */
export function normalizeMarkdownBlocks(content: string): string {
  if (!content) return content;

  // Phase 1: split inline table headers onto their own lines
  const lines = splitInlineTableHeaders(content.split('\n'));

  // Phase 2: ensure blank lines before block elements
  const result: string[] = [];
  let inFencedBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith('```')) {
      if (!inFencedBlock && result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
      }
      inFencedBlock = !inFencedBlock;
      result.push(line);
      continue;
    }

    if (inFencedBlock) {
      result.push(line);
      continue;
    }

    const isTableStart = trimmed.startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1].trim());

    const isHeading = HEADING_RE.test(trimmed);

    if ((isTableStart || isHeading) && result.length > 0 && result[result.length - 1].trim() !== '') {
      result.push('');
    }

    result.push(line);
  }

  return result.join('\n');
}
