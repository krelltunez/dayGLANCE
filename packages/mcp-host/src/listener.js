// The MCP HTTP listener (dayGLANCE MCP spec §3.4, §3.5, §3.7): Streamable HTTP
// on one fixed port and one path, served by @modelcontextprotocol/* v2.
//
// Per §3.7, NOTHING app-level lives on the McpServer instance: the host hands
// in a factory, and a disposable server is built per request, closing over the
// host's module-level state. The only long-lived objects are the node:http
// server and the handler wrapper.
//
// Guard order per request: endpoint path → Host header (SDK) → Origin header
// (SDK) → bearer token (auth.js). MCP-Protocol-Version enforcement is
// deliberately ABSENT here — the SDK transport handles it; do not duplicate it.
//
// Host and Origin default to the SDK's localhost guards, exactly. A host
// reached by name (a LAN box, or behind a reverse proxy that keeps the Host
// header) passes its own allowlists, which go through the SDK's configurable
// guards: same code, a different list. TLS is the reverse proxy's job.
//
// Refusals are loud (§3.4): every reason the listener will not start is
// logged, and it never falls back to another port, another address, or an
// unauthenticated mode. A token is required on every bind; a non-loopback bind
// without one gets its own refusal so the log says what was attempted.

import http from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';
import { createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  hostHeaderValidation,
  originValidation,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { checkBearerToken, unauthorizedResponse } from './auth.js';
import { resolvePort, describeBindFailure, hostPort } from './port.js';

export const DEFAULT_MCP_PATH = '/mcp';
export const DEFAULT_BIND_ADDRESS = '127.0.0.1';
/** The hostnames the SDK's localhost guards allow, for hosts that extend them. */
export const LOCALHOST_NAMES = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether a bind address is a loopback LITERAL: 127.0.0.0/8, ::1, or an
 * IPv4-mapped loopback. A name ('localhost') is not, since what it resolves to
 * is the resolver's choice, and neither is a wildcard ('0.0.0.0', '::').
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  if (isIPv4(address)) return address.startsWith('127.');
  if (isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped !== null && isIPv4(mapped[1]) && mapped[1].startsWith('127.');
  }
  return false;
}

/**
 * Validate a Host or Origin allowlist. Entries are hostnames as the SDK
 * compares them: no scheme, no port, IPv6 in brackets, lower case (an entry in
 * another case is folded). An Origin list may also hold `<scheme>://*` for a
 * non-http scheme (the SDK's form for app webviews). Anything else is refused,
 * because an entry that can never match fails silently at request time.
 *
 * @returns {{ ok: true, list: string[] } | { ok: false, reason: string }}
 */
export function normalizeAllowlist(kind, list, { allowSchemeWildcards = false } = {}) {
  if (!Array.isArray(list)) return { ok: false, reason: `${kind} allowlist must be an array of hostnames` };
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { ok: false, reason: `${kind} allowlist entry ${JSON.stringify(raw)} is not a hostname` };
    }
    const entry = raw.trim().toLowerCase();
    if (allowSchemeWildcards && /^[a-z][a-z0-9+.-]*:\/\/\*$/.test(entry)) {
      if (entry === 'http://*' || entry === 'https://*') {
        return { ok: false, reason: `${kind} allowlist entry ${JSON.stringify(raw)} would allow every web origin` };
      }
      out.push(entry);
      continue;
    }
    if (entry.includes('*')) {
      return { ok: false, reason: `${kind} allowlist entry ${JSON.stringify(raw)}: wildcards are not supported; list each hostname` };
    }
    let hostname;
    try {
      hostname = new URL(`http://${entry}`).hostname;
    } catch {
      hostname = null;
    }
    if (hostname !== entry) {
      return {
        ok: false,
        reason: `${kind} allowlist entry ${JSON.stringify(raw)} is not a bare hostname (no scheme, no port, no path; IPv6 in brackets, e.g. [::1])`,
      };
    }
    out.push(entry);
  }
  return { ok: true, list: out };
}

/**
 * Start an MCP listener. Returns the http.Server (caller owns shutdown via
 * `close()`, and may listen for 'listening' and 'error'), or null when it
 * refuses to start. Every refusal is logged through `logError` with the
 * reason.
 *
 * @param {object} opts see types/index.d.ts (McpListenerOptions)
 * @returns {http.Server | null}
 */
