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
  const linuxTargets = (config: Record<string, never>) =>
    ((config['linux'] as unknown as { target?: unknown })?.target ?? []) as {
      target: string;
      arch?: string[];
      artifactName?: string;
    }[];

  it('the appImage block sets artifactName, stopping x64 losing its suffix', () => {
    // Not on the target entry: TargetConfiguration is additionalProperties:false,
    // so an artifactName there invalidates the array. This block is the AppImage's
    // targetSpecificOptions, so it still counts as user-forced.
    const pattern = (loadConfig({ DAYGLANCE_APP_ID: undefined })['appImage'] as unknown as {
      artifactName?: string;
    })?.artifactName;
    expect(pattern, 'without it, x64 builds unlabelled').toBeDefined();
    expect(pattern).toContain('${arch}');
    expect(pattern).toContain('${version}');
    expect(pattern).toContain('${ext}');
  });

  it('the pattern is NOT set platform-wide, which would rename the deb too', () => {
    // Debian convention is name_version_arch.deb with arch as amd64. A
    // platform-level pattern would impose ${productName}-...-x64.deb on it.
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    expect((config['linux'] as unknown as { artifactName?: string }).artifactName).toBeUndefined();
  });

  it('no deb block overrides naming, so it keeps the Debian convention', () => {
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const deb = linuxTargets(config).find((t) => t.target === 'deb');
    expect(deb, 'a deb target must exist for a real install').toBeDefined();
    expect(deb?.arch).toEqual(['x64', 'arm64']);
    expect((config['deb'] as unknown as { artifactName?: string })?.artifactName).toBeUndefined();
  });

  it('maintainer is set, without which the deb target throws before building', () => {
    // FpmTarget.checkOptions requires homepage (package.json) and a maintainer
    // from linux.maintainer or a package.json author with an email. Missing
    // either fails the Linux build outright rather than degrading.
    const linux = config_maintainer(loadConfig({ DAYGLANCE_APP_ID: undefined }));
    expect(linux, 'no maintainer means the Linux job fails').toBeTruthy();
    expect(linux).toMatch(/<[^@\s]+@[^>\s]+>/);
  });

  it('package.json declares homepage, the other field fpm requires', () => {
    const pkg = JSON.parse(require('node:fs').readFileSync('package.json', 'utf-8'));
    expect(pkg.homepage, 'computePackageUrl reads metadata.homepage first').toBeTruthy();
  });
});

function config_maintainer(config: Record<string, never>): string | undefined {
  return (config['linux'] as unknown as { maintainer?: string }).maintainer;
}

// Desktop-entry metadata. electron-builder writes Name, Exec, Type, Terminal,
// Icon and StartupWMClass itself, so these assertions cover only the keys it
// cannot infer — each of which was silently absent, and each of which fails in a
// way no build error reports: no launcher category, the generic Electron icon,
// and an empty tooltip.
describe('Linux desktop-entry metadata is set, since none of it can be inferred', () => {
  const linuxOf = (config: Record<string, never>) =>
    config['linux'] as unknown as {
      category?: string;
      icon?: string;
      description?: string;
      desktop?: { entry?: Record<string, string> };
    };

  it('category is explicit, because mac.category cannot map to a Linux one', () => {
    // macToLinuxCategory covers graphics-design, developer-tools, education,
    // games, video, utilities, social-networking, finance and music. There is no
    // productivity entry, so relying on the fallback yields no Categories at all.
    const linux = linuxOf(loadConfig({ DAYGLANCE_APP_ID: undefined }));
    expect(linux.category, 'unset category means no Categories key').toBeTruthy();
    expect(linux.category).toContain('Office');
  });

  it('an icon is named, or the build ships the generic Electron one', () => {
    const linux = linuxOf(loadConfig({ DAYGLANCE_APP_ID: undefined }));
    expect(linux.icon, 'no icon source reaches getDefaultFrameworkIcon').toBeTruthy();
  });

  it('the named icon exists under buildResources and is a PNG', () => {
    // resolveIcon searches [buildResourcesDir, projectDir], and buildResources is
    // public/, so a bare filename must exist there. A missing file falls back
    // silently rather than failing the build, which is why this is asserted.
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    const icon = linuxOf(config).icon as string;
    const buildResources = (config['directories'] as unknown as { buildResources: string }).buildResources;
    const full = require('node:path').join(buildResources, icon);
    expect(require('node:fs').existsSync(full), `${full} must exist`).toBe(true);
    expect(icon.endsWith('.png'), 'Linux icon sets are generated from a PNG').toBe(true);
  });

  it('a description is set, so the .desktop Comment is not dropped', () => {
    // getDescription falls back to package.json description, which is unset.
    const linux = linuxOf(loadConfig({ DAYGLANCE_APP_ID: undefined }));
    expect(linux.description).toBeTruthy();
  });

  it('Keywords is a semicolon-terminated list, per the freedesktop spec', () => {
    const entry = linuxOf(loadConfig({ DAYGLANCE_APP_ID: undefined })).desktop?.entry ?? {};
    expect(entry['Keywords']).toBeTruthy();
    expect(entry['Keywords']?.endsWith(';'), 'list values must end with ;').toBe(true);
  });

  it('StartupWMClass is NOT overridden: electron-builder derives it correctly', () => {
    // It must match Electron's app_id. Hardcoding a guess here would break
    // window-to-launcher association rather than fix it.
    const entry = linuxOf(loadConfig({ DAYGLANCE_APP_ID: undefined })).desktop?.entry ?? {};
    expect(entry['StartupWMClass']).toBeUndefined();
  });
});
