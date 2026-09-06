import { describe, it, expect } from 'vitest';
import { deriveBridgeStatus } from './bridgeStatus.js';

const NOW = Date.parse('2026-08-31T12:00:00Z');

describe('deriveBridgeStatus (the three-state bridge indicator)', () => {
  it('fresh AND paired heartbeat → active, with days since pairing from the meta row', () => {
    const out = deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: true },
      { pairedAt: '2026-08-28T09:00:00Z' }, NOW,
    );
    expect(out).toEqual({ state: 'active', vaultPaired: true, pairedDays: 3, stamping: null, lastBeatMs: null });
  });

  it('THE MIDDLE STATE (the field incident): plugin running but NOT paired here, vault meta present — the device lost its credentials', () => {
    // The signature of Obsidian Sync's plugin-settings sync having flipped
    // off: the plugin beats paired:false while the vault's meta:pairing row
    // still exists. Before this indicator the only symptom was direct mode
    // quietly resuming on one device.
    const out = deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: false },
      { pairedAt: '2026-08-28T09:00:00Z' }, NOW,
    );
    expect(out.state).toBe('unpairedHere');
    expect(out.vaultPaired).toBe(true);
  });

  it('plugin running, vault never paired (no meta) → unpairedHere without the lost-credentials framing', () => {
    const out = deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: false }, null, NOW,
    );
    expect(out).toEqual({ state: 'unpairedHere', vaultPaired: false, pairedDays: null, stamping: null, lastBeatMs: null });
  });

  it('no fresh heartbeat (Obsidian closed, plugin missing, stale beat) → notDetected; null/garbage inputs stay conservative', () => {
    expect(deriveBridgeStatus({ obsidianRunning: false, pluginAuthoritative: false }, null, NOW).state).toBe('notDetected');
    expect(deriveBridgeStatus(null, null, NOW)).toEqual({ state: 'notDetected', vaultPaired: false, pairedDays: null, stamping: null, lastBeatMs: null });
    expect(deriveBridgeStatus(null, { pairedAt: 'not a date' }, NOW).pairedDays).toBe(null);
  });

  it('paired today → 0 days, and a skewed-ahead pairedAt clamps to 0 rather than going negative', () => {
    expect(deriveBridgeStatus({ obsidianRunning: true, pluginAuthoritative: true }, { pairedAt: '2026-08-31T09:00:00Z' }, NOW).pairedDays).toBe(0);
    expect(deriveBridgeStatus({ obsidianRunning: true, pluginAuthoritative: true }, { pairedAt: '2026-09-01T09:00:00Z' }, NOW).pairedDays).toBe(0);
  });

  it('STAMPING PASSTHROUGH (2026-08-31 config-null diagnosability): an ACTIVE plugin surfaces its tri-state; every other state nulls it', () => {
    // 'no-config' visible on an active plugin is the whole point — the state
    // that ran the fragment factory invisibly now has a screen presence.
    for (const s of ['armed', 'off', 'no-config']) {
      expect(deriveBridgeStatus(
        { obsidianRunning: true, pluginAuthoritative: true, stamping: s },
        { pairedAt: '2026-08-28T09:00:00Z' }, NOW,
      ).stamping).toBe(s);
    }
    // A non-authoritative plugin's claim is not surfaced (it isn't stamping
    // anything), and a pre-field heartbeat (no stamping key) reads unknown.
    expect(deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: false, stamping: 'armed' }, null, NOW,
    ).stamping).toBe(null);
    expect(deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: true },
      { pairedAt: '2026-08-28T09:00:00Z' }, NOW,
    ).stamping).toBe(null);
  });
});

// ── THE WAITING STATE (2026-09-06 posture ruling) ────────────────────────────
import { describeAgo } from './bridgeStatus.js';

describe('deriveBridgeStatus — the waiting state', () => {
  const stale = { obsidianRunning: false, pluginAuthoritative: false, stamping: null };
  const meta = { pairedAt: '2026-09-01T00:00:00Z' };
  const now = Date.parse('2026-09-06T20:00:00Z');

  it('paired vault + stale or missing heartbeat → waiting (the phone\'s normal resting state), never notDetected', () => {
    expect(deriveBridgeStatus(stale, meta, now)).toEqual({ state: 'waiting', vaultPaired: true, pairedDays: 5, stamping: null, lastBeatMs: null });
    expect(deriveBridgeStatus({ ...stale, lastBeatMs: now - 3 * 3600000 }, meta, now).lastBeatMs).toBe(now - 3 * 3600000);
    expect(deriveBridgeStatus(null, meta, now).state).toBe('waiting');
  });

  it('unpaired vault + stale heartbeat stays notDetected (the direct tier; pairing is the remedy)', () => {
    expect(deriveBridgeStatus(stale, null, now).state).toBe('notDetected');
  });

  it('a running heartbeat still outranks waiting (unpairedHere keeps its remediation framing)', () => {
    expect(deriveBridgeStatus({ ...stale, obsidianRunning: true }, meta, now).state).toBe('unpairedHere');
  });

  it('a garbage lastBeatMs reads as unknown', () => {
    expect(deriveBridgeStatus({ ...stale, lastBeatMs: NaN }, meta, now).lastBeatMs).toBeNull();
    expect(deriveBridgeStatus({ ...stale, lastBeatMs: 'x' }, meta, now).lastBeatMs).toBeNull();
  });
});

describe('describeAgo', () => {
  const now = Date.parse('2026-09-06T20:00:00Z');
  it('is coarse: minutes under two hours, hours under two days, then days', () => {
    expect(describeAgo(now - 40 * 1000, now, 'en')).toMatch(/minute|now/);
    expect(describeAgo(now - 25 * 60000, now, 'en')).toBe('25 minutes ago');
    expect(describeAgo(now - 3 * 3600000, now, 'en')).toBe('3 hours ago');
    expect(describeAgo(now - 5 * 86400000, now, 'en')).toBe('5 days ago');
  });
  it('never goes negative on a skewed-ahead beat', () => {
    expect(describeAgo(now + 3600000, now, 'en')).toMatch(/now|this minute|0 minutes/);
  });
});
