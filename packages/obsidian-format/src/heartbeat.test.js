import { describe, it, expect } from 'vitest';
import {
  parseObsidianHeartbeat,
  obsidianHeartbeatState,
  heartbeatPayload,
  OBSIDIAN_HEARTBEAT_STALE_MS,
} from './index.js';

// Heartbeat shape + staleness pins, beside the code (moved from dayGLANCE's
// utils/obsidianHeartbeat.test.js in the format-package extraction). The
// transport reads (FSA / native bridge) stay in dayGLANCE.

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

describe('heartbeatPayload — the writer and the readers share one shape', () => {
  it('what the plugin builder writes, the parser reads back verbatim, and it is fresh at write time', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    const text = JSON.stringify(heartbeatPayload({ deviceId: 'dev-1', now }));
    const hb = parseObsidianHeartbeat(text);
    expect(hb).toEqual({ paired: false, accountId: null, deviceId: 'dev-1', tsMs: now.getTime() });
    expect(obsidianHeartbeatState(hb, now.getTime())).toEqual({ obsidianRunning: true, pluginAuthoritative: false });
  });

  it('a future paired payload flips pluginAuthoritative through the same shape', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');
    const text = JSON.stringify(heartbeatPayload({ deviceId: 'dev-1', paired: true, accountId: 'acct', now }));
    expect(obsidianHeartbeatState(parseObsidianHeartbeat(text), now.getTime()))
      .toEqual({ obsidianRunning: true, pluginAuthoritative: true });
  });
});
