// Bearer-token auth for the MCP loopback listener (spec §3.5), extracted as
// pure functions so the auth decisions can be unit-tested without binding a
// socket or booting Electron (same pattern as startupQuit.ts / calendarCache.ts).
//
// Relationship to the Stream Deck handshake (ws-server.ts): the MECHANISM is
// deliberately different — that server trusts every Origin-less local process
// and its token only delegates trust to a browser-context property inspector,
// while this token gates every request. What carries over is the idiom:
// randomBytes(32).toString('hex'), loopback-only, reject browser origins.
// See docs/mcp-server-spec.md §3.5 and docs/internal/mcp-phase0-findings.md item 2.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Why a rejection happened. Internal only — logs and (later) the settings
 * surface may distinguish these, but the HTTP response must not: see
 * unauthorizedResponse().
 */
export type BearerRejection = 'missing-header' | 'malformed-header' | 'wrong-token';

export type BearerCheckResult = { ok: true } | { ok: false; reason: BearerRejection };

/**
 * Generate the pre-shared MCP bearer token: 32 bytes of CSPRNG output as
 * 64 hex chars. Same recipe as the Stream Deck session token (ws-server.ts:69),
 * but this one is persistent and rotatable rather than socket-lifetime.
 */
export function generateMcpToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Check an incoming `Authorization` header against the configured token.
 *
 * Comparison is constant-time in the candidate token: both sides are hashed to
 * fixed-length digests before timingSafeEqual, so neither content nor LENGTH of
 * the wrong token shapes the timing (timingSafeEqual alone would throw on
 * length mismatch, which is itself a timing signal).
 *
 * The scheme name is case-insensitive per RFC 7235; the token itself is not.
 *
 * @param header        the raw `Authorization` request header (node gives
 *                      string | string[] | undefined; a repeated header is malformed)
 * @param expectedToken the configured token. An EMPTY expected token never
 *                      matches anything — a misconfigured listener must fail
 *                      closed, not open.
 */
export function checkBearerToken(
  header: string | string[] | undefined,
  expectedToken: string,
): BearerCheckResult {
  if (header === undefined) return { ok: false, reason: 'missing-header' };
  if (Array.isArray(header)) return { ok: false, reason: 'malformed-header' };

  const match = /^Bearer[ ]+(.+)$/i.exec(header);
  if (!match) return { ok: false, reason: 'malformed-header' };

  // No explicit empty-expectedToken branch: the regex guarantees a non-empty
  // candidate, and sha256('') never equals sha256(non-empty), so an empty
  // configured token already fails closed below. Pinned by tests.

  const presented = createHash('sha256').update(match[1]).digest();
  const expected = createHash('sha256').update(expectedToken).digest();
  if (!timingSafeEqual(presented, expected)) return { ok: false, reason: 'wrong-token' };

  return { ok: true };
}

/**
 * The one and only 401 the listener sends. Deliberately takes NO argument:
 * missing, malformed, and wrong-token rejections must be indistinguishable to
 * the caller, and a function that cannot see the reason cannot leak it.
 * `WWW-Authenticate` is required alongside 401 by RFC 7235 §4.1.
 */
export function unauthorizedResponse(): {
  status: 401;
  headers: Record<string, string>;
  body: string;
} {
  return {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="dayGLANCE MCP"',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unauthorized' },
      id: null,
    }),
  };
}
