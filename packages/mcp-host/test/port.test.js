import { describe, it, expect } from 'vitest';
import { resolvePort, describeBindFailure, hostPort } from '../src/port.js';

// The kit takes the host's default port as an argument; any fixed port will do here.
const DEFAULT = 4100;
const resolveMcpPort = (override) => resolvePort(override, DEFAULT);

// §3.4's rule under test: exactly one port comes out of resolution, an invalid
// override surfaces as an error rather than silently landing on the default,
// and a bind failure produces a loud, actionable message — never a retry.

describe('resolvePort', () => {
  it('no override resolves to the host default', () => {
    expect(resolveMcpPort(undefined)).toEqual({ ok: true, port: 4100 });
    expect(resolveMcpPort(null)).toEqual({ ok: true, port: 4100 });
    expect(resolveMcpPort('')).toEqual({ ok: true, port: 4100 });
    expect(resolveMcpPort('   ')).toEqual({ ok: true, port: 4100 });
  });

  it('accepts a valid numeric override', () => {
    expect(resolveMcpPort(8000)).toEqual({ ok: true, port: 8000 });
    expect(resolveMcpPort(1)).toEqual({ ok: true, port: 1 });
    expect(resolveMcpPort(65535)).toEqual({ ok: true, port: 65535 });
  });

  it('accepts a decimal-string override (settings and env values are strings)', () => {
    expect(resolveMcpPort('8000')).toEqual({ ok: true, port: 8000 });
    expect(resolveMcpPort(' 4101 ')).toEqual({ ok: true, port: 4101 });
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
    expect(resolveMcpPort(4100.5).ok).toBe(false);
    expect(resolveMcpPort(NaN).ok).toBe(false);
    expect(resolveMcpPort('789a').ok).toBe(false);
    expect(resolveMcpPort('-1').ok).toBe(false);
    expect(resolveMcpPort('4100.5').ok).toBe(false);
    expect(resolveMcpPort(true).ok).toBe(false);
    expect(resolveMcpPort({}).ok).toBe(false);
  });

  it('does NOT fall back to the default on an invalid override', () => {
    // A user who set a port and silently got 4100 anyway has a listener
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
    const msg = describeBindFailure(4100, { code: 'EADDRINUSE' });
    expect(msg).toContain('4100');
    expect(msg).toContain('already in use');
    expect(msg).toContain('will not scan');
  });

  it('explains EACCES with the privileged-port hint', () => {
    const msg = describeBindFailure(80, { code: 'EACCES' });
    expect(msg).toContain('80');
    expect(msg).toContain('EACCES');
  });

  it('falls back to the error code or message for anything else', () => {
    expect(describeBindFailure(4100, { code: 'EADDRNOTAVAIL' })).toContain('EADDRNOTAVAIL');
    expect(describeBindFailure(4100, { message: 'boom' })).toContain('boom');
    expect(describeBindFailure(4100, {})).toContain('unknown error');
  });
});

describe('the host default is held to the same rules as an override', () => {
  it('a default that is not a fixed port is refused, never bound', () => {
    for (const bad of [0, -1, 65536, 4100.5, NaN, '4100', undefined, null]) {
      const r = resolvePort(undefined, bad);
      expect(r.ok, String(bad)).toBe(false);
      if (r.ok) throw new Error('expected rejection');
      expect(r.reason).toContain('default MCP port');
    }
  });

  it('a valid override still wins over a bad default (the default is never consulted)', () => {
    expect(resolvePort(8000, 0)).toEqual({ ok: true, port: 8000 });
  });
});

describe('describeBindFailure — the host names itself and its address', () => {
  it('names the app that will not scan, and the bind address', () => {
    expect(describeBindFailure(4100, { code: 'EADDRINUSE' }, { appName: 'lastGLANCE' }))
      .toContain('lastGLANCE will not scan for a free one');
    expect(describeBindFailure(4100, { code: 'EADDRINUSE' })).toContain('the server will not scan');
    expect(describeBindFailure(80, { code: 'EACCES' }, { host: '0.0.0.0' })).toContain('binding 0.0.0.0:80 was denied');
    expect(describeBindFailure(4100, { code: 'EADDRNOTAVAIL' }, { host: '::1' })).toBe('MCP server could not start on [::1]:4100: EADDRNOTAVAIL');
    expect(describeBindFailure(4100, {})).toBe('MCP server could not start on 127.0.0.1:4100: unknown error');
  });

  it('hostPort brackets IPv6 literals only', () => {
    expect(hostPort('127.0.0.1', 1)).toBe('127.0.0.1:1');
    expect(hostPort('::', 1)).toBe('[::]:1');
    expect(hostPort('[::1]', 1)).toBe('[::1]:1');
    expect(hostPort('mybox.lan', 1)).toBe('mybox.lan:1');
  });
});
