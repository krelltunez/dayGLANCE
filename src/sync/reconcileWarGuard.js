// RECONCILE WAR GUARD — the same-entity delete-streak detector
// (#1455, designed against its two observed instances: the Phase 2
// transition sync storm and the 2026-08-30 cross-list reconcile war).
//
// The failure class: a loop where every cycle SUCCEEDS — the reconciler
// finds the same id colliding across lists, deletes the loser, something
// (a peer's stale copy, a re-import, a rename ghost) re-supplies it, and
// the delete's own SSE echo triggers the next cycle. Failure-armed brakes
// never engage because nothing fails.
//
// THE RULE: the same id reconcile-deleted a 3rd time within 10 minutes is
// a war, not a resolution. Why 3 and 10: every benign convergence story
// needs at most TWO deletions of one id (the resolution itself, plus one
// replay when a peer's in-flight copy races the first) — a third within
// minutes has no legitimate script. Ten minutes spans both war speeds we
// have observed (SSE-echo cycles seconds apart, and poll-paced wars at the
// 5-minute cadence) while staying far below any timescale on which the
// same id could legitimately need deleting three separate times. State is
// in-memory: a false positive costs one session's suppression, cleared by
// reload.
//
// ON TRIP: further reconcile deletions of that id are SUPPRESSED for a
// cooldown — both copies stay, visibly duplicated rather than invisibly at
// war (the merge stays LWW-correct; nothing here decides which copy wins,
// it only stops re-deciding every cycle) — one LOUD log line names the id,
// and the caller arms the cycle brake so the war's cadence collapses even
// before the suppression starves it. Suppression only pauses the
// reconciler's own action; it changes no §3.10 what-wins rule.

const STREAK_N = 3;
const WINDOW_MS = 10 * 60_000;
const SUPPRESS_MS = 10 * 60_000;

/** id → { hits: number[], suppressedUntil: number } */
const state = new Map();
let trippedThisCycle = false;

/**
 * Note that the reconciler wants to delete `id`'s losing copy, and answer
 * whether to SUPPRESS that deletion. Also flags the trip for the cycle
 * brake (consumeWarTripped).
 */
export function shouldSuppressReconcileDelete(id, nowMs = Date.now()) {
  let s = state.get(id);
  if (!s) { s = { hits: [], suppressedUntil: 0 }; state.set(id, s); }
  if (nowMs < s.suppressedUntil) return true;
  s.hits = s.hits.filter((t) => nowMs - t < WINDOW_MS);
  s.hits.push(nowMs);
  if (s.hits.length < STREAK_N) return false;
  s.suppressedUntil = nowMs + SUPPRESS_MS;
  s.hits = [];
  trippedThisCycle = true;
  console.warn(
    `[reconcile] WAR GUARD: ${id} hit ${STREAK_N} cross-list deletes in ${WINDOW_MS / 60000}min — ` +
    `a delete/resupply war, not a resolution. Suppressing reconcile deletes for this id for ` +
    `${SUPPRESS_MS / 60000}min (both copies retained) and braking the sync cycle. ` +
    `Investigate with localStorage['dayglance-debug-push']='1'.`
  );
  return true;
}

/**
 * True once per cycle in which the guard tripped; reading clears the flag.
 * The sync cycle uses this to arm its brake after an otherwise-successful
 * cycle — the whole point: this failure class never fails on its own.
 */
export function consumeWarTripped() {
  const t = trippedThisCycle;
  trippedThisCycle = false;
  return t;
}

/** Test seam. */
export function __resetWarGuardForTests() {
  state.clear();
  trippedThisCycle = false;
}
