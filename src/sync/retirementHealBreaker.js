// RETIREMENT-HEAL BREAKER — the same-entity streak detector for the
// retire/tombstone oscillation (2026-08-31 SSE-speed war; the ruled fix 4 of
// that commission), built on the #1455 war-guard pattern: streak within a
// wall-clock window, loud trip, cycle brake armed by the caller.
//
// THE FAILURE CLASS: a retired id whose successor is TOMBSTONED-NOT-LIVE is a
// contradiction the snapshot-delete guard cannot resolve — the retirement
// record says the content lives on under the successor, the tombstone says
// the successor is deleted. Every layer's local move is per-spec: the guard
// conservatively refuses the old id's delete (skipped), the glitch heal
// re-fetches the old id from the vault and resurrects it, the push
// re-announces it, a peer's stamp-on-sight re-retires it, a peer's
// note-scoped inference re-tombstones the successor — and the composition is
// a cross-device war. At poll speed the loop turned once per five minutes
// and looked like self-correction; Phase 7's SSE nudges turned it every
// ~1.5 seconds. Like #1455's class, every cycle SUCCEEDS, so failure-armed
// brakes never engage.
//
// THE RULE (same shape and same reasoning as reconcileWarGuard): the same
// entity healed a 3rd time within 10 minutes — while its retirement's
// successor stays tombstoned-not-live — is a war, not a recovery. Two heals
// cover every benign story (one genuine transient shrink plus one replay
// racing a peer); a third within minutes has no legitimate script. The
// window is WALL-CLOCK by construction (the cycles-vs-wall-clock lesson this
// commission records in the spec): at SSE speed the streak trips in
// seconds, at poll speed in a few cycles, and neither faster nor slower
// triggering changes what three-strikes-in-ten-minutes means.
//
// ON TRIP the breaker LATCHES — unlike #1455's cooldown, there is no expiry:
// the contradiction does not resolve itself by waiting, and un-suppressing
// after a cooldown would simply resume the war at whatever speed the
// triggers run. While latched, the caller (dbEngine) stops healing the id
// and lets the cycle's snapshot save WITHOUT it — releasing the id from the
// diff baseline, which ends this device's participation in the loop
// entirely: no heal, no resurrect-push, no further delete attempts. The
// vault row itself is untouched (nothing is deleted by latching), so no
// data is destroyed; the device simply stops re-asserting a copy the rest
// of the fleet keeps refuting. One LOUD console.error names the id, the
// successor, and what the human can do. State is in-memory: a false latch
// costs one session's suppression and clears on reload.

const STREAK_N = 3;
const WINDOW_MS = 10 * 60_000;

/** entityId → { hits: number[], latched: boolean, successor: string|null } */
const state = new Map();
let trippedThisCycle = false;

/**
 * Note that the cycle wants to glitch-heal `entityId`, whose retirement
 * successor is currently tombstoned-not-live, and answer whether to SUPPRESS
 * that heal. Latches (permanently, for this session) on the STREAK_N-th
 * attempt within WINDOW_MS; also flags the trip for the cycle brake
 * (consumeRetirementHealTripped).
 *
 * @param {string} entityId  the retired row's entityId (e.g. "tasks:abc")
 * @param {string|null} successor  the tombstoned successor id (for the log)
 * @param {number} [nowMs]
 * @returns {boolean} true → suppress this heal
 */
export function shouldSuppressRetirementHeal(entityId, successor = null, nowMs = Date.now()) {
  let s = state.get(entityId);
  if (!s) { s = { hits: [], latched: false, successor: null }; state.set(entityId, s); }
  if (s.latched) return true;
  s.successor = successor ?? s.successor;
  s.hits = s.hits.filter((t) => nowMs - t < WINDOW_MS);
  s.hits.push(nowMs);
  if (s.hits.length < STREAK_N) return false;
  s.latched = true;
  s.hits = [];
  trippedThisCycle = true;
  console.error(
    `[push] RETIREMENT-HEAL BREAKER: ${entityId} was glitch-healed ${STREAK_N} times in ` +
    `${WINDOW_MS / 60000}min while its retirement successor (${s.successor ?? 'unknown'}) stayed ` +
    `tombstoned-not-live — a retire/tombstone oscillation (the 2026-08-31 war), not a recovery. ` +
    `LATCHED for this session: this device stops healing and stops tracking the row (the vault row ` +
    `itself is untouched; nothing is deleted). The retirement and the successor's tombstone ` +
    `contradict each other — if the task is missing, restore it by editing it in Obsidian or ` +
    `re-creating it in dayGLANCE; reloading the app re-arms the breaker.`
  );
  return true;
}

