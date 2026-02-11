import { describe, expect, it, vi } from 'vitest';

const mockGetVersion = vi.fn();
const mockGetPlatform = vi.fn();
const mockGetArch = vi.fn();

vi.mock('@/lib/tauri-api', () => ({
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
  getPlatform: (...args: unknown[]) => mockGetPlatform(...args),
  getArch: (...args: unknown[]) => mockGetArch(...args),
}));

import { buildBugReportUrl, buildFeatureRequestUrl, formatEnvironmentSection, getEnvironmentInfo } from '../feedback';

describe('getEnvironmentInfo', () => {
  it('returns version, platform, and arch from API calls', async () => {
    mockGetVersion.mockResolvedValue('1.2.3');
    mockGetPlatform.mockResolvedValue('macos');
    mockGetArch.mockResolvedValue('aarch64');

    const info = await getEnvironmentInfo();

    expect(info).toEqual({
      version: '1.2.3',
      platform: 'macos',
      arch: 'aarch64',
    });
  });

  it('falls back to "unknown" when API calls fail', async () => {
    mockGetVersion.mockRejectedValue(new Error('fail'));
    mockGetPlatform.mockRejectedValue(new Error('fail'));
    mockGetArch.mockRejectedValue(new Error('fail'));

    const info = await getEnvironmentInfo();

    expect(info).toEqual({
      version: 'unknown',
      platform: 'unknown',
      arch: 'unknown',
    });
  });
});

describe('formatEnvironmentSection', () => {
  it('formats environment info as markdown', () => {
    const section = formatEnvironmentSection({
      version: '1.0.0',
      platform: 'macos',
      arch: 'aarch64',
    });

    expect(section).toContain('## Environment');
    expect(section).toContain('**App Version:** 1.0.0');
    expect(section).toContain('**OS:** macos');
    expect(section).toContain('**Architecture:** aarch64');
  });
});

describe('buildBugReportUrl', () => {
  it('constructs URL with bug label and body template', async () => {
    mockGetVersion.mockResolvedValue('1.0.0');
    mockGetPlatform.mockResolvedValue('macos');
    mockGetArch.mockResolvedValue('aarch64');

    const url = await buildBugReportUrl();

    expect(url).toContain('https://github.com/kevinlin/cowork-z/issues/new');

    const parsed = new URL(url);
    expect(parsed.searchParams.get('labels')).toBe('bug');
    expect(parsed.searchParams.get('title')).toBe('[Bug]: ');

    const body = parsed.searchParams.get('body')!;
    expect(body).toContain('Steps to Reproduce');
    expect(body).toContain('Expected Behavior');
    expect(body).toContain('Actual Behavior');
    expect(body).toContain('## Environment');
    expect(body).toContain('1.0.0');
  });

  it('URL is properly encoded', async () => {
    mockGetVersion.mockResolvedValue('1.0.0');
    mockGetPlatform.mockResolvedValue('macos');
    mockGetArch.mockResolvedValue('aarch64');

    const url = await buildBugReportUrl();

    // Should be a valid URL with no raw newlines or spaces
    expect(url).not.toMatch(/\n/);
    // URLSearchParams encodes spaces as '+' which is valid
    expect(() => new URL(url)).not.toThrow();
  });
});

describe('buildFeatureRequestUrl', () => {
  it('constructs URL with enhancement label and body template', async () => {
    mockGetVersion.mockResolvedValue('2.0.0');
    mockGetPlatform.mockResolvedValue('linux');
    mockGetArch.mockResolvedValue('x86_64');

    const url = await buildFeatureRequestUrl();

    expect(url).toContain('https://github.com/kevinlin/cowork-z/issues/new');

    const parsed = new URL(url);
    expect(parsed.searchParams.get('labels')).toBe('enhancement');
    expect(parsed.searchParams.get('title')).toBe('[Feature]: ');

    const body = parsed.searchParams.get('body')!;
    expect(body).toContain('Use Case');
    expect(body).toContain('Proposed Solution');
    expect(body).toContain('## Environment');
    expect(body).toContain('2.0.0');
  });

  it('URL is properly encoded', async () => {
    mockGetVersion.mockResolvedValue('2.0.0');
    mockGetPlatform.mockResolvedValue('linux');
    mockGetArch.mockResolvedValue('x86_64');

    const url = await buildFeatureRequestUrl();

    expect(url).not.toMatch(/\n/);
    expect(() => new URL(url)).not.toThrow();
  });
});
