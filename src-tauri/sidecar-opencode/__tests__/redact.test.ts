import { describe, expect, it } from '@jest/globals';
import { REDACTED, redactMessage, redactSecrets } from '../src/redact';

describe('redactSecrets', () => {
  it('redacts password-like properties', () => {
    expect(redactSecrets({ password: 'hunter2', name: 'ok' })).toEqual({ password: REDACTED, name: 'ok' });
  });

  it('redacts apiKey, token, authorization, and secret variants', () => {
    expect(
      redactSecrets({
        apiKey: 'k',
        api_key: 'k',
        ANTHROPIC_API_KEY: 'k',
        accessToken: 't',
        Authorization: 'Basic abc',
        clientSecret: 's',
        secretAccessKey: 's',
      })
    ).toEqual({
      apiKey: REDACTED,
      api_key: REDACTED,
      ANTHROPIC_API_KEY: REDACTED,
      accessToken: REDACTED,
      Authorization: REDACTED,
      clientSecret: REDACTED,
      secretAccessKey: REDACTED,
    });
  });

  it('redacts nested objects and arrays without mutating the input', () => {
    const input = { mcp: { servers: [{ name: 'a', headers: { 'X-Api-Key': 'k' }, environment: { MY_TOKEN: 't' } }] } };
    const result = redactSecrets(input) as typeof input;
    expect(result.mcp.servers[0].headers['X-Api-Key']).toBe(REDACTED);
    expect(result.mcp.servers[0].environment.MY_TOKEN).toBe(REDACTED);
    expect(input.mcp.servers[0].headers['X-Api-Key']).toBe('k');
  });

  it('redacts every value inside environment and headers containers regardless of key name', () => {
    const input = {
      mcp: {
        myServer: {
          command: 'npx server',
          environment: { SOME_VAR: 'value', OTHER: 'x' },
          headers: { 'X-Custom': 'abc' },
        },
      },
    };
    const result = redactSecrets(input) as typeof input;
    expect(result.mcp.myServer.environment).toEqual({ SOME_VAR: REDACTED, OTHER: REDACTED });
    expect(result.mcp.myServer.headers).toEqual({ 'X-Custom': REDACTED });
    expect(result.mcp.myServer.command).toBe('npx server');
  });

  it('redacts the entire apiKeys container including provider-name keys', () => {
    const input = {
      payload: {
        prompt: 'hello',
        apiKeys: {
          anthropic: 'sk-ant-real-key',
          openai: 'sk-real-key',
          bedrock: { accessKeyId: 'AKIA...', secretAccessKey: 's3cret', region: 'us-east-1' },
        },
        api_keys: { google: 'AIza-real' },
      },
    };
    const result = redactSecrets(input) as {
      payload: { prompt: string; apiKeys: Record<string, unknown>; api_keys: Record<string, unknown> };
    };
    expect(result.payload.prompt).toBe('hello');
    expect(result.payload.apiKeys).toEqual({ anthropic: REDACTED, openai: REDACTED, bedrock: REDACTED });
    expect(result.payload.api_keys).toEqual({ google: REDACTED });
    expect(JSON.stringify(result)).not.toContain('sk-ant-real-key');
    expect(JSON.stringify(result)).not.toContain('s3cret');
  });

  it('leaves non-secret values and primitives untouched', () => {
    expect(redactSecrets({ port: 4096, ok: true })).toEqual({ port: 4096, ok: true });
    expect(redactSecrets('plain string')).toBe('plain string');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
  });
});

describe('redactMessage', () => {
  it('redacts inline KEY=value assignments', () => {
    expect(redactMessage('OPENCODE_SERVER_PASSWORD=s3cr3t')).toBe(`OPENCODE_SERVER_PASSWORD=${REDACTED}`);
    expect(redactMessage('using api-key: abc123 for request')).toBe(`using api-key: ${REDACTED} for request`);
  });

  it('leaves messages without secret assignments untouched', () => {
    expect(redactMessage('OpenCode server bound to port 4096')).toBe('OpenCode server bound to port 4096');
    expect(redactMessage('OPENCODE_SERVER_PASSWORD set (length 32)')).toBe('OPENCODE_SERVER_PASSWORD set (length 32)');
  });
});
