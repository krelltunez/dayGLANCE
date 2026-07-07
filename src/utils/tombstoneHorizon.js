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
// reported "pruned-before" marker. It MUST be computed from the SAME horizon the
// tombstone GC uses — the fixed 60-day window (TOMBSTONE_RETENTION_DAYS), passed by
// the caller — NOT the user's "Keep past events" setting. The fence tells peers
// "I've pruned tombstones older than this, so don't resurrect items older than
// this"; if it disagrees with the GC horizon a zombie in the gap resurrects (see
// buildSyncPayload). Flooring to the UTC day keeps the row stable across the many
// cycles within a day (an unstable value re-pushes every cycle → SSE self-nudge).

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {number} retentionDays  sync retention window in days (<=0 → no horizon)
 * @param {number} [nowMs]        current epoch ms (injectable for tests)
 * @returns {string|null}         ISO timestamp floored to the UTC day, or null
 */
/**
 * Floor an ISO timestamp to the start of its UTC day, as an ISO string.
 * null/undefined/unparseable pass through unchanged. Idempotent.
 *
 * This is the CANONICAL form of tombstonePrunedBefore. It must be applied
 * everywhere the value is produced (buildSyncPayload → tombstoneHorizon) AND
 * everywhere it is merged/stored (dbAdapter's bundle merge) — otherwise the two
 * sides disagree: buildSyncPayload emits the day-floored value while the merge
 * keeps a same-day FULL-PRECISION remote value (newerIso picks the newer raw
 * timestamp), so the singleton row is dirty on every cycle → push → account seq
 * advance → SSE self-nudge loop. Flooring both sides makes floored == floored so
 * an unchanged cycle produces no push.
 *
 * @param {string|null|undefined} iso
 * @returns {string|null|undefined}
 */
export function floorToUtcDayIso(iso) {
  if (!iso) return iso;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return new Date(Math.floor(t / DAY_MS) * DAY_MS).toISOString();
}

export function tombstoneHorizon(retentionDays, nowMs = Date.now()) {
  if (!(retentionDays > 0)) return null;
  return floorToUtcDayIso(new Date(nowMs - retentionDays * DAY_MS).toISOString());
}
