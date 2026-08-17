// Pure logic for the "Set up Claude Desktop" button (spec §3.2, §7): where
// Claude Desktop's config lives, what entry to write, and how to merge it
// into an existing file without touching anything else. The impure half
// (read, backup, write) lives in mcpDesktopSetup.ts; BOTH modules are
// excluded from MAS packaging (§7 compile-out), so keep dayGLANCE-side
// setup knowledge in these two files only.
//
// THE MERGE CONTRACT: Claude Desktop silently rewrites its config file when
// it dislikes an entry, and users hand-maintain other servers in it. So the
// merge reads, changes exactly one key (mcpServers.dayglance), and writes
// back everything else byte-for-byte semantically: unknown top-level keys,
// other mcpServers entries, all preserved. An unparseable file is NEVER
// overwritten; the caller reports it and offers manual instructions.

import { join, posix, win32 } from 'node:path';

// Windows paths are built with win32.join and macOS paths with posix.join,
// rather than the host-dependent join. These functions take the target platform
// as an argument, so they must produce that platform's separators no matter
// which machine they run on. It also makes them testable: the previous Windows
// test could only assert the result "contains Claude", because a real path
// comparison would have failed on the Linux CI host, and that weak assertion is
// what let the MSIX path bug through two releases.

/**
 * Filesystem probes the Windows resolver needs. Injected so the resolver stays
 * pure and testable: on Windows the correct path cannot be computed from env
 * alone, it has to be discovered on disk.
 */
export interface DirProbe {
  /** Entry names in a directory; [] when it does not exist or cannot be read. */
  readDir(path: string): string[];
}

/**
 * WINDOWS IS NOT `%APPDATA%\Claude`. Claude Desktop for Windows ships as an
 * MSIX package (the claude.ai download, not only the Store one), and Windows
 * redirects a packaged app's %APPDATA% into its own container:
 *
 *   %LOCALAPPDATA%\Packages\Claude_<publisher>\LocalCache\Roaming\Claude\
 *
 * dayGLANCE is unpackaged, so its own %APPDATA% resolves to the real
 * C:\Users\<user>\AppData\Roaming and never sees that redirection. Writing
 * there produces a valid config file that Claude Desktop never reads: the
 * Developer pane shows "No servers added" while the file sits on disk looking
 * correct, which is exactly how this shipped undetected.
 *
 * The publisher suffix is not hardcoded. Any `Claude_*` package directory
 * counts, preferring one that already holds a config, so a machine with more
 * than one packaged build gets the one actually in use.
 *
 * Falls back to the unpackaged location when no package directory exists, which
 * is what a classic non-MSIX install would use.
 */
function windowsClaudeConfigPath(
  env: Record<string, string | undefined>,
  probe: DirProbe | null,
): string | null {
  const classic = env['APPDATA'] ? win32.join(env['APPDATA'], 'Claude', 'claude_desktop_config.json') : null;
  const localAppData = env['LOCALAPPDATA'];
  if (!localAppData || !probe) return classic;

  const packagesDir = win32.join(localAppData, 'Packages');
  const candidates = probe
    .readDir(packagesDir)
    .filter((name) => name.startsWith('Claude_'))
    .sort()
    .map((name) => win32.join(packagesDir, name, 'LocalCache', 'Roaming', 'Claude'));
  if (candidates.length === 0) return classic;

  const withConfig = candidates.find((dir) => probe.readDir(dir).includes('claude_desktop_config.json'));
  return win32.join(withConfig ?? candidates[0]!, 'claude_desktop_config.json');
}

/**
 * Claude Desktop's config path, or null on platforms where Claude Desktop
 * does not exist (Linux) or the anchor directory is unknowable. The setup
 * button only renders on darwin and win32, but the resolver stays honest
 * for every input.
 *
 * `probe` is only consulted on win32 (see windowsClaudeConfigPath). Passing
 * null there degrades to the unpackaged path, which is the pre-MSIX behavior.
 */
