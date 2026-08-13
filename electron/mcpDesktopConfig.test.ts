import { describe, it, expect } from 'vitest';
import { claudeConfigPath, bridgeEntry, mergeClaudeConfig, manualEntrySnippet } from './mcpDesktopConfig.js';
import { discoveryFilePath, discoveryPayload } from './mcpDiscovery.js';

// Phase 6 pure logic: where Claude Desktop's config lives, the
// ELECTRON_RUN_AS_NODE entry, the preserve-everything merge, and the §3.4
// discovery file. Load-bearing: the merge must never lose a user's other
// servers or unknown keys, and an unparseable file must never be writable.

const HOME = '/Users/casey';
const ENTRY = bridgeEntry('/Applications/dayGLANCE.app/Contents/MacOS/dayGLANCE', '/Applications/dayGLANCE.app/Contents/Resources');

describe('claudeConfigPath', () => {
  it('darwin and win32 resolve; Linux (no Claude Desktop) and unknown APPDATA do not', () => {
    expect(claudeConfigPath('darwin', {}, HOME))
      .toBe('/Users/casey/Library/Application Support/Claude/claude_desktop_config.json');
    expect(claudeConfigPath('win32', { APPDATA: 'C:\\Users\\casey\\AppData\\Roaming' }, 'C:\\Users\\casey'))
      .toContain('Claude');
    expect(claudeConfigPath('win32', {}, 'C:\\Users\\casey')).toBeNull();
    expect(claudeConfigPath('linux', {}, '/home/casey')).toBeNull();
  });
});

describe('bridgeEntry — the ELECTRON_RUN_AS_NODE shape', () => {
  it('runs the app binary as node against the bundled bridge', () => {
    expect(ENTRY).toEqual({
      command: '/Applications/dayGLANCE.app/Contents/MacOS/dayGLANCE',
      args: ['/Applications/dayGLANCE.app/Contents/Resources/mcp-bridge/bridge.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});

describe('mergeClaudeConfig — change one key, preserve everything else', () => {
  it('absent file → fresh config with only our entry', () => {
    const r = mergeClaudeConfig(null, ENTRY);
    expect(r.action).toBe('created');
    if (r.action !== 'created') return;
    expect(JSON.parse(r.text)).toEqual({ mcpServers: { dayglance: ENTRY } });
  });

  it('existing servers and unknown top-level keys survive intact', () => {
    const existing = JSON.stringify({
      mcpServers: {
        'other-server': { command: 'npx', args: ['-y', 'some-package'] },
      },
      globalShortcut: 'Ctrl+Space',
      somethingClaudeAddsLater: { nested: true },
    });
    const r = mergeClaudeConfig(existing, ENTRY);
    expect(r.action).toBe('merged');
    if (r.action !== 'merged') return;
    const parsed = JSON.parse(r.text);
    expect(parsed.mcpServers['other-server']).toEqual({ command: 'npx', args: ['-y', 'some-package'] });
    expect(parsed.mcpServers.dayglance).toEqual(ENTRY);
    expect(parsed.globalShortcut).toBe('Ctrl+Space');
    expect(parsed.somethingClaudeAddsLater).toEqual({ nested: true });
  });

  it('an existing dayglance entry is replaced, not duplicated', () => {
    const existing = JSON.stringify({ mcpServers: { dayglance: { command: 'stale' } } });
    const r = mergeClaudeConfig(existing, ENTRY);
    if (r.action !== 'merged') throw new Error('expected merged');
    expect(JSON.parse(r.text).mcpServers.dayglance).toEqual(ENTRY);
  });

  it('a config whose mcpServers is malformed still merges without crashing', () => {
    const r = mergeClaudeConfig(JSON.stringify({ mcpServers: 'oops' }), ENTRY);
    if (r.action !== 'merged') throw new Error('expected merged');
    expect(JSON.parse(r.text).mcpServers.dayglance).toEqual(ENTRY);
  });

  it('unparseable or non-object roots are NEVER writable', () => {
    for (const text of ['{ broken', '"a string"', '[1,2]', 'null']) {
      expect(mergeClaudeConfig(text, ENTRY)).toEqual({ action: 'unparseable' });
    }
  });

  it('the manual snippet is valid JSON containing exactly our entry', () => {
    expect(JSON.parse(manualEntrySnippet(ENTRY))).toEqual({ mcpServers: { dayglance: ENTRY } });
  });
});

describe('discoveryFilePath — §3.4, MAS writes nothing', () => {
  it('per-platform paths match the spec table and the bridge resolver', () => {
    expect(discoveryFilePath('darwin', {}, HOME, false))
      .toBe('/Users/casey/Library/Application Support/dayGLANCE/mcp.json');
    expect(discoveryFilePath('win32', { APPDATA: 'C:\\Users\\casey\\AppData\\Roaming' }, 'C:\\Users\\casey', false))
      .toContain('dayGLANCE');
    expect(discoveryFilePath('linux', { XDG_CONFIG_HOME: '/home/casey/.cfg' }, '/home/casey', false))
      .toBe('/home/casey/.cfg/dayglance/mcp.json');
    expect(discoveryFilePath('linux', {}, '/home/casey', false))
      .toBe('/home/casey/.config/dayglance/mcp.json');
    expect(discoveryFilePath('win32', {}, 'C:\\Users\\casey', false)).toBeNull();
  });

  it('MAS → null on every platform: no discovery file, ever (Phase 0.5)', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(discoveryFilePath(platform, { APPDATA: 'X', XDG_CONFIG_HOME: 'Y' }, HOME, true)).toBeNull();
    }
  });

  it('the payload is exactly {port, token}: every extra field is compatibility surface', () => {
    expect(JSON.parse(discoveryPayload(7893, 'tok'))).toEqual({ port: 7893, token: 'tok' });
  });
});
