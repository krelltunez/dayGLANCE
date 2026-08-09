import { describe, it, expect } from 'vitest';
import { DEFAULT_MCP_PORT, resolveMcpPort, describeBindFailure } from './mcpPort.js';

// §3.4's rule under test: exactly one port comes out of resolution, an invalid
// override surfaces as an error rather than silently landing on the default,
// and a bind failure produces a loud, actionable message — never a retry.

describe('resolveMcpPort', () => {
  it('defaults to 7893, adjacent to the Stream Deck listener on 7892', () => {
    expect(DEFAULT_MCP_PORT).toBe(7893);
    expect(resolveMcpPort(undefined)).toEqual({ ok: true, port: 7893 });
    expect(resolveMcpPort(null)).toEqual({ ok: true, port: 7893 });
    expect(resolveMcpPort('')).toEqual({ ok: true, port: 7893 });
    expect(resolveMcpPort('   ')).toEqual({ ok: true, port: 7893 });
  });

  it('accepts a valid numeric override', () => {
    expect(resolveMcpPort(8000)).toEqual({ ok: true, port: 8000 });
    expect(resolveMcpPort(1)).toEqual({ ok: true, port: 1 });
    expect(resolveMcpPort(65535)).toEqual({ ok: true, port: 65535 });
  });

  it('accepts a decimal-string override (settings and env values are strings)', () => {
    expect(resolveMcpPort('8000')).toEqual({ ok: true, port: 8000 });
    expect(resolveMcpPort(' 7894 ')).toEqual({ ok: true, port: 7894 });
  });

  it('rejects port 0 — an ephemeral port moves every launch and breaks static client configs', () => {
    const result = resolveMcpPort(0);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toContain('ephemeral'); // the message must say WHY, not just fail
    expect(resolveMcpPort('0').ok).toBe(false);
  });

  it('rejects out-of-range, fractional, and non-numeric overrides', () => {
    expect(resolveMcpPort(65536).ok).toBe(false);
    expect(resolveMcpPort(-1).ok).toBe(false);
    expect(resolveMcpPort(7893.5).ok).toBe(false);
    expect(resolveMcpPort(NaN).ok).toBe(false);
    expect(resolveMcpPort('789a').ok).toBe(false);
    expect(resolveMcpPort('-1').ok).toBe(false);
    expect(resolveMcpPort('7893.5').ok).toBe(false);
    expect(resolveMcpPort(true).ok).toBe(false);
    expect(resolveMcpPort({}).ok).toBe(false);
  });

  it('does NOT fall back to the default on an invalid override', () => {
    // A user who set a port and silently got 7893 anyway has a listener
    // running where they did not ask for it.
    const result = resolveMcpPort('not-a-port');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('port');
  });

  it('resolves to exactly one port — no alternates to scan', () => {
    const result = resolveMcpPort(8000);
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.port).toBe('number');
    // The whole resolution is {ok, port} — nothing iterable, no candidate list.
    expect(Object.keys(result).sort()).toEqual(['ok', 'port']);
  });
});

describe('describeBindFailure', () => {
  it('names the port and the collision for EADDRINUSE, and says there is no scan', () => {
    const msg = describeBindFailure(7893, { code: 'EADDRINUSE' });
    expect(msg).toContain('7893');
    expect(msg).toContain('already in use');
    expect(msg).toContain('will not scan');
  });

  it('explains EACCES with the privileged-port hint', () => {
    const msg = describeBindFailure(80, { code: 'EACCES' });
    expect(msg).toContain('80');
    expect(msg).toContain('EACCES');
  });

  it('falls back to the error code or message for anything else', () => {
    expect(describeBindFailure(7893, { code: 'EADDRNOTAVAIL' })).toContain('EADDRNOTAVAIL');
    expect(describeBindFailure(7893, { message: 'boom' })).toContain('boom');
    expect(describeBindFailure(7893, {})).toContain('unknown error');
  });
});
