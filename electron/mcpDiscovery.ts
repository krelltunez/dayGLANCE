// The §3.4 discovery file: {port, token} written where the bridge looks, so
// direct-download users never configure anything by hand. Pure decisions
// here (startupQuit.ts style); main.ts owns the fs calls and the lifecycle
// (write on bind, rewrite on token rotation, remove on unbind).
//
// MAS builds write NO discovery file (spec §3.4 revision 6, from the Phase
// 0.5 hardware findings): the only place a sandboxed build could write is
// its own container, and a bridge read into that container fires a TCC
// prompt attributed to "node" that names neither product. On MAS the token
// is manual, so the path resolver returns null there and the writer becomes
// a structural no-op.

import { join } from 'node:path';

/**
 * Where the discovery file lives for this platform, or null when none must
 * be written (MAS, or an unknown platform). Mirrors the §3.4 table exactly;
 * the bridge's own resolver (glance-apps/mcp-bridge src/paths.js) reads the
 * same locations.
 */
export function discoveryFilePath(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
  isMas: boolean,
): string | null {
  if (isMas) return null;
  switch (platform) {
    case 'win32':
      return env['APPDATA'] ? join(env['APPDATA'], 'dayGLANCE', 'mcp.json') : null;
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'dayGLANCE', 'mcp.json');
    case 'linux': {
      const base = env['XDG_CONFIG_HOME'] || join(home, '.config');
      return join(base, 'dayglance', 'mcp.json');
    }
    default:
      return null;
  }
}

/**
 * The file body. Deliberately minimal: the bridge needs the port and the
 * bearer token, nothing else, and every extra field is a compatibility
 * surface. Written with mode 0600 (it contains the token).
 */
export function discoveryPayload(port: number, token: string): string {
  return JSON.stringify({ port, token }, null, 2) + '\n';
}
