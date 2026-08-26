// The successor-aware ID RETIREMENT record: `retiredTaskIds`, a synced
// singleton bundle of { oldId → { retiredAt: ISO, successor: newId } }.
//
// RETIREMENT ≠ DELETION. A retired id stopped naming anything because the SAME
// task's identity moved to a successor id (the Phase 2 block-id migration:
// legacy content-derived id → obsidian-dg-<blockId>; an untagged retitle's
// intermediate hash → the final id). The content survives under the successor,
// so "a newer edit on a retired id" must resolve as "an edit belonging to the
// successor" — never as a resurrection of the old row. Deletion tombstones
// cannot express that: they are last-writer-wins against the row's
// lastModified, so a copy re-stamped NEWER than its tombstone (an offline edit
// crossing a stamp, a peer's normalization re-stamp) revives — which is what
// fed the scan-evict ↔ guard-heal war (the phase2TransitionSyncLoop repro).
//
// THE PROVENANCE RULE — three channels, three different actors, and no write
// site ever has two valid choices:
//   • retiredTaskIds      — written ONLY by the commit that renames an id: it
//                           KNOWS the successor at write time. (useObsidianSync
//                           write-success commit; any future id migration.)
//   • deletedTaskIds      — written ONLY by user-intent delete paths: the user
//                           pressed delete, there IS no successor.
//                           (useTaskActions / useRecycleBin.)
//   • deletedObsidianKeys — written ONLY by the vault-scan deletion detector:
//                           it observed a key vanish and knows NEITHER intent
//                           nor successor (an untagged line retitled in the
//                           vault is indistinguishable from delete+create by
//                           construction — the line carries no identity). It
//                           keeps its conservative, LWW-revivable semantics.
//
// MERGE (mergeRetiredTaskIds): per-key last-writer-wins on retiredAt — two
// devices retiring the same id to DIFFERENT successors (both stamp the same
// untagged line while one is offline) keep the newer retirement. The record
// never arbitrates which successor's ROW survives: the vault line is ground
// truth, carries exactly one block id once Obsidian's own sync settles, and
// the deletion detector reaps the losing successor's row on its device's next
// scan. Ties break deterministically on the successor string so every device
// converges on the same entry.
//
// RESOLUTION (resolveRetirement) is transitive with a cycle guard: entries are
// written pre-collapsed (the commit records every retired id directly against
// the FINAL id of its rename chain), so chains do not occur today — but a
// stale L→M entry alongside M→N resolves to N rather than dangling, so a
// future producer of chains inherits correct behavior.
//
// APPLY (applyTaskRetirements): a row whose id resolves to a live successor is
// SUPERSEDED REGARDLESS OF TIMESTAMPS — the war killer. If the retired copy is
// NEWER than the successor, its content is redirected onto the successor
// (whole-row LWW: the retired copy's fields win, the successor keeps its
// identity fields) so an offline edit made under the retired id is preserved,
// not dropped. If the successor is NOT live locally, the record does nothing
// and the row falls back to ordinary deletion-tombstone semantics — a device
// that has the record but not yet the successor row must not discard content.
//
// PRUNE (pruneRetiredTaskIds): the shared fixed 60-day window
// (sync/tombstoneRetention.js), keyed on retiredAt, applied by BOTH transports
// — same lockstep rule as every deletion bundle, so the two tiers never
// disagree on the set (the disagreement heartbeat the retention module
// documents). An entry with an unparseable retiredAt is pruned: a retirement
// we cannot date cannot be honored predictably, and losing an entry only
// degrades to pre-record semantics.
//
// ─── LEGACY-FLEET DUAL-WRITE SHIM — grep anchor: RETIRED_ID_DUAL_WRITE ──────
// The retirement commit ALSO writes plain deletedTaskIds tombstones for the
// retired ids, because the shipped v4.7.x fleet's file-tier merge consults
// ONLY deletedTaskIds — dropping the dual-write would let stale legacy rows
// resurrect on un-upgraded devices (the (b2) resolution would regress).
// SUNSET CONDITION (checkable, not vibes): delete the dual-write — flip this
// flag, remove the dead branch in useObsidianSync's recordRetirements — when
// BOTH hold:
//   1. at least TOMBSTONE_RETENTION_DAYS (60) have passed since the first
//      release carrying retiredTaskIds shipped, AND
//   2. no pre-retiredTaskIds client (v4.7.x or older) has synced the account
//      within the last TOMBSTONE_RETENTION_DAYS (check the device list in
//      Cloud Sync settings / the vault's device cursors).
// After (1)+(2), every deletedTaskIds entry an old file-tier merge could still
// consult has been GC'd by the shared retention anyway, so the dual-write is
// provably writing entries nothing reads differently.
export const RETIRED_ID_DUAL_WRITE = true;

export const RETIRED_TASK_IDS_STORAGE_KEY = 'day-planner-retired-task-ids';

const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// A well-formed entry: { retiredAt: parseable ISO, successor: non-empty string }.
const validEntry = (e) =>
  !!(e && typeof e === 'object' && typeof e.successor === 'string' && e.successor
     && !Number.isNaN(new Date(e.retiredAt).getTime()));

