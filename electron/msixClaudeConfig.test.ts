// Windows config-path resolution against a REAL MSIX layout.
//
// The layout below is copied from an actual failing install, not invented:
//
//   C:\Users\Krell\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\
//       LocalCache\Roaming\Claude\claude_desktop_config.json
//
// This is the whole reason the feature did not work on Windows. Claude Desktop
// ships as an MSIX package, Windows redirects a packaged app's %APPDATA% into
// that container, and dayGLANCE is unpackaged so its own %APPDATA% resolves to
// the real Roaming directory. The button wrote a valid config to a file Claude
// Desktop never reads, and reported success.
//
// The pre-existing test asserted claudeConfigPath('win32', {APPDATA}) contained
// 'Claude' and passed for two releases. It could only ever confirm the guess it
// was written from. These tests probe a directory tree instead.

import { describe, it, expect } from 'vitest';
import { claudeConfigPath, claudeConfigIsPackaged, bridgeEntry, bridgeScriptPath } from './mcpDesktopConfig.js';

const LOCAL = 'C:\\Users\\Krell\\AppData\\Local';
const ROAMING = 'C:\\Users\\Krell\\AppData\\Roaming';
const ENV = { LOCALAPPDATA: LOCAL, APPDATA: ROAMING };
const PKG = 'Claude_pzs8sxrjxfjjc';
const PACKAGED = `${LOCAL}\\Packages\\${PKG}\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json`;
const CLASSIC = `${ROAMING}\\Claude\\claude_desktop_config.json`;

/** A fake tree: map of directory path to entry names. Missing key = absent. */
function probeOf(tree: Record<string, string[]>) {
  return { readDir: (p: string) => tree[p] ?? [] };
}

const packagedTree = probeOf({
  [`${LOCAL}\\Packages`]: ['Microsoft.WindowsStore_8wekyb3d8bbwe', PKG, 'SomeOther_abc'],
  [`${LOCAL}\\Packages\\${PKG}\\LocalCache\\Roaming\\Claude`]: ['claude_desktop_config.json', 'config.json'],
});

describe('claudeConfigPath on Windows — MSIX redirection', () => {
  it('resolves into the package container when a Claude_* package exists', () => {
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', packagedTree)).toBe(PACKAGED);
  });

  it('ignores unrelated packages sitting alongside it', () => {
    const tree = probeOf({ [`${LOCAL}\\Packages`]: ['Microsoft.WindowsStore_8wekyb3d8bbwe', 'Spotify_zpdnekdrzrea0'] });
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', tree)).toBe(CLASSIC);
  });

  it('falls back to the unpackaged path when no package directory exists', () => {
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', probeOf({}))).toBe(CLASSIC);
  });

  it('prefers the package that already holds a config when several are present', () => {
    const other = 'Claude_aaaaaaaaaaaaa';
    // `other` sorts first, so picking it would be the bug this guards.
    const tree = probeOf({
      [`${LOCAL}\\Packages`]: [other, PKG],
      [`${LOCAL}\\Packages\\${PKG}\\LocalCache\\Roaming\\Claude`]: ['claude_desktop_config.json'],
    });
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', tree)).toBe(PACKAGED);
  });

  it('a package with no config yet is still used, so first-run setup lands inside it', () => {
    const tree = probeOf({ [`${LOCAL}\\Packages`]: [PKG] });
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', tree)).toBe(PACKAGED);
  });

  it('no probe degrades to the unpackaged path rather than returning null', () => {
    expect(claudeConfigPath('win32', ENV, 'C:\\Users\\Krell', null)).toBe(CLASSIC);
  });

  it('no LOCALAPPDATA, and no APPDATA, still resolve as before', () => {
    expect(claudeConfigPath('win32', { APPDATA: ROAMING }, 'C:\\Users\\Krell', packagedTree)).toBe(CLASSIC);
    expect(claudeConfigPath('win32', {}, 'C:\\Users\\Krell', packagedTree)).toBeNull();
  });

  it('macOS is untouched by any of this', () => {
    expect(claudeConfigPath('darwin', ENV, '/Users/casey', packagedTree))
      .toBe('/Users/casey/Library/Application Support/Claude/claude_desktop_config.json');
  });
});

describe('claudeConfigIsPackaged', () => {
  it('recognises the container path and nothing else', () => {
    expect(claudeConfigIsPackaged(PACKAGED)).toBe(true);
    expect(claudeConfigIsPackaged(CLASSIC)).toBe(false);
    expect(claudeConfigIsPackaged('/Users/casey/Library/Application Support/Claude/claude_desktop_config.json')).toBe(false);
  });

  it('is case-insensitive, since Windows paths are', () => {
    expect(claudeConfigIsPackaged(PACKAGED.toUpperCase())).toBe(true);
  });
});

describe('bridgeEntry — explicit connection for packaged installs', () => {
  const EXE = 'C:\\Program Files\\dayGLANCE\\dayGLANCE.exe';
  const RES = 'C:\\Program Files\\dayGLANCE\\resources';

  it('omits port and token by default, leaving discovery in charge', () => {
    expect(bridgeEntry(EXE, RES).args).toEqual([bridgeScriptPath(RES)]);
  });

  it('passes them explicitly when discovery cannot cross the container', () => {
    // The bridge inherits the packaged parent's redirected %APPDATA%, so it
    // would look for the discovery file inside the container, where dayGLANCE
    // never writes one. Explicit args are the only thing that reaches it.
    // bridgeScriptPath intentionally uses the host join: its input is the real
    // process.resourcesPath at runtime, so it is already on the target platform.
    // The subject here is the appended arguments, not the separator.
    expect(bridgeEntry(EXE, RES, { port: 7893, token: 'abc123' }).args)
      .toEqual([bridgeScriptPath(RES), '--port', '7893', '--token', 'abc123']);
  });

  it('an empty token is not written as an argument', () => {
    expect(bridgeEntry(EXE, RES, { port: 7893, token: '' }).args).toHaveLength(1);
  });

  it('the ELECTRON_RUN_AS_NODE env survives either shape', () => {
    expect(bridgeEntry(EXE, RES).env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(bridgeEntry(EXE, RES, { port: 1, token: 't' }).env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });
});
