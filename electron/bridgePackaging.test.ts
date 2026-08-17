// Guards the packaging of the MCP bridge, which is the one part of the "Set up
// Claude Desktop" path that no other test touches.
//
// mcpDesktopConfig.test.ts covers the pure logic thoroughly, win32 included, and
// it all passed while the Windows installer shipped no bridge at all: the entry
// was declared under `mac` only, extraResources is per-platform, and the setup
// button wrote a config pointing into a directory that was never packaged. Path
// resolution being right is not the same as the file being there.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Load the config the way electron-builder does, under a given build env. */
function loadConfig(env: Record<string, string | undefined>): Record<string, never> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve('../electron-builder.config.cjs')];
    return require('../electron-builder.config.cjs');
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const BRIDGE = 'node_modules/@glance-apps/mcp-bridge';

function resourcesOf(block: { extraResources?: { from: string; to: string }[] } | undefined) {
  return block?.extraResources ?? [];
}

describe('MCP bridge packaging — every platform with a setup button ships one', () => {
  // The renderer gates the button on ['darwin', 'win32']. Both must package the
  // bridge, and each declares its own array: mac's does NOT reach win.
  it.each(['mac', 'win'])('%s bundles the bridge into resources/mcp-bridge', (platform) => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const entry = resourcesOf(config[platform]).find((r) => r.from === BRIDGE);
    expect(entry, `${platform}.extraResources must declare the bridge`).toBeDefined();
    expect(entry?.to).toBe('mcp-bridge');
  });

  it('linux ships no bridge: no Claude Desktop, and an AppImage mount path goes stale', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    expect(resourcesOf(config['linux']).some((r) => r.from === BRIDGE)).toBe(false);
  });

  it('the MAS build drops the bridge from mac, keeping the calendar helper (§7)', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: 'com.dayglance' });
    const mac = resourcesOf(config['mac']);
    expect(mac.some((r) => r.from === BRIDGE)).toBe(false);
    expect(mac.some((r) => r.to.startsWith('calendar-helper'))).toBe(true);
  });

  it('mas declares no extraResources of its own: deepAssign would concatenate, not replace', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: 'com.dayglance' });
    expect(config['mas']?.['extraResources']).toBeUndefined();
  });

  it('no bridge entry is hoisted to the top level, where the mac merge gets subtle', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    expect(resourcesOf(config as never).some((r) => r.from === BRIDGE)).toBe(false);
  });
});
