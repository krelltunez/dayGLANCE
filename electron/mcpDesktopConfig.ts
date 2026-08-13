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

import { join } from 'node:path';

/**
 * Claude Desktop's config path, or null on platforms where Claude Desktop
 * does not exist (Linux) or the anchor directory is unknowable. The setup
 * button only renders on darwin and win32, but the resolver stays honest
 * for every input.
 */
export function claudeConfigPath(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
): string | null {
  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return env['APPDATA'] ? join(env['APPDATA'], 'Claude', 'claude_desktop_config.json') : null;
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
 * The config entry: dayGLANCE's own Electron binary run as Node, executing
 * the bundled bridge. No Node install, no network, no npx; the binary is
 * already on disk and already signed. resourcesPath is process.resourcesPath
 * at runtime, so the path is whatever the installed app actually sees.
 */
export function bridgeEntry(execPath: string, resourcesPath: string): BridgeEntry {
  return {
    command: execPath,
    args: [join(resourcesPath, 'mcp-bridge', 'bridge.js')],
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
