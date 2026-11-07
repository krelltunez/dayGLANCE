// Bearer-token auth for an MCP listener (dayGLANCE MCP spec §3.5), as pure
// functions so the auth decisions can be unit-tested without binding a socket.
//
// The token gates EVERY request. Recipe: randomBytes(32).toString('hex'),
// compared in constant time, one indistinguishable 401 for every refusal.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The realm a 401 names when the caller does not give one. */
export const DEFAULT_AUTH_REALM = 'MCP';

/**
 * Generate a pre-shared MCP bearer token: 32 bytes of CSPRNG output as
 * 64 hex chars. Persistent and rotatable, owned by the host's configuration.
 *
 * @returns {string}
 */
export function generateMcpToken() {
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
 * @param {string | string[] | undefined} header the raw `Authorization`
 *   request header (node gives string | string[] | undefined; a repeated
 *   header is malformed)
 * @param {string} expectedToken the configured token. An EMPTY expected token
 *   never matches anything: a misconfigured listener must fail closed, not open.
 * @returns {{ ok: true } | { ok: false, reason: 'missing-header' | 'malformed-header' | 'wrong-token' }}
 */
export function checkBearerToken(header, expectedToken) {
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
 * The one and only 401 the listener sends. Deliberately takes no REASON:
 * missing, malformed, and wrong-token rejections must be indistinguishable to
 * the caller, and a function that cannot see the reason cannot leak it. The
 * realm is the host's fixed name, the same on every refusal.
 * `WWW-Authenticate` is required alongside 401 by RFC 7235 §4.1.
 *
 * @param {string} [realm]
 * @returns {{ status: 401, headers: Record<string, string>, body: string }}
 */
export function unauthorizedResponse(realm = DEFAULT_AUTH_REALM) {
  return {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer realm="${realm}"`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unauthorized' },
      id: null,
    }),
  };
}
