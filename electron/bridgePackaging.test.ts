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

// Architecture is a separate failure mode from packaging, and a quieter one.
// An omitted `arch` does not mean "all architectures", it means "whatever the
// build host is" — ubuntu-latest, so x64. Three releases shipped a Linux
// AppImage that could not run on a Raspberry Pi, and nothing anywhere said so:
// the config looked complete, the build succeeded, the artifact uploaded.
// Only a user on aarch64 would ever find out, via "cannot execute binary file".
describe('desktop target architectures are declared, never inherited from the host', () => {
  const targetsOf = (block: { target?: unknown } | undefined) => {
    const t = block?.target;
    return Array.isArray(t) ? (t as { target: string; arch?: string | string[] }[]) : [];
  };

  it('the Linux AppImage covers x64 AND arm64, so ARM SBCs get a real app', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const appImage = targetsOf(config['linux']).find((t) => t.target === 'AppImage');
    expect(appImage, 'linux must declare an AppImage target').toBeDefined();
    expect(appImage?.arch, 'omitting arch silently yields host-arch only').toEqual(['x64', 'arm64']);
  });

  it('every Linux and macOS target names its arch explicitly', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    for (const platform of ['linux', 'mac']) {
      for (const t of targetsOf(config[platform])) {
        expect(t.arch, `${platform}.${t.target} must declare arch, not inherit it`).toBeDefined();
      }
    }
  });

  it('mac still covers both architectures, unchanged', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    for (const t of targetsOf(config['mac'])) {
      expect(t.arch).toEqual(['x64', 'arm64']);
    }
  });
});

// Naming, which is a usability failure rather than a build failure: both
// AppImages built correctly, but the x64 one was called
// dayGLANCE-<version>.AppImage with no arch in it, so it read as "the Linux
// build" and got downloaded onto a Raspberry Pi. electron-builder strips the
// arch suffix for the default arch UNLESS artifactName is user-specified, so
// the presence of that pattern is load-bearing, not cosmetic.
describe('Linux artifact names carry their architecture', () => {
  it('linux sets artifactName, which is what stops x64 losing its suffix', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const pattern = (config['linux'] as { artifactName?: string } | undefined)?.artifactName;
    expect(pattern, 'without artifactName, x64 builds as an unlabelled name').toBeDefined();
    expect(pattern).toContain('${arch}');
  });

  it('the pattern keeps the version and the extension placeholder too', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const pattern = (config['linux'] as { artifactName?: string } | undefined)?.artifactName ?? '';
    expect(pattern).toContain('${version}');
    expect(pattern).toContain('${ext}');
  });
});
