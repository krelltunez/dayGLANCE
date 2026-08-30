import { describe, it, expect } from 'vitest';
import { deriveBridgeStatus } from './bridgeStatus.js';

const NOW = Date.parse('2026-08-31T12:00:00Z');

describe('deriveBridgeStatus (the three-state bridge indicator)', () => {
  it('fresh AND paired heartbeat → active, with days since pairing from the meta row', () => {
    const out = deriveBridgeStatus(
      { obsidianRunning: true, pluginAuthoritative: true },
      { pairedAt: '2026-08-28T09:00:00Z' }, NOW,
    );
    expect(out).toEqual({ state: 'active', vaultPaired: true, pairedDays: 3 });
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
    expect(out).toEqual({ state: 'unpairedHere', vaultPaired: false, pairedDays: null });
  });

  it('no fresh heartbeat (Obsidian closed, plugin missing, stale beat) → notDetected; null/garbage inputs stay conservative', () => {
    expect(deriveBridgeStatus({ obsidianRunning: false, pluginAuthoritative: false }, null, NOW).state).toBe('notDetected');
    expect(deriveBridgeStatus(null, null, NOW)).toEqual({ state: 'notDetected', vaultPaired: false, pairedDays: null });
    expect(deriveBridgeStatus(null, { pairedAt: 'not a date' }, NOW).pairedDays).toBe(null);
  });

  it('paired today → 0 days, and a skewed-ahead pairedAt clamps to 0 rather than going negative', () => {
    expect(deriveBridgeStatus({ obsidianRunning: true, pluginAuthoritative: true }, { pairedAt: '2026-08-31T09:00:00Z' }, NOW).pairedDays).toBe(0);
    expect(deriveBridgeStatus({ obsidianRunning: true, pluginAuthoritative: true }, { pairedAt: '2026-09-01T09:00:00Z' }, NOW).pairedDays).toBe(0);
  });
});
