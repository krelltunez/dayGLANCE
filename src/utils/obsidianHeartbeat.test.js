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
