// GLITCH-HEAL LATCH (audit fix M6) — a cap on snapshot withholding.
//
// A glitch-skipped row the heal cannot resolve (row-get failing, the row
// undecryptable, or a client with no row-get at all) withholds the post-cycle
// snapshot so the row stays in the diff baseline and the heal retries next
// cycle. That is the right first response to a transient. It had no end: a
// row whose heal fails persistently withheld the snapshot FOREVER, which
// re-ran the whole guard classification every cycle and kept the frozen
// baseline re-diffing every since-changed row (the fuel M5's acked-hash
// dedup exists to absorb). The engine's own quarantine caps its retries; the
// wrapper's heal had no equivalent.
//
// Denominated in WALL-CLOCK TIME and attempts, never cycles alone (the
// 2026-08-31 lesson: at trigger speed a cycle count is seconds): an id that
// has been unresolved on at least LATCH_ATTEMPTS attempts spanning at least
// LATCH_MIN_MS is RELEASED — dropped from this cycle's unresolved set so the
// snapshot saves and, the mirror never containing the row, the baseline
// stops tracking it. Nothing is deleted: the vault row is untouched, no
// delete is pushed, and a later pull that lists the row (a peer edit) admits
// it like any other pulled row. A successful heal clears the id's streak.
//
// Memory-only, like the other guards: a reload starts the clock over, which
// is the conservative direction (one more window of retries).

export const LATCH_ATTEMPTS = 3;
export const LATCH_MIN_MS = 10 * 60_000;

/** id → { firstAt: number, attempts: number, latched: boolean } */
const streaks = new Map();

/**
 * Record one unresolved heal outcome for `entityId`. Returns true when the id
 * is (now or already) latched and should be released from the unresolved set.
 */
export function noteGlitchUnresolved(entityId, nowMs = Date.now()) {
  let s = streaks.get(entityId);
  if (!s) { s = { firstAt: nowMs, attempts: 0, latched: false }; streaks.set(entityId, s); }
  if (s.latched) return true;
  s.attempts += 1;
  if (s.attempts >= LATCH_ATTEMPTS && nowMs - s.firstAt >= LATCH_MIN_MS) {
    s.latched = true;
    console.warn(
      `[push] GUARD: glitch-heal latch — ${entityId} could not be re-fetched on ${s.attempts} attempts over ` +
      `${Math.round((nowMs - s.firstAt) / 60000)}min; releasing it from the diff baseline so the snapshot can save. ` +
      `The vault row is untouched (no delete is pushed); a later pull that lists it re-admits it.`
    );
    return true;
  }
  return false;
}

/** A heal that resolved the id (recovered, or the vault agrees it is gone) ends its streak. */
export function clearGlitchUnresolved(entityId) {
  streaks.delete(entityId);
}

/** Test seam. */
export function __resetGlitchHealLatchForTests() {
  streaks.clear();
}