export function claudeConfigPath(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
  probe: DirProbe | null = null,
): string | null {
  switch (platform) {
    case 'darwin':
      return posix.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return windowsClaudeConfigPath(env, probe);
    default:
      return null;
  }
}

export interface BridgeEntry {
  command: string;
  args: string[];
  env: { ELECTRON_RUN_AS_NODE: '1' };
}

/**
 * Where the bundled bridge lands: resources/mcp-bridge/bridge.js, put there by
 * the extraResources entry that EVERY direct-download platform must declare
 * (electron-builder.config.cjs). Exported so the setup handler can check the
 * file is really there before writing a config that points at it — Windows
 * shipped without it once, and the button reported success anyway.
 */
export function bridgeScriptPath(resourcesPath: string): string {
  return join(resourcesPath, 'mcp-bridge', 'bridge.js');
}

/**
 * True when a resolved config path sits inside an MSIX package container. The
 * two markers together are unambiguous; neither appears in the unpackaged path.
 */
export function claudeConfigIsPackaged(configPath: string): boolean {
  const p = configPath.toLowerCase();
  return p.includes('\\packages\\') && p.includes('\\localcache\\');
}

/**
 * The config entry: dayGLANCE's own Electron binary run as Node, executing
 * the bundled bridge. No Node install, no network, no npx; the binary is
 * already on disk and already signed. resourcesPath is process.resourcesPath
 * at runtime, so the path is whatever the installed app actually sees.
 *
 * `connection` overrides discovery with an explicit port and token. Required
 * when Claude Desktop is packaged: the bridge is spawned as its child, inherits
 * the container's redirected %APPDATA%, and therefore looks for the discovery
 * file at ...\Packages\Claude_*\LocalCache\Roaming\dayGLANCE\mcp.json, which
 * dayGLANCE (unpackaged) never writes. Same redirection as the config path
 * above, one process further down.
 *
 * The cost is the token sitting in a plain config file rather than only in the
 * 0600 discovery file. Accepted because the alternative is a feature that
 * cannot work at all on packaged installs, and because the .mcpb path already
 * puts the token in Claude Desktop's own config through user_config.
 */
export function bridgeEntry(
  execPath: string,
  resourcesPath: string,
  connection?: { port: number; token: string } | null,
): BridgeEntry {
  const args = [bridgeScriptPath(resourcesPath)];
  if (connection && connection.token) {
    args.push('--port', String(connection.port), '--token', connection.token);
  }
  return {
    command: execPath,
    args,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export type MergeResult =
  | { action: 'created' | 'merged'; text: string }
  | { action: 'unparseable' };

/**
 * Merge the dayglance entry into the config file's current text.
 *  - null text (file absent) → a fresh config containing only our entry.
 *  - valid JSON object → same object with mcpServers.dayglance set; every
 *    other key and every other server entry survives untouched.
 *  - anything unparseable (or a non-object root) → 'unparseable'; the caller
 *    must not write, and shows manual instructions instead.
 */
export function mergeClaudeConfig(existingText: string | null, entry: BridgeEntry): MergeResult {
  if (existingText === null) {
    return { action: 'created', text: JSON.stringify({ mcpServers: { dayglance: entry } }, null, 2) + '\n' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText);
  } catch {
    return { action: 'unparseable' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { action: 'unparseable' };
  }
  const config = parsed as Record<string, unknown>;
  const servers = (typeof config['mcpServers'] === 'object' && config['mcpServers'] !== null && !Array.isArray(config['mcpServers']))
    ? config['mcpServers'] as Record<string, unknown>
    : {};
  const next = { ...config, mcpServers: { ...servers, dayglance: entry } };
  return { action: 'merged', text: JSON.stringify(next, null, 2) + '\n' };
}

/**
 * The manual fallback shown when the existing file cannot be parsed: the
 * exact snippet to paste, so "manual" means copy-paste, not authoring JSON.
 */
export function manualEntrySnippet(entry: BridgeEntry): string {
  return JSON.stringify({ mcpServers: { dayglance: entry } }, null, 2);
}
