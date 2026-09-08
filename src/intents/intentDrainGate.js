// May an intent drain run now? Pure; the stateful inputs live in
// sync/initialPull.js and sync/vaultConfig.js.
//
// With vault sync on, a drain must not run before the first pull of the
// session has committed: the create handler's guards read local state, and
// on a device that has been idle that state predates the fleet's completions
// and tombstones (see sync/initialPull.js). A pull that never completes must
// not hold intents forever, so after INTENT_DRAIN_WAIT_MAX_MS the drain runs
// anyway; by then the sync channel has reported its own failure.

import { isVaultEnabled } from '../sync/vaultConfig.js';
import { initialPullCompleted, msSinceAppStart } from '../sync/initialPull.js';

export const INTENT_DRAIN_WAIT_MAX_MS = 3 * 60 * 1000;
export const INTENT_DRAIN_RETRY_MS = 15 * 1000;

/** @returns {{ allowed: boolean, reason: 'no-vault-sync'|'pulled'|'waited-out'|'awaiting-first-pull' }} */
export function intentDrainDecision({ vaultSyncEnabled, pullDone, msSinceStart }) {
  if (!vaultSyncEnabled) return { allowed: true, reason: 'no-vault-sync' };
  if (pullDone) return { allowed: true, reason: 'pulled' };
  if (msSinceStart >= INTENT_DRAIN_WAIT_MAX_MS) return { allowed: true, reason: 'waited-out' };
  return { allowed: false, reason: 'awaiting-first-pull' };
}

let announced = false;
/** The live decision. Logs the hold once per session. */
export function intentDrainAllowed() {
  const d = intentDrainDecision({
    vaultSyncEnabled: isVaultEnabled(), pullDone: initialPullCompleted(), msSinceStart: msSinceAppStart(),
  });
  if (!d.allowed && !announced) {
    announced = true;
    console.info('[intent] holding the first drain until the first sync pull of this session completes');
  }
  return d.allowed;
}
