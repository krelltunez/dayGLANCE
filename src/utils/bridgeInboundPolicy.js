// What a plugin-mode cycle that read NO observations should tell the user
// (the dead-stream toast, audit low of 2026-09-06; damped 2026-09-08).
//
// Two things made the toast cry wolf. The first cycle after every launch ran
// before the DB root key had loaded, so the fetch failed as "unconfigured"
// and the toast said vault changes were not arriving, on every open. And a
// single failed read, a proxy hiccup or a phone changing networks, raised it
// at once, when the next cycle would have cleared it seconds later.
//
//   • 'key-pending'  → HOLD. Not a failure: nothing is counted, nothing is
//                      shown, last-synced stays put. The key arrives and the
//                      next cycle reads normally.
//   • 'rate-limited' → shown at once. The brake that produced it is itself
//                      wall-clock damped, and the message says "paused".
//   • anything else  → counted; the dead-stream error shows on the SECOND
//                      consecutive failure. One failure is a warning in the
//                      console; two in a row is a state worth a toast.
//
// A successful fetch resets the count (the hook does that at the call site).
//
// @param {string|null} reason               lastBridgeInboundFailure()
// @param {number} priorConsecutiveFailures  failures before this cycle
// @returns {{ hold: boolean, count: number, notice: null | 'rate-limited' | 'unavailable' }}
export function inboundFailureNotice(reason, priorConsecutiveFailures = 0) {
  if (reason === 'key-pending') return { hold: true, count: priorConsecutiveFailures, notice: null };
  const count = (priorConsecutiveFailures || 0) + 1;
  if (reason === 'rate-limited') return { hold: false, count, notice: 'rate-limited' };
  return { hold: false, count, notice: count >= 2 ? 'unavailable' : null };
}
