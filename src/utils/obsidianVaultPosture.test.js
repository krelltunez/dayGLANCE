// THE VAULT POSTURE (the 2026-09-06 posture ruling) — the one decision,
// pinned: a paired vault keeps a device on the stream side even while its
// own heartbeat is stale; an unpaired vault keeps the frozen direct tier.
import { describe, it, expect } from 'vitest';
import { vaultPosture, isStreamPosture } from './obsidianVaultPosture.js';

const fresh = { obsidianRunning: true, pluginAuthoritative: true, stamping: 'armed' };
const runningUnpairedHere = { obsidianRunning: true, pluginAuthoritative: false, stamping: null };
const stale = { obsidianRunning: false, pluginAuthoritative: false, stamping: null };

describe('vaultPosture', () => {
  it('a fresh AND paired heartbeat is plugin mode, paired vault or not (the beat proves the pairing)', () => {
    expect(vaultPosture({ heartbeat: fresh, vaultPaired: true })).toBe('plugin');
    expect(vaultPosture({ heartbeat: fresh, vaultPaired: false })).toBe('plugin');
  });

  it('THE RULING: a paired vault with a stale or missing heartbeat HOLDS — stream in, intents out, no scan, no direct write', () => {
    expect(vaultPosture({ heartbeat: stale, vaultPaired: true })).toBe('holding');
    expect(vaultPosture({ heartbeat: null, vaultPaired: true })).toBe('holding');
  });

  it('an unpaired vault keeps the frozen direct tier on a stale heartbeat (no stream to fall back on — a deliberate answer)', () => {
    expect(vaultPosture({ heartbeat: stale, vaultPaired: false })).toBe('direct');
    expect(vaultPosture({ heartbeat: null, vaultPaired: false })).toBe('direct');
  });

  it('a plugin RUNNING here but not paired here stays direct: the copy is fresh, and the panel flags the split', () => {
    expect(vaultPosture({ heartbeat: runningUnpairedHere, vaultPaired: true })).toBe('direct');
    expect(vaultPosture({ heartbeat: runningUnpairedHere, vaultPaired: false })).toBe('direct');
  });
});

describe('isStreamPosture', () => {
  it('reads the recorded posture: plugin and holding are the stream side, direct is not', () => {
    expect(isStreamPosture({ ...stale, vaultPosture: 'holding' })).toBe(true);
    expect(isStreamPosture({ ...fresh, vaultPosture: 'plugin' })).toBe(true);
    expect(isStreamPosture({ ...stale, vaultPosture: 'direct' })).toBe(false);
  });

  it('falls back to the heartbeat\'s own authority claim when no posture was recorded yet', () => {
    expect(isStreamPosture(fresh)).toBe(true);
    expect(isStreamPosture(stale)).toBe(false);
    expect(isStreamPosture(null)).toBe(false);
    expect(isStreamPosture(undefined)).toBe(false);
  });
});
