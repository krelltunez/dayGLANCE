import { describe, it, expect } from 'vitest';
import {
  generateMcpToken,
  checkBearerToken,
  unauthorizedResponse,
} from './mcpAuth.js';

// The MCP listener's whole auth story is this one pre-shared token (spec §3.5).
// These tests pin both directions: a correct token is accepted in every shape
// clients legitimately send, and every other shape is refused — with the three
// refusal reasons distinguishable internally but collapsing to one identical
// 401 on the wire.

const TOKEN = 'a'.repeat(64);

describe('generateMcpToken', () => {
  it('produces 64 lowercase hex chars (32 CSPRNG bytes, the ws-server.ts idiom)', () => {
    const token = generateMcpToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never repeats across calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateMcpToken()));
    expect(seen.size).toBe(50);
  });
});

describe('checkBearerToken — accepts', () => {
  it('accepts the exact token', () => {
    expect(checkBearerToken(`Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true });
  });

  it('accepts a case-variant scheme (RFC 7235: scheme is case-insensitive)', () => {
    expect(checkBearerToken(`bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true });
    expect(checkBearerToken(`BEARER ${TOKEN}`, TOKEN)).toEqual({ ok: true });
  });
});

describe('checkBearerToken — refuses', () => {
  it('refuses a missing header as missing-header', () => {
    expect(checkBearerToken(undefined, TOKEN)).toEqual({ ok: false, reason: 'missing-header' });
  });

  it('refuses a repeated header as malformed-header', () => {
    expect(checkBearerToken([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`], TOKEN))
      .toEqual({ ok: false, reason: 'malformed-header' });
  });

  it('refuses non-Bearer schemes and shapeless values as malformed-header', () => {
    expect(checkBearerToken(`Basic ${TOKEN}`, TOKEN)).toEqual({ ok: false, reason: 'malformed-header' });
    expect(checkBearerToken(TOKEN, TOKEN)).toEqual({ ok: false, reason: 'malformed-header' });
    expect(checkBearerToken('Bearer', TOKEN)).toEqual({ ok: false, reason: 'malformed-header' });
    expect(checkBearerToken('Bearer ', TOKEN)).toEqual({ ok: false, reason: 'malformed-header' });
    expect(checkBearerToken('', TOKEN)).toEqual({ ok: false, reason: 'malformed-header' });
  });

  it('refuses a wrong token as wrong-token', () => {
    expect(checkBearerToken(`Bearer ${'b'.repeat(64)}`, TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
  });

  it('refuses a wrong token of a different length (hash-then-compare must not throw)', () => {
    expect(checkBearerToken('Bearer short', TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
    expect(checkBearerToken(`Bearer ${TOKEN}x`, TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
  });

  it('refuses a prefix or superstring of the real token', () => {
    expect(checkBearerToken(`Bearer ${TOKEN.slice(0, 63)}`, TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
    expect(checkBearerToken(`Bearer ${TOKEN} `, TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
  });

  it('fails closed on an empty configured token — even a matching empty presentation', () => {
    // 'Bearer ' with an empty candidate is malformed before the compare; the
    // point here is that NO header value can authenticate against ''.
    expect(checkBearerToken('Bearer x', '')).toEqual({ ok: false, reason: 'wrong-token' });
    expect(checkBearerToken('Bearer ', '')).toEqual({ ok: false, reason: 'malformed-header' });
  });

  it('does not treat the token comparison as a regex or trim whitespace into a match', () => {
    expect(checkBearerToken('Bearer .*', TOKEN)).toEqual({ ok: false, reason: 'wrong-token' });
  });
});

describe('unauthorizedResponse', () => {
  it('is a 401 with WWW-Authenticate and a JSON-RPC error body', () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Bearer');
    expect(JSON.parse(res.body)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unauthorized' },
      id: null,
    });
  });

  it('is identical no matter why auth failed (the function cannot even see a reason)', () => {
    // Structural guarantee: zero parameters. If someone adds a reason
    // parameter to vary the response, this test is the tripwire.
    expect(unauthorizedResponse.length).toBe(0);
    expect(unauthorizedResponse()).toEqual(unauthorizedResponse());
  });
});
