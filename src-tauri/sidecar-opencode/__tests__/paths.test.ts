import os from 'node:os';
import { describe, expect, it, jest } from '@jest/globals';
import { getOpenCodeLogDir } from '../src/paths';

describe('getOpenCodeLogDir', () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  afterEach(() => {
    // Restore original values
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('should return Windows path when on Windows with LOCALAPPDATA set', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });
    process.env = { LOCALAPPDATA: 'C:\\Users\\TestUser\\AppData\\Local' };

    const result = getOpenCodeLogDir();
    // path.join uses forward slashes on Unix test runners, so just check the structure
    expect(result).toContain('AppData');
    expect(result).toContain('Local');
    expect(result).toContain('opencode');
    expect(result).toContain('log');
  });

  it('should return Windows path with fallback when LOCALAPPDATA is not set', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });
    process.env = {};

    jest.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\TestUser');

    const result = getOpenCodeLogDir();
    expect(result).toContain('AppData');
    expect(result).toContain('Local');
    expect(result).toContain('opencode');
    expect(result).toContain('log');
  });

  it('should return macOS/Linux path when on Unix platform', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });
    process.env = {};

    jest.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');

    const result = getOpenCodeLogDir();
    // path.join uses the host OS separator even for mocked Unix paths,
    // so check structural components rather than exact string
    expect(result).toContain('testuser');
    expect(result).toContain('.local');
    expect(result).toContain('share');
    expect(result).toContain('opencode');
    expect(result).toContain('log');
    expect(result).not.toContain('AppData');
  });

  it('should return Linux path when on Linux platform', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });
    process.env = {};

    jest.spyOn(os, 'homedir').mockReturnValue('/home/testuser');

    const result = getOpenCodeLogDir();
    // path.join uses the host OS separator even for mocked Unix paths,
    // so check structural components rather than exact string
    expect(result).toContain('testuser');
    expect(result).toContain('.local');
    expect(result).toContain('share');
    expect(result).toContain('opencode');
    expect(result).toContain('log');
    expect(result).not.toContain('AppData');
  });
});
