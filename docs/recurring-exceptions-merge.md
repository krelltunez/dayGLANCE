# Recurring series: merging occurrence edits per date

Design note. Deferred from the Skip design (`docs/jobo-skip-occurrence.md`,
"Sync: what is not guaranteed") until Direct Access was done.

## The problem

A recurring series is one row, its template. Every edit to a single
occurrence lives inside that row, in `exceptions[date]`:

- a time or title change to one occurrence (`recurringInstanceEdit.js`);
- Postpone and a date change, which mark the old date `skipped`;
- Skip from JOBO's Check (`skipped` plus `skip: { at, plan }`);
- Delete this occurrence (`deleted: true`);
- a reminder snooze, a drag on the timeline, a tag rename.

Both sync tiers resolve the row by whole-row last-writer-wins on
`lastModified`: the vault in `applyRemoteRecurring` (`packages/dayglance-vault/src/adapter.js`),
the file tier in `mergeSyncData` (`src/mergeSync.js`, used by iCloud, Direct
Access and conflict copies). So two edits to the same series on two devices
before they sync keep only the later row, and every occurrence edit in the
other row is lost:

- the phone skips today's occurrence; the desktop renames the series. The
  desktop's row is newer, so the skip is gone and the occurrence comes back;
- one device postpones Tuesday's occurrence, another moves Wednesday's. One
  of the two is undone;
- a reminder snooze on the phone, an edit to the series on the desktop.

Completions had the same problem and were fixed by
`mergeCompletedDates`: `completedDates` is merged per date, with a per-date
stamp map, `completedDatesTimestamps`, after the row is picked. This note
does the same for `exceptions`.

## What is merged, and what is not

- **Per date, the whole exception.** For each date, one device's exception
  object wins whole, by the newer per-date stamp. Two devices editing
  different dates both keep their edit.
- **Not field by field within a date.** One device changing an occurrence's
  time and another its title, concurrently, keep only the later of the two.
  This is the same granularity as everything else in a row, and rare.
- **Not the template's own fields.** The series' title, time, recurrence and
  the rest stay whole-row last-writer-wins, as today.

## What it stores

A map beside `exceptions`, `exceptionsTimestamps: { [date]: stamp }`, the
shape of `completedDatesTimestamps`:

- **Beside, not inside.** The exception objects keep the shape every reader
  already reads (the instance expansion, the statistics, the MCP and Obsidian
  read models, Skip's `skip.at`). A stamp inside them would change what they
  see.
- **It holds removals too.** A date whose exception was removed keeps its
  stamp with no exception: a tombstone, so the removal wins over an older
  copy that still has it. One writer removes a key today: undoing an MCP
  occurrence edit (`taskMutations.js`, `exc === null`). Restore after Skip
  and the series editor keep the key on purpose (its presence marks a saved
  occurrence for the statistics history), and that stays.
- **The stamp** is an ISO instant on this device's clock, like
  `lastModified`; the merge compares instants.

## Who stamps: the save pass, by difference

About a dozen call sites write `exceptions`, and a series-wide edit rewrites
every date's exception at once. A stamp that each writer had to remember
would be missed by the next writer added. Instead the save pass derives it,
the way it already derives `originalPlan`, `deferrals` and `planTrail`:

- for each series, compare each date's exception with the stored copy;
- a date that was added, changed or removed gets `now`;
- the result is written back to React state (rule 4 of "Adding a field to a
  task" in CLAUDE.md), so the payload and the next apply see it.

This is safe from the hazard that rule 1 of the same section warns about, a
fabricated stamp outranking a real edit elsewhere:

- **An apply is never mistaken for an edit.** `applyEngineData` writes the
  merged rows to storage before it sets state, so the save pass that follows
  finds no difference and stamps nothing. This is what already keeps
  `lastModified` from being re-stamped by a sync.
- **The first save after the upgrade stamps nothing:** storage and state are
  equal.
- **The suppression flag** (`suppressTimestampRef`) suppresses this as it
  does `lastModified`.
- **`exceptionsTimestamps` is stripped in `normalizeField`**, so a change to
  the map alone (a merge taking the newer stamp) is never read as an edit
  of the row.

A change that reaches the payload without a stamp (an older app version, or
a path that bypasses the save pass) is not lost: it falls back to the
whole-row rule below, which is today's behaviour.

## The merge rule

One pure function, used by both tiers after the row is picked, as
`mergeCompletedDates` is. For each date in either side's `exceptions` or
`exceptionsTimestamps`:

1. **Different stamps** (a missing stamp counts as zero): the side with the
   newer stamp wins the date. Present, its exception; absent, no exception.
2. **Equal stamps, including both missing:** the row winner's state for that
   date, exactly as today. When the two rows have the same `lastModified`,
   the row winner is picked by comparing the two copies' content, never by
   which side is local, so every device and both tiers pick the same.

The merged `exceptionsTimestamps` takes the newer stamp per date.

What this gives:

- **No regression on old data.** Rows with no stamps merge exactly as they
  do today. Stamps only change the result where they disagree.
- **Order-independent and idempotent,** as CLAUDE.md requires of a merge both
  tiers may apply more than once, in either order.
- **A stamped edit beats an unstamped one** of the same date.

## Mixed app versions

An older version keeps whole-row last-writer-wins, and knows nothing of the
map:

- **Its own edits are unstamped,** so an edit it makes to a date counts as
  older than any stamped edit of that date.
- **It can drop the map** when its own copy of the row, without one, wins
  its merge. Nothing is lost for good: a newer device's next merge keeps the
  newer stamp per date, so the map comes back from whichever device still
  has it.

Once every device is updated, every edit is stamped. No migration is
needed.

## What this resolves

- **Skip's sync limitation** (`docs/jobo-skip-occurrence.md`): a skip on one
  device survives a concurrent series edit on another. Its Undo and Restore
  already refuse to act on a skip that changed meanwhile.
- **Postpone, moves, deletes and snoozes** of single occurrences, against
  concurrent edits to other dates or to the series.

## What stays as it is

- The template's own fields: whole-row last-writer-wins.
- `completedDates` and its merge.
- The exception objects' shape, and every reader of them.
- Field-level merge within one date's exception (not done; see above).

## Testing

At least one scenario must walk the whole path, as CLAUDE.md asks: an edit
on device A, save, state, payload, merge (each tier), apply, state on device
B, with a concurrent edit on B. Then:

- the merge: every combination of stamps and presence; order independence
  (merging A into B equals B into A); idempotence (merging the result again
  changes nothing); legacy rows merging exactly as today;
- the save pass: stamps a date added, changed and removed; stamps nothing
  after an apply, on the first load, or under suppression; writes the map
  back to state; a merge that changes only the map does not re-stamp
  `lastModified`;
- the scenarios: Skip against a series rename; two dates moved on two
  devices; the MCP undo's removal against an older copy; an unstamped edit
  from an older version;
- the headless root, which runs the same save pass and merges: extend
  `HeadlessRefresh.scenarios.test.jsx` with one series carrying the map;
- mutation-check each guard.

## Build order

1. **The pure merge**, with its tests.
2. **Both tiers:** `applyRemoteRecurring` (vault) and the recurring pass in
   `mergeSyncData` (file tier), beside `mergeCompletedDates`.
3. **The save pass:** the derivation, the write-back to state, and
   `normalizeField`.
4. **The scenarios,** including the headless root.
5. **Docs:** the Skip note's sync section, the JOBO guide's sync line, and
   CLAUDE.md's "Adding a field to a task" list of worked examples, if it
   earns a place there.

## Decisions

1. **Per-date whole exception, not field by field.** Recommended: it matches
   `completedDates`, keeps the rule simple, and the field-level case (two
   fields of one occurrence edited concurrently) is rare.
2. **Equal stamps fall back to the row winner**, so legacy rows behave
   exactly as today. The alternative, keeping any exception either side has
   (a union, as `completedDates` does for legacy dates), would also recover
   old unstamped edits, but could bring back an exception that was removed
   before stamps existed. Recommended: the row winner.
3. **Stamps derived by the save pass, not written by each writer.**
   Recommended, for the reasons above.

## Subtasks ticked per occurrence

A series keeps one subtask list for every occurrence (the template's
`subtasks`), and which of them are done belongs to one day. Those ticks live
in a second per-date map with the same rules, `subtaskCompletions`:

- **Shape:** `subtaskCompletions: { [date]: [subtask id, …] }`, ids sorted so
  two copies of one state compare equal; a date with no ticks has no key.
  `subtaskCompletionsTimestamps` sits beside it, as `exceptionsTimestamps`
  does, and holds untick tombstones the same way.
- **Its own map, not a field of `exceptions`.** An exception's presence marks
  an edited occurrence for the statistics, JOBO and the read models; ticking a
  subtask is not an edit of the occurrence's plan.
- **Same machinery.** `recurringExceptions.js` builds both maps from one
  factory: the save pass stamps changed dates, both tiers merge per date after
  the row is picked, and `normalizeField` strips the stamp map. The ticks
  themselves are the user's edit and stamp the row.
- **Every occurrence starts unticked.** A `completed` flag the old shared model
  left on the template's own subtasks is not read (`src/utils/recurringSubtasks.js`);
  it would show a stale tick on every day. Adding, renaming, reordering and
  deleting subtasks stay series-wide.
- **Mixed versions.** An older app still ticks the template's shared flag,
  which a newer one ignores, so ticks made on an older device do not show on a
  newer one until it is updated.

