import { describe, it, expect } from 'vitest';
import { intentDrainDecision, INTENT_DRAIN_WAIT_MAX_MS } from './intentDrainGate.js';

describe('intentDrainDecision', () => {
  it('runs freely without vault sync', () => {
    expect(intentDrainDecision({ vaultSyncEnabled: false, pullDone: false, msSinceStart: 0 })).toEqual({ allowed: true, reason: 'no-vault-sync' });
  });

  it('THE STALE-TASK ITEM: with vault sync on, holds until the first pull has committed', () => {
    expect(intentDrainDecision({ vaultSyncEnabled: true, pullDone: false, msSinceStart: 5_000 })).toEqual({ allowed: false, reason: 'awaiting-first-pull' });
    expect(intentDrainDecision({ vaultSyncEnabled: true, pullDone: true, msSinceStart: 5_000 })).toEqual({ allowed: true, reason: 'pulled' });
  });

  it('a pull that never completes does not hold intents forever', () => {
    expect(intentDrainDecision({ vaultSyncEnabled: true, pullDone: false, msSinceStart: INTENT_DRAIN_WAIT_MAX_MS })).toEqual({ allowed: true, reason: 'waited-out' });
  });
});
