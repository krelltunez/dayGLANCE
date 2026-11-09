// Occurrence edits of a recurring series, and which subtasks were ticked on
// which occurrence, merged per date across devices
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

/**
 * The per-date rules for one map on a series and its stamp map beside it:
 * `field` holds each date's state, `stampField` when that date last changed
 * on this device. Two maps use them: occurrence edits (`exceptions`) and
 * which subtasks were ticked on which date (`subtaskCompletions`, below).
 */
function perDateField(field, stampField) {
  const valuesOf = (template) => (template?.[field] && typeof template[field] === 'object' ? template[field] : {});
  const stampsOf = (template) => (template?.[stampField] && typeof template[stampField] === 'object' ? template[stampField] : {});

  // The series with `now` stamped on each date whose value was added, changed
  // or removed since `previous`, the stored copy. The same object when nothing
  // changed, or when there is no stored copy to compare with (a series new to
  // this device was not edited here: it was created, or it arrived).
  function stampDates(template, previous, now) {
    if (!template || !previous) return template;
    const current = valuesOf(template);
    const before = valuesOf(previous);
    const changed = [...new Set([...Object.keys(current), ...Object.keys(before)])]
      .filter(date => canonical(current[date]) !== canonical(before[date]));
    if (!changed.length) return template;
    const stamps = { ...stampsOf(template) };
    for (const date of changed) stamps[date] = now;
    return { ...template, [stampField]: stamps };
  }

  // stampDates over a list, against the stored list; the same array when nothing changed.
  function stampChanges(templates, storedTemplates, now) {
    const stored = new Map((storedTemplates || []).filter(Boolean).map(t => [String(t.id), t]));
    let touched = false;
    const out = (templates || []).map((template) => {
      const next = stampDates(template, template ? stored.get(String(template.id)) : null, now);
      if (next !== template) touched = true;
      return next;
    });
    return touched ? out : templates;
  }

  // Put each series' stamp map from `stamped` into the live list, by id, and
  // touch nothing else: state may have moved on since the save pass read it,
  // and the next pass stamps whatever changed meanwhile.
  function applyStamps(live, stamped) {
    const maps = new Map((stamped || []).filter(t => t?.[stampField]).map(t => [String(t.id), t[stampField]]));
    if (!maps.size) return live;
    let touched = false;
    const out = (live || []).map((template) => {
      const map = template && maps.get(String(template.id));
      if (!map || canonical(map) === canonical(template[stampField])) return template;
      touched = true;
      return { ...template, [stampField]: map };
    });
    return touched ? out : live;
  }

  // Merge two copies, per date:
  //  - different stamps (missing counts as none): the newer side's state for
  //    that date wins whole, its value or its absence (a removal);
  //  - equal stamps, missing on both included: the row winner's state.
  // The stamp map keeps the newer stamp per date. Order-independent and
  // idempotent, as both tiers may apply it more than once and in either order.
  function merge(local, remote) {
    const winner = rowWinner(local, remote);
    const sides = [local, remote].map(t => ({ t, values: valuesOf(t), stamps: stampsOf(t) }));
    const dates = new Set(sides.flatMap(({ values, stamps }) => [...Object.keys(values), ...Object.keys(stamps)]));
    const values = {};
    const stamps = {};
    for (const date of [...dates].sort()) {
      const [a, b] = sides.map(side => ({ ...side, at: instant(side.stamps[date]) }));
      const from = a.at !== b.at ? (a.at > b.at ? a : b) : sides.find(side => side.t === winner);
      if (Object.hasOwn(from.values, date)) values[date] = from.values[date];
      // The newer stamp; one instant written two ways keeps the larger text,
      // so the map converges too.
      const stamp = [a.stamps[date], b.stamps[date]].filter(v => v !== undefined)
        .sort((x, y) => instant(y) - instant(x) || (String(y) > String(x) ? 1 : String(y) < String(x) ? -1 : 0))[0];
      if (stamp !== undefined) stamps[date] = stamp;
    }
    return { values, stamps };
  }

  // The merged copy as a tier writes it: `merged` (the tier's row pick,
  // already carrying its other per-date merges) with this map merged per
  // date. The stamp map is left off when empty. Unchanged when either copy is
  // missing: there is nothing concurrent to merge.
  function withMerged(merged, local, remote) {
    if (!local || !remote) return merged;
    const { values, stamps } = merge(local, remote);
    const had = Object.hasOwn(local, field) || Object.hasOwn(remote, field);
    const next = { ...merged };
    if (had || Object.keys(values).length) next[field] = values;
    if (Object.keys(stamps).length) next[stampField] = stamps;
    else delete next[stampField];
    return next;
  }

  // Whether two copies carry the same map and stamps (key order aside).
  const same = (a, b) => canonical(valuesOf(a)) === canonical(valuesOf(b))
    && canonical(stampsOf(a)) === canonical(stampsOf(b));

  return { stampDates, stampChanges, applyStamps, merge, withMerged, same };
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

// ── Occurrence edits: `exceptions` / `exceptionsTimestamps` ──────────────────

const occurrenceEdits = perDateField('exceptions', 'exceptionsTimestamps');

/** The series with `now` stamped on each date whose exception changed since `previous`. */
export const stampExceptionDates = occurrenceEdits.stampDates;

/** stampExceptionDates over a list, against the stored list; the same array when nothing changed. */
export const stampExceptionChanges = occurrenceEdits.stampChanges;

/** Each series' exceptionsTimestamps from `stamped` put into the live list. */
export const applyExceptionStamps = occurrenceEdits.applyStamps;

/** Two copies of one series' occurrence edits, merged per date. */
export function mergeExceptions(local, remote) {
  const { values, stamps } = occurrenceEdits.merge(local, remote);
  return { exceptions: values, exceptionsTimestamps: stamps };
}

/** The tier's merged row with its occurrence edits merged per date. */
export const withMergedExceptions = occurrenceEdits.withMerged;

/** Whether two copies of a series carry the same occurrence edits and stamps (key order aside). */
export const sameOccurrenceEdits = occurrenceEdits.same;

// ── Subtasks ticked per occurrence: `subtaskCompletions` ─────────────────────
//
// A series keeps one subtask list for every occurrence (the template's
// `subtasks`), but whether a subtask was done belongs to one day: ticking
// "Prepare meals" on Monday says nothing about Tuesday. `subtaskCompletions`
// holds, per date, the ids of the subtasks ticked on that occurrence (sorted,
// so two copies of one state compare equal); a date with none has no key.
// Its own map rather than a field of `exceptions`, whose PRESENCE marks an
// edited occurrence for the statistics, JOBO and the read models: a tick is
// not an edit of the occurrence's plan. Merged per date by its own stamps,
// derived by the save pass, exactly as the exceptions are.

const subtaskTicks = perDateField('subtaskCompletions', 'subtaskCompletionsTimestamps');

/** The series with `now` stamped on each date whose ticked subtasks changed since `previous`. */
export const stampSubtaskCompletionDates = subtaskTicks.stampDates;

/** stampSubtaskCompletionDates over a list, against the stored list; the same array when nothing changed. */
export const stampSubtaskCompletionChanges = subtaskTicks.stampChanges;

/** Each series' subtaskCompletionsTimestamps from `stamped` put into the live list. */
export const applySubtaskCompletionStamps = subtaskTicks.applyStamps;

/** Two copies of one series' ticked subtasks, merged per date. */
export function mergeSubtaskCompletions(local, remote) {
  const { values, stamps } = subtaskTicks.merge(local, remote);
  return { subtaskCompletions: values, subtaskCompletionsTimestamps: stamps };
}

/** The tier's merged row with its ticked subtasks merged per date. */
export const withMergedSubtaskCompletions = subtaskTicks.withMerged;

/** Whether two copies of a series carry the same ticked subtasks and stamps. */
export const sameSubtaskCompletions = subtaskTicks.same;
