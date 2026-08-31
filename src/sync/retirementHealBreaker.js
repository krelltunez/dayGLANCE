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

/** Test seam. */
export function __resetRetirementHealBreakerForTests() {
  state.clear();
  trippedThisCycle = false;
}
