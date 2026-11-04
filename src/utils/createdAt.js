// When a task was created (#2135): the stamping and merge rules.
//
// `completedAt` has been stamped on completion for a long time
// (`completionTimestamp`, in every toggle path). `createdAt` is new: before
// this, no ordinary create path recorded one, so "how long has this sat in my
// inbox?" had no answer.
//
// HOW `createdAt` IS STAMPED, AND WHY HERE
//
// Tasks are created in dozens of places: the editor, quick add, drag-to-create,
// voice, AI suggestions, MCP, GLANCEintents, the launcher, duplication. Rather
// than stamp at each (and silently miss the next one someone adds), the persist
// pass stamps it, the way it records `originalPlan`: it is the one place that
// sees every task this device is about to store next to what it already had.
//
// Three rules, all load-bearing:
//
// 1. NEW TO THIS DEVICE, NOT NEW TO A LIST. A task counts as created when its
//    id has never been stored here in ANY task list. Scheduling an inbox task
//    moves it from one list to another, and so does restoring from the bin;
//    neither is a creation, and stamping either would invent a date for a task
//    that predates the feature. `knownIds` is every id stored, across lists.
//
// 2. ONLY WHAT THIS DEVICE WITNESSED BEING CREATED. A task that arrives from
//    another device (a sync apply, during which the pass is suppressed) or from
//    an outside source (a calendar feed, Todoist, a line first read from the
//    Obsidian vault) was created somewhere else at a time this device cannot
//    know. Its id becomes known without a stamp. The device that created it
//    stamped it, and the stamp travels with the task.
//
// 3. NEVER BACKFILLED. Existing tasks keep no `createdAt`, which honestly reads
//    as "not known". A guessed date is worse than none, because everything that
//    reads the field (the editor, MCP, #2146's day log) would believe it. It
//    also keeps the first save after the upgrade from adding a field to every
//    task at once, which stampTimestamps.js explains is read as a mass edit.
//
// Write-once: a task that already has `createdAt` is never touched, whatever
// it arrived from. See normalizeField (not an edit), the vault adapter
// (@glance-apps/dayglance-vault) and mergeSync.js (carried across
// last-writer-wins, earliest kept) and preserveStickyFields.js (carried
// across an apply).

// The merge, earlierCreatedAt, lives in @glance-apps/dayglance-vault (#2280)
// beside the vault adapter that applies it; re-exported here.
export { earlierCreatedAt } from '@glance-apps/dayglance-vault';

const idOf = (task) => String(task?.id);

/**
 * True for a task this device did not create, so the persist pass never
 * stamps it, even the first time it is stored here:
 *  - `imported`: calendar rows (subscription feeds, task calendars, calendar
 *    files) and device calendar events (`_native` as well);
 *  - Todoist (`importSource: 'todoist'`, the `todoist` link): created in
 *    Todoist, at a time Todoist knows and this device does not;
 *  - Obsidian (`importSource: 'obsidian'`): a line first read from the vault
 *    was written there at an unknown time, and an Obsidian task's id can
 *    change (block-id stamping, retitles, project placement) without it being
 *    a new task. The one path that creates an Obsidian task in the app
 *    (useTaskActions' add) stamps `createdAt` itself.
 */
export function isExternalTask(task) {
  return !!task.imported || !!task._native || !!task.todoist
    || task.importSource === 'todoist' || task.importSource === 'obsidian';
}

/**
 * `createdAt` for a task built from another one under a NEW id: an occurrence
 * materialised from its series, a series made from a one-off. It inherits the
 * source's creation, and `null` (not known) when the source has none, which
 * the persist pass leaves alone: a present key, even null, is never stamped,
 * so turning an old series' occurrence into a task cannot invent a date.
 */
export const carryCreatedAt = (source) => ({ createdAt: source?.createdAt ?? null });

/**
 * Stamp `createdAt` on every task in `rows` that is new to this device.
 * Pure: returns `rows` ITSELF when nothing was stamped (the persist pass uses
 * that identity to skip the state write-back), and never mutates `knownIds`.
 *
 * @param {object[]} rows       a task list about to be persisted
 * @param {Set<string>} knownIds  every task id this device has stored, in any list
 * @param {object} opts
 * @param {string} opts.now     the stamp to use (local-offset ISO)
 * @param {(task: object) => boolean} opts.isExternal  true for a task this
 *   device did not create (see isExternalTask)
 */
export function stampCreatedAt(rows, knownIds, { now, isExternal = isExternalTask } = {}) {
  let changed = false;
  const out = rows.map((task) => {
    // A present `createdAt`, even null, is never replaced (see carryCreatedAt).
    if (!task || task.createdAt !== undefined || knownIds.has(idOf(task)) || isExternal(task)) return task;
    changed = true;
    return { ...task, createdAt: now };
  });
  return changed ? out : rows;
}

/**
 * Copy `createdAt` from `stamped` onto `all`, matching by id. The persist pass
 * works on a filtered array, so its result is enriched into state rather than
 * written back wholesale (see applyBaselines in originalPlan.js).
 */
export function applyCreatedAt(all, stamped) {
  const byId = new Map(stamped.filter((t) => t && t.createdAt).map((t) => [idOf(t), t.createdAt]));
  const list = all || [];
  let changed = false;
  const out = list.map((task) => {
    if (!task || task.createdAt) return task;
    const createdAt = byId.get(idOf(task));
    if (!createdAt) return task;
    changed = true;
    return { ...task, createdAt };
  });
  return changed ? out : list;
}

/**
 * The stamp a new task gets: local-offset ISO, the same form as `completedAt`
 * (taskUtils.completionTimestamp, restated here so sync code can import this
 * module without the locale helpers).
 */
export function createdTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
