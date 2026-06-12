import { describe, expect, it } from '@jest/globals';
import { fingerprintApiKeys } from '../src/api-key-fingerprint';

describe('fingerprintApiKeys', () => {
  it('normalizes undefined and empty objects to the same fingerprint', () => {
    expect(fingerprintApiKeys()).toBe(fingerprintApiKeys({}));
  });

  it('is insensitive to property order', () => {
    expect(fingerprintApiKeys({ anthropic: 'a', openai: 'b' })).toBe(fingerprintApiKeys({ openai: 'b', anthropic: 'a' }));
  });

  it('ignores empty-string keys', () => {
    expect(fingerprintApiKeys({ anthropic: 'a', openai: '' })).toBe(fingerprintApiKeys({ anthropic: 'a' }));
  });

  it('changes when a key is added', () => {
    expect(fingerprintApiKeys({ anthropic: 'a' })).not.toBe(fingerprintApiKeys({ anthropic: 'a', openai: 'b' }));
  });

  it('changes when a key is rotated', () => {
    expect(fingerprintApiKeys({ anthropic: 'old' })).not.toBe(fingerprintApiKeys({ anthropic: 'new' }));
  });

  it('includes bedrock credentials', () => {
    const base = { accessKeyId: 'id', secretAccessKey: 'secret', region: 'us-east-1' };
    expect(fingerprintApiKeys({ bedrock: base })).not.toBe(fingerprintApiKeys({ bedrock: { ...base, secretAccessKey: 'rotated' } }));
  });

  it('never contains raw key material', () => {
    const fingerprint = fingerprintApiKeys({
      anthropic: 'sk-ant-super-secret',
      bedrock: { accessKeyId: 'AKIA-id', secretAccessKey: 'aws-secret', region: 'us-east-1' },
    });
    expect(fingerprint).not.toContain('sk-ant-super-secret');
    expect(fingerprint).not.toContain('aws-secret');
    expect(fingerprint).not.toContain('AKIA-id');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
