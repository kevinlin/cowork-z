import { describe, expect, it } from 'vitest';
import { normalizeMarkdownBlocks } from '../markdown-normalize';

describe('normalizeMarkdownBlocks', () => {
  it('should return empty string as-is', () => {
    expect(normalizeMarkdownBlocks('')).toBe('');
  });

  it('should return plain text unchanged', () => {
    const text = 'Hello world\nThis is a paragraph.';
    expect(normalizeMarkdownBlocks(text)).toBe(text);
  });

  // ── Tables ──────────────────────────────────────────────────────

  it('should insert blank line before table that follows text on previous line', () => {
    const input = 'Here is a table:\n| A | B |\n|---|---|\n| 1 | 2 |';
    const expected = 'Here is a table:\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should split and separate table header glued to end of text on same line', () => {
    const input = 'Some text.| Skill | Description |\n|-------|-------------|\n| a | b |';
    const expected = 'Some text.\n\n| Skill | Description |\n|-------|-------------|\n| a | b |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should not insert blank line if table is already preceded by blank line', () => {
    const input = 'Here is a table:\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should not insert blank line if table is at the start of content', () => {
    const input = '| A | B |\n|---|---|\n| 1 | 2 |';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should not treat lone pipe lines as tables (no separator row)', () => {
    const input = 'Some text\n| this is not a table\nMore text';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should handle table with alignment markers in separator', () => {
    const input = 'Text before\n| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |';
    const expected = 'Text before\n\n| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should split inline table with space before pipe', () => {
    const input = 'Here is the table | A | B |\n|---|---|\n| 1 | 2 |';
    const expected = 'Here is the table\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should not split line with pipes when next line is not a table separator', () => {
    const input = 'Use a || b for logical OR\nMore text';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  // ── Headings ────────────────────────────────────────────────────

  it('should insert blank line before heading that follows text', () => {
    const input = 'Some paragraph text.\n## Section Title\nMore text.';
    const expected = 'Some paragraph text.\n\n## Section Title\nMore text.';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should not insert blank line if heading is already preceded by blank line', () => {
    const input = 'Some text.\n\n## Section Title';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should not insert blank line if heading is at the start of content', () => {
    const input = '# Title\nSome text.';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should handle all heading levels (h1-h6)', () => {
    for (let level = 1; level <= 6; level++) {
      const hashes = '#'.repeat(level);
      const input = `Text\n${hashes} Heading`;
      const expected = `Text\n\n${hashes} Heading`;
      expect(normalizeMarkdownBlocks(input)).toBe(expected);
    }
  });

  it('should not treat hash without space as heading', () => {
    const input = 'Text\n#notaheading';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  // ── Fenced code blocks ─────────────────────────────────────────

  it('should insert blank line before fenced code block that follows text', () => {
    const input = 'Some text.\n```js\nconsole.log("hi");\n```';
    const expected = 'Some text.\n\n```js\nconsole.log("hi");\n```';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should not insert blank line if code block is already preceded by blank line', () => {
    const input = 'Some text.\n\n```js\nconsole.log("hi");\n```';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should not modify content inside fenced code blocks', () => {
    const input = 'Text\n\n```\n| A | B |\n|---|---|\n# Not a heading\n```';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  it('should not insert blank line before closing fence', () => {
    const input = 'Text\n\n```\ncode\n```\nAfter code.';
    expect(normalizeMarkdownBlocks(input)).toBe(input);
  });

  // ── Mixed / edge cases ─────────────────────────────────────────

  it('should handle multiple block elements in sequence', () => {
    const input = 'Intro text.\n## Section\nParagraph.\n| A | B |\n|---|---|\n| 1 | 2 |';
    const expected = 'Intro text.\n\n## Section\nParagraph.\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should handle real-world LLM response with table on next line after prose', () => {
    const input =
      'The user wants me to list my available skills in a markdown table. Let me compile them into a nice markdown table format.\n' +
      '| Skill | Description |\n' +
      '|-------|-------------|\n' +
      '| experience-prototype | Guide users through complete experience prototyping workflow |\n' +
      '| research-plan-implement | Complete FIC workflow from research to implementation |';
    const expected =
      'The user wants me to list my available skills in a markdown table. Let me compile them into a nice markdown table format.\n' +
      '\n' +
      '| Skill | Description |\n' +
      '|-------|-------------|\n' +
      '| experience-prototype | Guide users through complete experience prototyping workflow |\n' +
      '| research-plan-implement | Complete FIC workflow from research to implementation |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });

  it('should handle real-world LLM response with table glued to end of prose on same line', () => {
    const input =
      'Let me create a comprehensive markdown table.| Tool | Description |\n' +
      '|------|-------------|\n' +
      '| `bash` | Execute bash commands in persistent shell session |\n' +
      '| `read` | Read files or directories from filesystem |';
    const expected =
      'Let me create a comprehensive markdown table.\n' +
      '\n' +
      '| Tool | Description |\n' +
      '|------|-------------|\n' +
      '| `bash` | Execute bash commands in persistent shell session |\n' +
      '| `read` | Read files or directories from filesystem |';
    expect(normalizeMarkdownBlocks(input)).toBe(expected);
  });
});