export function startMcpListener(opts) {
  const name = opts.name;
  // Programming errors, not configuration: thrown, not logged.
  if (typeof name !== 'string' || name === '') throw new TypeError('startMcpListener: `name` must be a non-empty string');
  if (typeof opts.createServer !== 'function') throw new TypeError('startMcpListener: `createServer` must be a function');
  const log = opts.log ?? ((m) => console.log(m));
  const logError = opts.logError ?? ((m) => console.error(m));
  const refuse = (reason) => {
    logError(`[${name}] MCP server not started: ${reason}`);
    return null;
  };

  const host = opts.host ?? DEFAULT_BIND_ADDRESS;
  const path = opts.path ?? DEFAULT_MCP_PATH;
  const realm = opts.realm ?? `${name} MCP`;

  if (typeof host !== 'string' || host.trim() === '') return refuse(`invalid bind address ${JSON.stringify(host)}`);

  const getToken = typeof opts.token === 'function' ? opts.token : () => opts.token;
  if (!getToken()) {
    if (!isLoopbackAddress(host)) {
      return refuse(
        `no bearer token configured for the non-loopback bind address ${JSON.stringify(host)} ` +
        '(refusing to listen unauthenticated on the network).',
      );
    }
    return refuse('no bearer token configured (refusing to listen unauthenticated).');
  }
  if (typeof path !== 'string' || !path.startsWith('/')) return refuse(`invalid endpoint path ${JSON.stringify(path)}`);
  // The realm is a quoted-string in WWW-Authenticate: printable ASCII only,
  // and no quote or backslash to escape out of it.
  if (typeof realm !== 'string' || !/^[\x20-\x7e]*$/.test(realm) || /["\\]/.test(realm)) {
    return refuse(`invalid auth realm ${JSON.stringify(realm)}`);
  }

  let validateHost = null;
  if (opts.allowedHosts !== undefined) {
    const hosts = normalizeAllowlist('Host', opts.allowedHosts);
    if (!hosts.ok) return refuse(hosts.reason);
    if (hosts.list.length === 0) return refuse('the Host allowlist is empty, so every request would be refused');
    validateHost = hostHeaderValidation(hosts.list);
  }
  let validateOrigin = null;
  if (opts.allowedOrigins !== undefined) {
    // An empty Origin list is a real policy: no browser origin at all, while
    // clients that send no Origin (every non-browser MCP client) still pass.
    const origins = normalizeAllowlist('Origin', opts.allowedOrigins, { allowSchemeWildcards: true });
    if (!origins.ok) return refuse(origins.reason);
    validateOrigin = originValidation(origins.list);
  }

  const resolved = resolvePort(opts.portOverride, opts.defaultPort);
  if (!resolved.ok) return refuse(resolved.reason);
  const port = resolved.port;

  // Fresh McpServer per request (spec §3.7). Tool registration is cheap; the
  // instance is discarded when the response completes. Do not hoist the
  // McpServer out of this factory — that is exactly the v1 cross-client
  // leakage shape the v2 API exists to prevent.
  const handler = createMcpHandler(
    opts.createServer,
    { onerror: (err) => logError(`[${name}] MCP handler error: ${String(err)}`) },
  );

  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => logError(`[${name}] MCP adapter error: ${String(err)}`),
  });
  // DNS-rebinding defense is SDK configuration, not hand-rolled code (§3.5).
  // Note these guards write their own 403 and return false when they reject.
  if (validateHost === null) validateHost = localhostHostValidation();
  if (validateOrigin === null) validateOrigin = localhostOriginValidation();

  const srv = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    } catch {
      pathname = '/';
    }
    if (pathname !== path) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (!validateHost(req, res)) return;
    if (!validateOrigin(req, res)) return;

    const auth = checkBearerToken(req.headers['authorization'], getToken());
    if (!auth.ok) {
      // One identical 401 for every rejection reason — see unauthorizedResponse().
      const rejection = unauthorizedResponse(realm);
      res.writeHead(rejection.status, rejection.headers);
      res.end(rejection.body);
      return;
    }

    void nodeHandler(req, res);
  });

  // An unhandled 'error' on a fixed-port listener turns EADDRINUSE into a
  // process-crashing exception, so it is always handled, and loudly (§3.4):
  // describeBindFailure names the port and the no-scan rule.
  srv.on('error', (err) => {
    logError(`[${name}] ${describeBindFailure(port, err, { appName: name, host })}`);
  });

  srv.listen(port, host, () => {
    log(`[${name}] MCP server listening on http://${hostPort(host, port)}${path}`);
  });

  return srv;
}
