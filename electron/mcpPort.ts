// Port resolution for the MCP loopback listener (spec §3.4), extracted as pure
// functions so the decisions can be unit-tested without binding a socket (same
// pattern as startupQuit.ts / calendarCache.ts).
//
// THE §3.4 RULE THIS ENCODES: client configs are static text files. A listener
// that silently moves to the next free port breaks every configured client
// with no signal anywhere. So resolution produces exactly ONE port — never a
// list, never an iterator — and a bind failure is surfaced loudly instead of
// retried elsewhere. If you are adding port-scanning here, stop: the fix for a
// collision is the user picking a port explicitly in settings.

/** Adjacent to the Stream Deck listener on 7892. */
export const DEFAULT_MCP_PORT = 7893;

export type PortResolution =
  | { ok: true; port: number }
  | { ok: false; reason: string };

/**
 * Resolve the single port the listener will attempt to bind.
 *
 * - No override (undefined, null, or empty/whitespace string) → 7893.
 * - An override must be an integer in [1, 65535], given as a number or a
 *   decimal string (settings values and env vars arrive as strings).
 * - Port 0 is rejected explicitly: the OS would assign an ephemeral port that
 *   moves on every launch, which is the exact breakage the no-scan rule exists
 *   to prevent.
 *
 * Invalid overrides return `ok: false` rather than falling back to the
 * default: a user who set a port and got 7893 anyway has a listener running
 * somewhere they did not ask for it.
 */
export function resolveMcpPort(override: unknown): PortResolution {
  if (override === undefined || override === null) return { ok: true, port: DEFAULT_MCP_PORT };

  let value: number;
  if (typeof override === 'number') {
    value = override;
  } else if (typeof override === 'string') {
    const trimmed = override.trim();
    if (trimmed === '') return { ok: true, port: DEFAULT_MCP_PORT };
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, reason: `Invalid MCP port override: ${JSON.stringify(override)}` };
    }
    value = Number(trimmed);
  } else {
    return { ok: false, reason: `Invalid MCP port override of type ${typeof override}` };
  }

  if (!Number.isInteger(value)) {
    return { ok: false, reason: `Invalid MCP port override: ${value} is not an integer` };
  }
  if (value === 0) {
    return { ok: false, reason: 'MCP port 0 (ephemeral) would move on every launch; pick a fixed port' };
  }
  if (value < 1 || value > 65535) {
    return { ok: false, reason: `Invalid MCP port override: ${value} is outside 1-65535` };
  }
  return { ok: true, port: value };
}

/**
 * The loud half of "fail loudly": one message per bind failure, specific for
 * the collision case so the eventual settings surface (Phase 5) can show the
 * user something actionable. Never suggests, and must never gain, a retry.
 */
export function describeBindFailure(port: number, err: { code?: string; message?: string }): string {
  if (err.code === 'EADDRINUSE') {
    return `MCP server could not start: port ${port} is already in use by another process. ` +
      'Pick a different port explicitly — dayGLANCE will not scan for a free one, because ' +
      'configured MCP clients point at a fixed port.';
  }
  if (err.code === 'EACCES') {
    return `MCP server could not start: binding 127.0.0.1:${port} was denied (${err.code}). ` +
      'Ports below 1024 may require elevated privileges; pick a higher port.';
  }
  return `MCP server could not start on 127.0.0.1:${port}: ${err.code ?? err.message ?? 'unknown error'}`;
}
