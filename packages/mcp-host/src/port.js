// Port resolution for an MCP listener (dayGLANCE MCP spec §3.4), as pure
// functions so the decisions can be unit-tested without binding a socket.
//
// THE §3.4 RULE THIS ENCODES: client configs are static text files. A listener
// that silently moves to the next free port breaks every configured client
// with no signal anywhere. So resolution produces exactly ONE port — never a
// list, never an iterator — and a bind failure is surfaced loudly instead of
// retried elsewhere. If you are adding port-scanning here, stop: the fix for a
// collision is the user picking a port explicitly.
//
// The default port is the host's own choice (each GLANCE app has its own), so
// it is an argument, never a constant here.

/**
 * Resolve the single port the listener will attempt to bind.
 *
 * - No override (undefined, null, or empty/whitespace string) → `defaultPort`.
 * - An override must be an integer in [1, 65535], given as a number or a
 *   decimal string (settings values and env vars arrive as strings).
 * - Port 0 is rejected explicitly: the OS would assign an ephemeral port that
 *   moves on every launch, which is the exact breakage the no-scan rule exists
 *   to prevent.
 *
 * Invalid overrides return `ok: false` rather than falling back to the
 * default: a user who set a port and got the default anyway has a listener
 * running somewhere they did not ask for it. A default that is not itself a
 * valid fixed port is refused the same way, so a misconfigured host can never
 * reach `listen()` with an ephemeral or out-of-range port.
 *
 * @param {unknown} override
 * @param {number} defaultPort
 * @returns {{ ok: true, port: number } | { ok: false, reason: string }}
 */
export function resolvePort(override, defaultPort) {
  if (override === undefined || override === null) return defaultResolution(defaultPort);

  let value;
  if (typeof override === 'number') {
    value = override;
  } else if (typeof override === 'string') {
    const trimmed = override.trim();
    if (trimmed === '') return defaultResolution(defaultPort);
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

function defaultResolution(defaultPort) {
  if (typeof defaultPort !== 'number' || !Number.isInteger(defaultPort) || defaultPort < 1 || defaultPort > 65535) {
    return { ok: false, reason: `Invalid default MCP port: ${JSON.stringify(defaultPort)} (must be an integer in 1-65535)` };
  }
  return { ok: true, port: defaultPort };
}

/**
 * The loud half of "fail loudly": one message per bind failure, specific for
 * the collision case so a settings surface can show the user something
 * actionable. Never suggests, and must never gain, a retry.
 *
 * @param {number} port
 * @param {{ code?: string, message?: string }} err
 * @param {{ appName?: string, host?: string }} [opts] `appName` names who will
 *   not scan ("the server" by default); `host` is the bind address
 *   ("127.0.0.1" by default).
 * @returns {string}
 */
export function describeBindFailure(port, err, opts = {}) {
  const appName = opts.appName ?? 'the server';
  const host = opts.host ?? '127.0.0.1';
  if (err.code === 'EADDRINUSE') {
    return `MCP server could not start: port ${port} is already in use by another process. ` +
      `Pick a different port explicitly; ${appName} will not scan for a free one, because ` +
      'configured MCP clients point at a fixed port.';
  }
  if (err.code === 'EACCES') {
    return `MCP server could not start: binding ${hostPort(host, port)} was denied (${err.code}). ` +
      'Ports below 1024 may require elevated privileges; pick a higher port.';
  }
  return `MCP server could not start on ${hostPort(host, port)}: ${err.code ?? err.message ?? 'unknown error'}`;
}

/** `host:port`, with an IPv6 literal bracketed the way a URL writes it. */
export function hostPort(host, port) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}