/**
 * True once per cycle in which the breaker latched; reading clears the flag.
 * The sync cycle counts it as a breaker strike (like consumeWarTripped) so
 * the war's trigger cadence meets a cooldown even before the latch starves it.
 */
export function consumeRetirementHealTripped() {
  const t = trippedThisCycle;
  trippedThisCycle = false;
  return t;
}

// ── DELETE-PROPAGATION STREAK LATCH ─────────────────────────────────────────
// (2026-08-31 db-tier war commission — the wall the retirement-heal breaker
// above cannot provide.) That breaker guards the SKIPPED/heal arm; the
// observed war never touched it: its rows propagated as '(retired)' and
// '(tombstoned)' every ~2s — each cycle the pull re-supplied the row live,
// something removed it from getData() again (the retirement apply path, the
// tombstone), and the diff re-propagated the SAME delete, which the engine's
// push then flipped into an upsert against the pulled-live mirror copy
// (written:2 deleted:0 — the resurrection primitive). Every classification
// was per-spec; the composition was a loop the skipped-arm breaker was
// structurally unable to see.
//
// THE RULE: one entityId delete-propagated a 4th time inside 10 wall-clock
// minutes has no legitimate script. A delete normally leaves the diff after
// ONE propagation (the saved snapshot stops tracking the row); the benign
// repeats are bounded — a failed push retries (behind the cycle breaker's
// backoff), an acked delete is already skipped upstream (ackedDeletes) and
// never reaches this counter. Four in ten minutes means the row keeps
// RE-ENTERING the baseline between cycles: churn, whatever its shape — this
// latch is deliberately shape-agnostic so the NEXT arm of this war hits the
// same wall without needing its own diagnosis first.
//
// ON TRIP it LATCHES for the session, like the heal breaker and for the same
// reason: the churn does not resolve by waiting, and a cooldown would resume
// the war at trigger speed. While latched the delete is simply not marked
// dirty — this device stops re-asserting the deletion; the vault row and
// local state are both untouched by the latch itself. Worst case for a
// false latch (a genuinely deleted row on a flaky network): the vault keeps
// the row until another device propagates the delete or the user re-deletes
// — visible, recoverable, loudly logged. The war costs more.

const PROPAGATE_STREAK_N = 4;

/** entityId → { hits: number[], latched: boolean, lastReason: string|null } */
const propagateState = new Map();
let propagateTrippedThisCycle = false;

/**
 * Note that the cycle wants to delete-propagate `entityId` (already past the
 * acked-delete skip), and answer whether to SUPPRESS it. Latches on the
 * PROPAGATE_STREAK_N-th propagation within WINDOW_MS.
 *
 * @param {string} entityId
 * @param {string|null} reason  the guard's classification (for the log)
 * @param {number} [nowMs]
 * @returns {boolean} true → suppress this delete
 */
export function shouldSuppressDeletePropagation(entityId, reason = null, nowMs = Date.now()) {
  let s = propagateState.get(entityId);
  if (!s) { s = { hits: [], latched: false, lastReason: null }; propagateState.set(entityId, s); }
  if (s.latched) return true;
  s.lastReason = reason ?? s.lastReason;
  s.hits = s.hits.filter((t) => nowMs - t < WINDOW_MS);
  s.hits.push(nowMs);
  if (s.hits.length < PROPAGATE_STREAK_N) return false;
  s.latched = true;
  s.hits = [];
  propagateTrippedThisCycle = true;
  console.error(
    `[push] DELETE-PROPAGATION LATCH: ${entityId} was delete-propagated ${PROPAGATE_STREAK_N} times in ` +
    `${WINDOW_MS / 60000}min (last classification: ${s.lastReason ?? 'unknown'}) — a delete leaves the ` +
    `baseline after ONE propagation, so a streak means the row keeps being resurrected between cycles ` +
    `(the 2026-08-31 retire/tombstone war shape). LATCHED for this session: this device stops ` +
    `re-asserting the deletion (nothing is deleted or restored by the latch itself). If the row should ` +
    `be gone, delete it again after reloading the app; reloading re-arms the latch.`
  );
  return true;
}

/** True once per cycle in which the propagation latch tripped; reading
 *  clears it. The cycle counts it as a breaker strike, same as the heal
 *  breaker — a war's trigger cadence must meet a cooldown. */
export function consumeDeletePropagationTripped() {
  const t = propagateTrippedThisCycle;
  propagateTrippedThisCycle = false;
  return t;
}

/** Test seam. */
export function __resetRetirementHealBreakerForTests() {
  state.clear();
  trippedThisCycle = false;
  propagateState.clear();
  propagateTrippedThisCycle = false;
}
