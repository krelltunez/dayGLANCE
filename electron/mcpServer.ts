// dayGLANCE's MCP server (docs/mcp-server-spec.md §10): the tools and
// resources it registers, on the listener from @glance-apps/mcp-host. The read
// tools and resources are @glance-apps/dayglance-mcp's, shared with a
// GLANCEvault-client host; the write tools are this app's (mcpWriteTools.ts).
//
// The listener (Streamable HTTP, one fixed port, the guard order path → Host →
// Origin → bearer token, loud refusals, the per-request McpServer of §3.7) is
// the host kit's, shared with every GLANCE app's MCP server. What is
// dayGLANCE's is below: the server name, the default port, the endpoint path
// client configs point at, and the registration of its tools. This listener
// stays on 127.0.0.1 with the SDK's localhost Host and Origin guards (the
// kit's defaults); nothing here configures a network bind.
//
// Per spec §3.7, NOTHING app-level lives on the McpServer instance: the
// factory below builds a disposable server per request, closing over
// module-level state.

import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { startMcpListener } from '@glance-apps/mcp-host';
import { DEFAULT_MCP_PORT } from './mcpPort.js';
import { registerReadTools, registerResources, type ReadToolDeps } from '@glance-apps/dayglance-mcp';
import { registerWriteTools, type WriteToolDeps } from './mcpWriteTools.js';

export const MCP_ENDPOINT_PATH = '/mcp';

export interface McpServerOptions {
  /**
   * The pre-shared bearer token, as a value or a getter. A getter is read on
   * EVERY request, which is what makes settings-driven rotation (§6.2)
   * invalidate the old token on the very next request without a restart.
   * Empty is refused at start — the listener fails closed.
   */
  token: string | (() => string);
  /** Raw user/env port override; resolution and validation are the host kit's job. */
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
  return startMcpListener({
    name: 'dayGLANCE',
    token: opts.token,
    portOverride: opts.portOverride,
    defaultPort: DEFAULT_MCP_PORT,
    path: MCP_ENDPOINT_PATH,
    log: opts.log,
    logError: opts.logError,
    // Fresh McpServer per request (spec §3.7). Tool registration is cheap; the
    // instance is discarded when the response completes. Do not hoist the
    // McpServer out of this factory — that is exactly the v1 cross-client
    // leakage shape the v2 API exists to prevent.
    createServer: () => {
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
  });
}
