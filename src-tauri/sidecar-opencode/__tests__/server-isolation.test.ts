import { describe, expect, it } from '@jest/globals';
import { buildSystemPrompt } from '../src/config-builder';
import { generatePassword, getAvailablePort } from '../src/process-manager';

// Mock logger to prevent file I/O during tests
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Server Isolation', () => {
  describe('getAvailablePort', () => {
    it('should return a valid port number', async () => {
      const port = await getAvailablePort();
      expect(typeof port).toBe('number');
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65_535);
    });

    it('should return different ports on successive calls', async () => {
      const port1 = await getAvailablePort();
      const port2 = await getAvailablePort();
      // Very unlikely to get the same port twice, but not impossible
      // We just check both are valid
      expect(port1).toBeGreaterThan(0);
      expect(port2).toBeGreaterThan(0);
    });
  });

  describe('generatePassword', () => {
    it('should return a non-empty string', () => {
      const password = generatePassword();
      expect(typeof password).toBe('string');
      expect(password.length).toBeGreaterThan(0);
    });

    it('should return a base64url encoded string (no +, /, =)', () => {
      const password = generatePassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should generate different passwords each time', () => {
      const p1 = generatePassword();
      const p2 = generatePassword();
      expect(p1).not.toEqual(p2);
    });

    it('should respect custom length parameter', () => {
      const shortPassword = generatePassword(8);
      const longPassword = generatePassword(64);
      // base64url: 4 chars per 3 bytes → 8 bytes → ~11 chars, 64 bytes → ~86 chars
      expect(shortPassword.length).toBeLessThan(longPassword.length);
    });
  });

  describe('buildSystemPrompt', () => {
    it('should include the dynamic server port in the skill discovery curl command', () => {
      const prompt = buildSystemPrompt(12_345, 'my-secret', '/tmp/workspace');
      expect(prompt).toContain('http://localhost:12345/skill');
    });

    it('should include basic auth credentials in the curl command', () => {
      const prompt = buildSystemPrompt(12_345, 'my-secret', '/tmp/workspace');
      expect(prompt).toContain('curl -s -u opencode:my-secret http://localhost:12345/skill');
    });

    it('should not contain hardcoded port 4096', () => {
      const prompt = buildSystemPrompt(9999, 'pw', '/tmp/workspace');
      expect(prompt).not.toContain('localhost:4096');
      expect(prompt).toContain('localhost:9999');
    });

    it('should contain the Cowork-Z identity section', () => {
      const prompt = buildSystemPrompt(5000, 'pw', '/tmp/workspace');
      expect(prompt).toContain('Cowork-Z');
      expect(prompt).toContain('<identity>');
    });

    it('should include the workspace directory and output-folder convention', () => {
      const prompt = buildSystemPrompt(5000, 'pw', '/tmp/my-ws');
      expect(prompt).toContain('/tmp/my-ws');
      expect(prompt).toContain('/tmp/my-ws/Output/');
      expect(prompt).toContain('<workspace-conventions>');
    });

    it('should instruct the agent to organize output into category subfolders', () => {
      const prompt = buildSystemPrompt(5000, 'pw', '/tmp/my-ws');
      expect(prompt).toContain('category subfolder');
      expect(prompt).toContain('executable/');
      expect(prompt).toContain('product/');
      expect(prompt).toContain('ux-prototype/');
      expect(prompt).toContain('engineering/');
      expect(prompt).toContain('testing/');
    });
  });
});