/** Read the record from localStorage (empty map on absence/corruption). */
export function readRetiredTaskIds() {
  try { return JSON.parse(localStorage.getItem(RETIRED_TASK_IDS_STORAGE_KEY) || '{}'); } catch { return {}; }
}

/**
 * Pure: return a copy of `record` with `{oldId → {retiredAt, successor}}`
 * entries added for each retired id. An existing entry is overwritten only by
 * a newer retirement (same LWW the merge applies).
 */
export function recordRetirements(record, retiredIds, successor, retiredAtIso) {
  const out = { ...(record || {}) };
  for (const oldId of retiredIds || []) {
    const key = String(oldId);
    const prev = out[key];
    if (validEntry(prev) && ts(prev.retiredAt) > ts(retiredAtIso)) continue;
    out[key] = { retiredAt: retiredAtIso, successor: String(successor) };
  }
  return out;
}

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
 */
export function pruneRetiredTaskIds(record, cutoff) {
  if (!record || typeof record !== 'object' || !cutoff) return record || {};
  const cutoffMs = cutoff.getTime();
  let changed = false;
  const out = {};
  for (const [k, e] of Object.entries(record)) {
    if (validEntry(e) && ts(e.retiredAt) >= cutoffMs) out[k] = e;
    else changed = true;
  }
  return changed ? out : record;
}

/**
 * Resolve `id` through the record transitively (L→M plus M→N yields N), with
 * a cycle guard and hop cap. Returns the FINAL successor id, or null when the
 * id is not retired.
 */
export function resolveRetirement(record, id, maxHops = 10) {
  const rec = record && typeof record === 'object' ? record : {};
  let cur = String(id);
  const seen = new Set([cur]);
  let resolved = null;
  for (let hop = 0; hop < maxHops; hop++) {
    const entry = rec[cur];
    if (!validEntry(entry)) break;
    const next = String(entry.successor);
    if (seen.has(next)) break; // cycle — stop at the last sound step
    resolved = next;
    seen.add(next);
    cur = next;
  }
  return resolved;
}

// Fields that belong to the successor's IDENTITY and must survive a content
// redirect: everything else on the retired copy is user content and moves.
const IDENTITY_FIELDS = ['id', 'importSource', 'obsidianBlockId', 'obsidianLegacyId', 'obsidianRawTitle', 'obsidianFileDate'];

/**
 * Apply the retirement record to one task list.
 *
 * For each row whose id resolves to a successor:
 *   • successor live (per `liveIds`, which should span ALL task lists) →
 *     the retired row is SUPERSEDED regardless of timestamps: dropped — and,
 *     when the successor sits in THIS list and the retired copy's lastModified
 *     is strictly newer, the retired copy's content is first redirected onto
 *     the successor (whole-row LWW; the successor keeps IDENTITY_FIELDS).
 *   • successor NOT live anywhere → the row is KEPT (conservative: the record
 *     must never discard content it cannot redirect; ordinary deletion
 *     tombstones still apply to such a row).
 *
 * @param {object[]} list      one task list (tasks or unscheduledTasks)
 * @param {Record<string,{retiredAt:string,successor:string}>} record
 * @param {Set<string>} liveIds  ids currently live across BOTH task lists
 * @returns {object[]} the filtered/redirected list (same array when unchanged)
 */
export function applyTaskRetirements(list, record, liveIds) {
  if (!Array.isArray(list) || !record || Object.keys(record).length === 0) return list || [];
  let changed = false;
  const byId = new Map();
  for (const t of list) { if (t) byId.set(String(t.id), t); }
  const dropped = new Set();
  for (const t of list) {
    if (!t) continue;
    const successor = resolveRetirement(record, t.id);
    if (!successor || successor === String(t.id)) continue;
    if (!liveIds.has(successor)) continue; // no live successor → keep (conservative)
    dropped.add(String(t.id));
    changed = true;
    const succRow = byId.get(successor);
    if (succRow && ts(t.lastModified) > ts(succRow.lastModified)) {
      // Redirect: the retired copy is the newer edit — its content belongs to
      // the successor. Whole-row LWW with the successor's identity preserved.
      const merged = { ...t };
      for (const f of IDENTITY_FIELDS) {
        if (succRow[f] !== undefined) merged[f] = succRow[f];
        else delete merged[f];
      }
      byId.set(successor, merged);
    }
  }
  if (!changed) return list;
  const out = [];
  for (const t of list) {
    if (!t) continue;
    const id = String(t.id);
    if (dropped.has(id)) continue;
    out.push(byId.get(id) || t);
  }
  return out;
}

/**
 * Convenience wrapper for a { tasks, unscheduledTasks } pair: builds the
 * cross-list live-id set and applies the record to both lists.
 */
export function applyRetirementsToTaskLists({ tasks, unscheduledTasks }, record) {
  const t = Array.isArray(tasks) ? tasks : [];
  const u = Array.isArray(unscheduledTasks) ? unscheduledTasks : [];
  if (!record || Object.keys(record).length === 0) return { tasks: t, unscheduledTasks: u };
  const liveIds = new Set([...t, ...u].filter(Boolean).map((x) => String(x.id)));
  return {
    tasks: applyTaskRetirements(t, record, liveIds),
    unscheduledTasks: applyTaskRetirements(u, record, liveIds),
  };
}
