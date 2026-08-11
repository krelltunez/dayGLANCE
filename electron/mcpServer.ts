// MCP loopback listener — Phase 1 skeleton (docs/mcp-server-spec.md §10).
//
// Streamable HTTP on 127.0.0.1:<port>/mcp, served by @modelcontextprotocol/*
// v2. Per spec §3.7, NOTHING app-level lives on the McpServer instance: the
// factory below builds a disposable server per request, closing over
// module-level state. The only long-lived objects are the node:http server
// and the handler wrapper.
//
// Guard order per request: endpoint path → Host header (SDK) → Origin header
// (SDK) → bearer token (ours, mcpAuth.ts). MCP-Protocol-Version enforcement is
// deliberately ABSENT here — the SDK transport handles it (Phase 0 finding;
// do not duplicate it).
//
// Phase 1 scope: one stub tool returning static data, dev flag only. No
// renderer IPC (Phase 2), no consent gate or UI (Phase 5), no discovery file.

import http from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import { checkBearerToken, unauthorizedResponse } from './mcpAuth.js';
import { resolveMcpPort, describeBindFailure } from './mcpPort.js';
import { registerReadTools, type ReadToolDeps } from './mcpReadTools.js';
import { registerWriteTools, type WriteToolDeps } from './mcpWriteTools.js';
import { registerResources } from './mcpResources.js';

export const MCP_ENDPOINT_PATH = '/mcp';

export interface McpServerOptions {
  /** The pre-shared bearer token. Empty is refused — the listener fails closed. */
  token: string;
  /** Raw user/env port override; resolution and validation are mcpPort.ts's job. */
  portOverride?: unknown;
  /**
   * Dependencies for the read tools (Phase 2): renderer bridge, clock,
   * timezone, and consent-tier sources. Owned by main.ts at module scope and
   * closed over by the per-request factory (§3.7). Optional so the listener
   * can still start in a pure-skeleton mode (tests, early dev).
   */
  readDeps?: ReadToolDeps;
  /**
   * Dependencies for the write tools (Phase 3): write gate, replay store,
   * consent tier, tray-policy hook. Same ownership rules as readDeps (§3.7).
   * Absent means the write tools are not registered at all.
   */
  writeDeps?: WriteToolDeps;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

/**
 * Start the MCP listener. Returns the http.Server (caller owns shutdown via
 * `close()`), or null when it refuses to start — bad port override or missing
 * token. Refusals are loud (spec §3.4): they log exactly why, and never
 * fall back to another port or an unauthenticated mode.
 */
export function startMcpServer(opts: McpServerOptions): http.Server | null {
  const log = opts.log ?? ((m: string) => console.log(m));
  const logError = opts.logError ?? ((m: string) => console.error(m));

  if (!opts.token) {
    logError('[dayGLANCE] MCP server not started: no bearer token configured (refusing to listen unauthenticated).');
    return null;
  }
  const resolved = resolveMcpPort(opts.portOverride);
  if (!resolved.ok) {
    logError(`[dayGLANCE] MCP server not started: ${resolved.reason}`);
    return null;
  }
  const port = resolved.port;

  // Fresh McpServer per request (spec §3.7). Tool registration is cheap; the
  // instance is discarded when the response completes. Do not hoist the
  // McpServer out of this factory — that is exactly the v1 cross-client
  // leakage shape the v2 API exists to prevent.
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'dayGLANCE', version: '0.0.1' });
      server.registerTool(
        'dayglance_ping',
        {
          description:
            'Connectivity check: returns static data confirming the dayGLANCE MCP listener is reachable. ' +
            'Does not touch user data.',
        },
        async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, server: 'dayGLANCE MCP' }),
            },
          ],
        }),
      );
      if (opts.readDeps) {
        registerReadTools(server, opts.readDeps);
        // Phase 4 resources share the read tools' deps: same bridge, same
        // clock/timezone, same consent tier (§5.4 — no second read path).
        registerResources(server, opts.readDeps);
      }
      if (opts.writeDeps) registerWriteTools(server, opts.writeDeps);
      return server;
    },
    { onerror: (err) => logError(`[dayGLANCE] MCP handler error: ${String(err)}`) },
  );

  const nodeHandler = toNodeHandler(handler, {
    onerror: (err) => logError(`[dayGLANCE] MCP adapter error: ${String(err)}`),
  });
  // DNS-rebinding defense is SDK configuration, not hand-rolled code (§3.5).
  // Note these guards write their own 403 and return false when they reject.
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const srv = http.createServer((req, res) => {
    let path: string;
    try {
      path = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    } catch {
      path = '/';
    }
    if (path !== MCP_ENDPOINT_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (!validateHost(req, res)) return;
    if (!validateOrigin(req, res)) return;

    const auth = checkBearerToken(req.headers['authorization'], opts.token);
    if (!auth.ok) {
      // One identical 401 for every rejection reason — see unauthorizedResponse().
      const rejection = unauthorizedResponse();
      res.writeHead(rejection.status, rejection.headers);
      res.end(rejection.body);
      return;
    }

    void nodeHandler(req, res);
  });

  // Same posture as ws-server.ts:30 — an unhandled 'error' on a fixed-port
  // listener turns EADDRINUSE into an app-crashing exception. But louder than
  // the WS server's log line, per §3.4: describeBindFailure names the port and
  // the no-scan rule. (Phase 5 surfaces this in settings; log-only until then.)
  srv.on('error', (err: NodeJS.ErrnoException) => {
    logError(`[dayGLANCE] ${describeBindFailure(port, err)}`);
  });

  // Loopback only, never 0.0.0.0 (spec hard constraint).
  srv.listen(port, '127.0.0.1', () => {
    log(`[dayGLANCE] MCP server listening on http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`);
  });

  return srv;
}
