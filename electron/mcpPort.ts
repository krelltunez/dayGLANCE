// dayGLANCE's MCP port (spec §3.4). The resolution rule (exactly one port,
// never a scan, port 0 refused) and the loud bind-failure text live in
// @glance-apps/mcp-host; what is dayGLANCE's is the default port and the name
// in the message, bound here so main.ts and the settings transition keep
// one-argument functions.

import { resolvePort, describeBindFailure as describeHostBindFailure, type PortResolution } from '@glance-apps/mcp-host';

/** Adjacent to the Stream Deck listener on 7892. */
export const DEFAULT_MCP_PORT = 7893;

/** The single port the listener will attempt to bind: the override, else 7893. */
export function resolveMcpPort(override: unknown): PortResolution {
  return resolvePort(override, DEFAULT_MCP_PORT);
}

/** The settings-surface message for a bind failure on the loopback listener. */
export function describeBindFailure(port: number, err: { code?: string; message?: string }): string {
  return describeHostBindFailure(port, err, { appName: 'dayGLANCE' });
}
