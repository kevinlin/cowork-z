import { describe, expect, it } from 'vitest';
import { enrichContentWithLinks, extractMediaPaths } from '../content-enrichment';

describe('enrichContentWithLinks', () => {
  it('should linkify plain text URLs', () => {
    const input = 'Check out https://example.com for details';
    const result = enrichContentWithLinks(input);
    expect(result).toBe('Check out [https://example.com](https://example.com) for details');
  });

  it('should linkify absolute file paths', () => {
    const input = 'See file /Users/name/docs/readme.txt for info';
    const result = enrichContentWithLinks(input);
    expect(result).toBe('See file [/Users/name/docs/readme.txt](file:///Users/name/docs/readme.txt) for info');
  });

  it('should preserve existing markdown links', () => {
    const input = 'Visit [my site](https://example.com) for more';
    const result = enrichContentWithLinks(input);
    expect(result).toBe(input);
  });

  it('should not linkify URLs inside inline code', () => {
    const input = 'Use `https://api.example.com/v1` as the endpoint';
    const result = enrichContentWithLinks(input);
    expect(result).toBe(input);
  });

  it('should not linkify URLs inside fenced code blocks', () => {
    const input = '```\nhttps://api.example.com/data\n```';
    const result = enrichContentWithLinks(input);
    expect(result).toBe(input);
  });

  it('should not linkify file paths inside code blocks', () => {
    const input = '```bash\ncat /etc/hosts\n```';
    const result = enrichContentWithLinks(input);
    expect(result).toBe(input);
  });

  it('should handle multiple URLs in one message', () => {
    const input = 'See https://a.com and https://b.com';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[https://a.com](https://a.com)');
    expect(result).toContain('[https://b.com](https://b.com)');
  });

  it('should handle mixed URLs and file paths', () => {
    const input = 'URL: https://example.com\nFile: /Users/name/file.txt';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[https://example.com](https://example.com)');
    expect(result).toContain('[/Users/name/file.txt](file:///Users/name/file.txt)');
  });

  it('should trim trailing punctuation from URLs', () => {
    const input = 'Visit https://example.com.';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[https://example.com](https://example.com)');
  });

  it('should return empty string for empty input', () => {
    expect(enrichContentWithLinks('')).toBe('');
  });

  it('should handle input with no URLs or paths', () => {
    const input = 'Just a regular message with no links.';
    expect(enrichContentWithLinks(input)).toBe(input);
  });

  it('should linkify file:/// URLs outside code blocks', () => {
    const input = 'Here is the file: file:///Users/name/photo.png';
    const result = enrichContentWithLinks(input);
    expect(result).toBe('Here is the file: [/Users/name/photo.png](file:///Users/name/photo.png)');
  });

  it('should not linkify file:/// URLs inside code blocks', () => {
    const input = '```\nfile:///Users/name/photo.png\n```';
    const result = enrichContentWithLinks(input);
    expect(result).toBe(input);
  });

  it('should linkify multiple file:/// URLs', () => {
    const input = 'file:///Users/name/a.png\nfile:///Users/name/b.jpg';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[/Users/name/a.png](file:///Users/name/a.png)');
    expect(result).toContain('[/Users/name/b.jpg](file:///Users/name/b.jpg)');
  });

  it('should linkify file paths with spaces when they have a file extension', () => {
    const input = 'See /Users/name/My Documents/report.pdf for info';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[/Users/name/My Documents/report.pdf](file:///Users/name/My Documents/report.pdf)');
  });

  it('should linkify file paths with special characters and a file extension', () => {
    const input = 'Open /Users/name/Downloads/Integ SFDC RIVA Activity Mapping file.xlsx now';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[/Users/name/Downloads/Integ SFDC RIVA Activity Mapping file.xlsx]');
  });

  it('should linkify Windows paths with backslashes', () => {
    const input = 'Open C:\\Users\\name\\Documents\\report.docx please';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[C:\\Users\\name\\Documents\\report.docx](file://C:\\Users\\name\\Documents\\report.docx)');
  });

  it('should linkify Windows paths with forward slashes', () => {
    const input = 'Open C:/Users/name/file.txt please';
    const result = enrichContentWithLinks(input);
    expect(result).toContain('[C:/Users/name/file.txt](file://C:/Users/name/file.txt)');
  });

  it('should not linkify backtick-wrapped file:/// URLs (handled by code component)', () => {
    const input = 'Here is `file:///Users/name/data.xlsx` for you';
    const result = enrichContentWithLinks(input);
    // Should be unchanged — backtick-wrapped content is skipped
    expect(result).toBe(input);
  });
});

describe('extractMediaPaths', () => {
  it('should extract image paths', () => {
    const content = 'Here is a screenshot: /Users/name/Desktop/screenshot.png';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/Desktop/screenshot.png']);
  });

  it('should extract video paths', () => {
    const content = 'Demo video: /Users/name/Videos/demo.mp4';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/Videos/demo.mp4']);
  });

  it('should skip non-previewable files', () => {
    const content = 'Config: /Users/name/config.json\nCode: /Users/name/app.ts';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual([]);
  });

  it('should extract bare media paths inside code blocks', () => {
    const content = '```\n/Users/name/image.png\n```';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/image.png']);
  });

  it('should extract media from file:/// URLs inside code blocks', () => {
    const content = '```\nfile:///Users/name/photo.png\nfile:///Users/name/video.mp4\n```';
    const paths = extractMediaPaths(content);
    expect(paths).toContain('/Users/name/photo.png');
    expect(paths).toContain('/Users/name/video.mp4');
  });

  it('should extract media from file:/// URLs outside code blocks', () => {
    const content = 'Here: file:///Users/name/screenshot.jpg';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/screenshot.jpg']);
  });

  it('should not extract non-media file:/// URLs', () => {
    const content = '```\nfile:///Users/name/config.json\nfile:///Users/name/app.ts\n```';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual([]);
  });

  it('should return empty array when no paths found', () => {
    const content = 'No files mentioned here.';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual([]);
  });

  it('should deduplicate repeated paths', () => {
    const content = '/Users/name/photo.jpg appears twice: /Users/name/photo.jpg';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/photo.jpg']);
  });

  it('should extract multiple different media paths', () => {
    const content = `
      Image: /Users/name/Pictures/photo1.jpg
      Video: /Users/name/Videos/demo.mp4
      Another: /Users/name/Pictures/photo2.png
    `;
    const paths = extractMediaPaths(content);
    expect(paths).toHaveLength(3);
    expect(paths).toContain('/Users/name/Pictures/photo1.jpg');
    expect(paths).toContain('/Users/name/Videos/demo.mp4');
    expect(paths).toContain('/Users/name/Pictures/photo2.png');
  });

  it('should return empty array for empty input', () => {
    expect(extractMediaPaths('')).toEqual([]);
  });

  it('should extract media from file:/// URLs with spaces in path', () => {
    const content = 'file:///Users/name/My Photos/vacation pic.jpg';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/My Photos/vacation pic.jpg']);
  });

  it('should extract media from bare paths with spaces', () => {
    const content = 'Image at /Users/name/My Photos/vacation pic.jpg here';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['/Users/name/My Photos/vacation pic.jpg']);
  });

  it('should extract bare paths inside code blocks', () => {
    const content = '```\n/Users/name/image.png\n/Users/name/photo.jpg\n```';
    const paths = extractMediaPaths(content);
    expect(paths).toContain('/Users/name/image.png');
    expect(paths).toContain('/Users/name/photo.jpg');
  });

  it('should extract media from home-relative paths', () => {
    const content = 'Screenshot at ~/Desktop/screenshot.png here';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['~/Desktop/screenshot.png']);
  });

  it('should skip non-previewable home-relative paths', () => {
    const content = 'Config at ~/config.json';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual([]);
  });

  it('should extract media from Windows paths with backslashes', () => {
    const content = 'Screenshot at C:\\Users\\name\\Desktop\\screenshot.png here';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['C:\\Users\\name\\Desktop\\screenshot.png']);
  });

  it('should extract media from Windows paths with forward slashes', () => {
    const content = 'Image: D:/Projects/assets/logo.jpg';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual(['D:/Projects/assets/logo.jpg']);
  });

  it('should skip non-previewable Windows paths', () => {
    const content = 'Config at C:\\Users\\name\\config.json';
    const paths = extractMediaPaths(content);
    expect(paths).toEqual([]);
  });
});
