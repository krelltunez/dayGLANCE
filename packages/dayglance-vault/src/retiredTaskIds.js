// The merge and retention rules for the `retiredTaskIds` bundle
// ({ oldId → { retiredAt, successor } }), which both sync tiers apply. Moved
// verbatim from the app's src/utils/retiredTaskIds.js (#2280), which imports
// them back and holds the rest of the record's rules (what a retirement is,
// recording one, resolving and applying them). `ts` and `validEntry` are
// exported for that module only (as retiredAtMs and isValidRetirement) and
// are not part of the package's public API.

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// A well-formed entry: { retiredAt: parseable ISO, successor: non-empty string }.
const validEntry = (e) =>
  !!(e && typeof e === 'object' && typeof e.successor === 'string' && e.successor
     && !Number.isNaN(new Date(e.retiredAt).getTime()));

/**
 * Union merge, per-key last-writer-wins on retiredAt; ties break on the
 * successor string (larger wins) so both devices converge on one entry.
 * Malformed entries never beat well-formed ones.
 */
export function mergeRetiredTaskIds(local = {}, remote = {}) {
  const out = {};
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
  for (const k of keys) {
    const l = (local || {})[k];
    const r = (remote || {})[k];
    const lv = validEntry(l);
    const rv = validEntry(r);
    if (lv && !rv) { out[k] = l; continue; }
    if (rv && !lv) { out[k] = r; continue; }
    if (!lv && !rv) continue; // both malformed → drop
    const lt = ts(l.retiredAt);
    const rt = ts(r.retiredAt);
    if (lt !== rt) { out[k] = lt > rt ? l : r; continue; }
    out[k] = String(l.successor) >= String(r.successor) ? l : r;
  }
  return out;
}

/**
 * Prune entries whose retiredAt is strictly older than `cutoff` (a Date), or
 * unparseable. Pure — returns a new map (the same map when nothing changed).
 * `tombstoneBundles` ({id → deletedAt ISO} maps, post-prune) extend the
 * window for an entry whose successor they still name — see
 * successorStillTombstoned below.
 */
export function pruneRetiredTaskIds(record, cutoff, tombstoneBundles = []) {
  if (!record || typeof record !== 'object' || !cutoff) return record || {};
  const cutoffMs = cutoff.getTime();
  let changed = false;
  const out = {};
  for (const [k, e] of Object.entries(record)) {
    if (validEntry(e) && (ts(e.retiredAt) >= cutoffMs || successorStillTombstoned(e, tombstoneBundles, cutoffMs))) out[k] = e;
    else changed = true;
  }
  return changed ? out : record;
}

/**
 * THE FUSE EXTENSION (audit fix M9). The re-mint refusal (isTombstonedRemint)
 * needs BOTH legs on the record: the retirement naming the successor, and
 * the successor's tombstone. Each prunes at the same 60-day window — but
 * keyed on its own timestamp, and the tombstone is stamped when the
 * successor was killed, which is after the retirement was recorded. So the
 * retirement aged out FIRST, the refusal disarmed while the tombstone (and
 * the untagged vault line) still stood, and the oscillation it refuses could
 * resume, damped only by session latches. An aged retirement is therefore
 * KEPT while a tombstone that itself survives the cutoff still names its
 * direct successor: the two legs now prune together, at the tombstone's
 * age. Bounded — the tombstone prunes at 60 days from the kill, and with the
 * refusal armed nothing re-stamps it — after which a re-mint creates a
 * successor no tombstone kills, which is convergence (the line gets its
 * identity back), not the war. Both transports call this with the SAME
 * post-prune bundles, so they stay in lockstep.
 */
function successorStillTombstoned(entry, bundles, cutoffMs) {
  const successor = String(entry.successor);
  for (const bundle of bundles || []) {
    if (!bundle || typeof bundle !== 'object') continue;
    const at = bundle[successor];
    if (typeof at === 'string' && ts(at) >= cutoffMs) return true;
  }
  return false;
}

export { ts as retiredAtMs, validEntry as isValidRetirement };
