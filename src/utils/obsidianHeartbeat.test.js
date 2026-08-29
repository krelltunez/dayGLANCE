import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseObsidianHeartbeat,
  obsidianHeartbeatState,
  OBSIDIAN_HEARTBEAT_STALE_MS,
} from './obsidianHeartbeat.js';
import { readVaultHeartbeat, readVaultHeartbeatNative } from '../obsidian.js';

// The Phase 5 heartbeat contract: missing, stale, and malformed are ONE
// case (the §3.3 revert path must be one path), freshness is minutes not
// seconds, and `paired` only matters when fresh. The staleness constant is
// deliberately mirrored in electron/obsidianLaunch.ts and the Android
// repository — their own tests pin the same numbers.

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const beat = (ts, extra = {}) =>
  JSON.stringify({ paired: false, accountId: null, deviceId: 'dev-1', ts, ...extra });

describe('parseObsidianHeartbeat', () => {
  it('parses the Phase 5 payload shape', () => {
    expect(parseObsidianHeartbeat(beat('2026-08-29T11:59:00.000Z'))).toEqual({
      paired: false, accountId: null, deviceId: 'dev-1',
      tsMs: Date.parse('2026-08-29T11:59:00.000Z'),
    });
  });

  it('malformed JSON, missing/bad ts, empty, and non-string are all null', () => {
    expect(parseObsidianHeartbeat('not json')).toBe(null);
    expect(parseObsidianHeartbeat(JSON.stringify({ paired: true }))).toBe(null);
    expect(parseObsidianHeartbeat(JSON.stringify({ ts: 'whenever' }))).toBe(null);
    expect(parseObsidianHeartbeat('')).toBe(null);
    expect(parseObsidianHeartbeat(null)).toBe(null);
    expect(parseObsidianHeartbeat(undefined)).toBe(null);
  });
});

describe('obsidianHeartbeatState', () => {
  it('fresh → running; missing/stale/far-future are identical (not running)', () => {
    expect(obsidianHeartbeatState(parseObsidianHeartbeat(beat('2026-08-29T11:58:00.000Z')), NOW))
      .toEqual({ obsidianRunning: true, pluginAuthoritative: false });
    const stale = obsidianHeartbeatState(parseObsidianHeartbeat(beat('2026-08-29T11:50:00.000Z')), NOW);
    const missing = obsidianHeartbeatState(null, NOW);
    const farFuture = obsidianHeartbeatState(parseObsidianHeartbeat(beat('2026-08-29T14:00:00.000Z')), NOW);
    expect(stale).toEqual(missing);
    expect(farFuture).toEqual(missing);
    expect(missing).toEqual({ obsidianRunning: false, pluginAuthoritative: false });
  });

  it('exactly at the threshold is stale (strict <), and the threshold is minutes not seconds', () => {
    expect(OBSIDIAN_HEARTBEAT_STALE_MS).toBe(5 * 60 * 1000);
    const atEdge = parseObsidianHeartbeat(beat(new Date(NOW - OBSIDIAN_HEARTBEAT_STALE_MS).toISOString()));
    expect(obsidianHeartbeatState(atEdge, NOW).obsidianRunning).toBe(false);
    const justInside = parseObsidianHeartbeat(beat(new Date(NOW - OBSIDIAN_HEARTBEAT_STALE_MS + 1).toISOString()));
    expect(obsidianHeartbeatState(justInside, NOW).obsidianRunning).toBe(true);
  });

  it('pluginAuthoritative = fresh AND paired — the Phase 6 gate, wired now', () => {
    const pairedFresh = parseObsidianHeartbeat(beat('2026-08-29T11:59:00.000Z', { paired: true, accountId: 'acct' }));
    expect(obsidianHeartbeatState(pairedFresh, NOW))
      .toEqual({ obsidianRunning: true, pluginAuthoritative: true });
    // A stale paired beat authorizes nothing — §3.3's revert path.
    const pairedStale = parseObsidianHeartbeat(beat('2026-08-29T11:00:00.000Z', { paired: true }));
    expect(obsidianHeartbeatState(pairedStale, NOW).pluginAuthoritative).toBe(false);
  });
});

describe('transport reads', () => {
  afterEach(() => { delete global.window; vi.restoreAllMocks(); });

  const fsaVault = (files) => ({
    kind: 'directory',
    async getDirectoryHandle(n) {
      if (files[n]) return {
        async getFileHandle(f) {
          if (typeof files[n][f] === 'string') return { async getFile() { return { text: async () => files[n][f] }; } };
          const e = new Error('nf'); e.name = 'NotFoundError'; throw e;
        },
      };
      const e = new Error('nf'); e.name = 'NotFoundError'; throw e;
    },
  });

  it('FSA/Electron: reads .dayglance/heartbeat; missing dir or file → null', async () => {
    const hb = await readVaultHeartbeat(fsaVault({ '.dayglance': { heartbeat: beat('2026-08-29T11:59:00.000Z') } }));
    expect(hb.deviceId).toBe('dev-1');
    expect(await readVaultHeartbeat(fsaVault({}))).toBe(null);
    expect(await readVaultHeartbeat(fsaVault({ '.dayglance': {} }))).toBe(null);
  });

  it("native: missing method, null, and the legacy iOS 'null' string echo are all null; a real beat parses", () => {
    global.window = { DayGlanceObsidian: {} };
    expect(readVaultHeartbeatNative()).toBe(null);
    global.window = { DayGlanceObsidian: { getHeartbeat: () => null } };
    expect(readVaultHeartbeatNative()).toBe(null);
    global.window = { DayGlanceObsidian: { getHeartbeat: () => 'null' } };
    expect(readVaultHeartbeatNative()).toBe(null);
    global.window = { DayGlanceObsidian: { getHeartbeat: () => '' } };
    expect(readVaultHeartbeatNative()).toBe(null); // determinately absent parses to null too
    global.window = { DayGlanceObsidian: { getHeartbeat: () => beat('2026-08-29T11:59:00.000Z') } };
    expect(readVaultHeartbeatNative()?.deviceId).toBe('dev-1');
  });
});
