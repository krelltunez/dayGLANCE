// Occurrence edits of a recurring series, merged per date across devices
// (docs/recurring-exceptions-merge.md). Pure: no React, no storage.
//
// A series' single-occurrence edits live in its `exceptions[date]`. Both sync
// tiers pick a series row by whole-row last-writer-wins, which loses every
// occurrence edit in the losing row. `exceptionsTimestamps[date]` records
// when each date's exception last changed on this device (derived by the save
// pass, stampExceptionChanges), and mergeExceptions picks each date by it,
// as mergeCompletedDates does for completions. Where the stamps agree, or
// both are missing, the row winner's date stands: rows without stamps merge
// exactly as they did before.

const instant = (stamp) => {
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? t : 0;
};

// Stable JSON: object keys sorted at every level, so two copies of one value
// compare equal whatever order their keys were written in.
const canonical = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
  : v));

const exceptionsOf = (template) => (template?.exceptions && typeof template.exceptions === 'object' ? template.exceptions : {});
const stampsOf = (template) => (template?.exceptionsTimestamps && typeof template.exceptionsTimestamps === 'object'
  ? template.exceptionsTimestamps : {});

/**
 * The series with `now` stamped on each date whose exception was added,
 * changed or removed since `previous`, the stored copy. The same object when
 * nothing changed, or when there is no stored copy to compare with (a series
 * new to this device was not edited here: it was created, or it arrived).
 */
export function stampExceptionDates(template, previous, now) {
  if (!template || !previous) return template;
  const current = exceptionsOf(template);
  const before = exceptionsOf(previous);
  const changed = [...new Set([...Object.keys(current), ...Object.keys(before)])]
    .filter(date => canonical(current[date]) !== canonical(before[date]));
  if (!changed.length) return template;
  const stamps = { ...stampsOf(template) };
  for (const date of changed) stamps[date] = now;
  return { ...template, exceptionsTimestamps: stamps };
}

/** stampExceptionDates over a list, against the stored list; the same array when nothing changed. */
export function stampExceptionChanges(templates, storedTemplates, now) {
  const stored = new Map((storedTemplates || []).filter(Boolean).map(t => [String(t.id), t]));
  let touched = false;
  const out = (templates || []).map((template) => {
    const next = stampExceptionDates(template, template ? stored.get(String(template.id)) : null, now);
    if (next !== template) touched = true;
    return next;
  });
  return touched ? out : templates;
}

/**
 * Put each series' stamp map from `stamped` into the live list, by id, and
 * touch nothing else: state may have moved on since the save pass read it,
 * and the next pass stamps whatever changed meanwhile.
 */
export function applyExceptionStamps(live, stamped) {
  const maps = new Map((stamped || []).filter(t => t?.exceptionsTimestamps).map(t => [String(t.id), t.exceptionsTimestamps]));
  if (!maps.size) return live;
  let touched = false;
  const out = (live || []).map((template) => {
    const map = template && maps.get(String(template.id));
    if (!map || canonical(map) === canonical(template.exceptionsTimestamps)) return template;
    touched = true;
    return { ...template, exceptionsTimestamps: map };
  });
  return touched ? out : live;
}

/**
 * Which copy of one series wins a date whose stamps agree: the newer
 * lastModified, as the tiers pick the row, and on an exact tie the larger
 * content, never the side that happens to be local, so every device and both
 * tiers pick the same copy.
 */
function rowWinner(local, remote) {
  const l = instant(local?.lastModified);
  const r = instant(remote?.lastModified);
  if (l !== r) return l > r ? local : remote;
  return canonical(local) >= canonical(remote) ? local : remote;
}

/**
 * Merge two copies of one series' occurrence edits, per date:
 *  - different stamps (missing counts as none): the newer side's state for
 *    that date wins whole, its exception or its absence (a removal);
 *  - equal stamps, missing on both included: the row winner's state.
 * The stamp map keeps the newer stamp per date. Order-independent and
 * idempotent, as both tiers may apply it more than once and in either order.
 */
export function mergeExceptions(local, remote) {
  const winner = rowWinner(local, remote);
  const sides = [local, remote].map(t => ({ t, exceptions: exceptionsOf(t), stamps: stampsOf(t) }));
  const dates = new Set(sides.flatMap(({ exceptions, stamps }) => [...Object.keys(exceptions), ...Object.keys(stamps)]));
  const exceptions = {};
  const exceptionsTimestamps = {};
  for (const date of [...dates].sort()) {
    const [a, b] = sides.map(side => ({ ...side, at: instant(side.stamps[date]) }));
    const from = a.at !== b.at ? (a.at > b.at ? a : b) : sides.find(side => side.t === winner);
    if (Object.hasOwn(from.exceptions, date)) exceptions[date] = from.exceptions[date];
    // The newer stamp; one instant written two ways keeps the larger text,
    // so the map converges too.
    const stamp = [a.stamps[date], b.stamps[date]].filter(v => v !== undefined)
      .sort((x, y) => instant(y) - instant(x) || (String(y) > String(x) ? 1 : String(y) < String(x) ? -1 : 0))[0];
    if (stamp !== undefined) exceptionsTimestamps[date] = stamp;
  }
  return { exceptions, exceptionsTimestamps };
}

/**
 * The merged copy of a series as a tier writes it: `merged` (the tier's row
 * pick, already carrying its other per-date merges) with the occurrence edits
 * merged per date. The map is left off when empty. Unchanged when either
 * copy is missing: there is nothing concurrent to merge.
 */
export function withMergedExceptions(merged, local, remote) {
  if (!local || !remote) return merged;
  const { exceptions, exceptionsTimestamps } = mergeExceptions(local, remote);
  const hadExceptions = Object.hasOwn(local, 'exceptions') || Object.hasOwn(remote, 'exceptions');
  const next = { ...merged };
  if (hadExceptions || Object.keys(exceptions).length) next.exceptions = exceptions;
  if (Object.keys(exceptionsTimestamps).length) next.exceptionsTimestamps = exceptionsTimestamps;
  else delete next.exceptionsTimestamps;
  return next;
}

/** Whether two copies of a series carry the same occurrence edits and stamps (key order aside). */
export const sameOccurrenceEdits = (a, b) => canonical(exceptionsOf(a)) === canonical(exceptionsOf(b))
  && canonical(stampsOf(a)) === canonical(stampsOf(b));
