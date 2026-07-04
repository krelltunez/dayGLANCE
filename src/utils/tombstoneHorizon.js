// Stable tombstone-pruning horizon for the sync payload.
//
// WHY THIS EXISTS: buildSyncPayload used to compute `tombstonePrunedBefore` as
// `new Date(Date.now() - retention).toISOString()` on EVERY call. That singleton
// row therefore changed on every sync cycle, so the DB engine's snapshot-diff
// (src/sync/dbEngine.js) marked it dirty and re-pushed it every cycle — a real
// content-row write that advances the account seq with no actual change. Under
// SSE, the vault nudges on every seq advance, the nudge triggers another cycle,
// and it re-pushes the horizon again → a continuous self-nudge loop (the
// "heartbeat"). Under polling the same self-write happened once every few minutes
// and went unnoticed; SSE just made it continuous.
//
// THE FIX: floor the horizon to the start of the UTC day so the value is STABLE
// across the many sync cycles within a day. Then an unchanged cycle produces an
// empty dirty set → no push → no seq advance → no self-nudge. The horizon still
// advances (once per day), so tombstones still age out.
//
// SAFETY: this value is only the resurrection FENCE (merge.js syncHorizon) and the
// reported "pruned-before" marker. The ACTUAL tombstone pruning uses a fresh
// `Date.now() - retention` computed inside the merge, independent of this field —
// so a coarser fence does not change what gets pruned. Flooring makes the fence at
// most 24h earlier at the ~90-day mark, which is conservative (keeps tombstones
// slightly longer; suppresses resurrection marginally less) and well within the
// field's inherently fuzzy semantics.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {number} retentionDays  sync retention window in days (<=0 → no horizon)
 * @param {number} [nowMs]        current epoch ms (injectable for tests)
 * @returns {string|null}         ISO timestamp floored to the UTC day, or null
 */
export function tombstoneHorizon(retentionDays, nowMs = Date.now()) {
  if (!(retentionDays > 0)) return null;
  const cutoff = nowMs - retentionDays * DAY_MS;
  // Floor to the UTC-day boundary → identical output for every call within a day.
  const floored = Math.floor(cutoff / DAY_MS) * DAY_MS;
  return new Date(floored).toISOString();
}
