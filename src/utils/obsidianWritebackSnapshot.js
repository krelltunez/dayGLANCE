// The post-scan / post-observation WRITEBACK SNAPSHOT entry (§3.10,
// owned-schedule enforcement, 2026-09-02).
//
// The writeback effect fires on a diff between a task and this snapshot,
// so the snapshot's meaning is "the state the vault line last agreed
// with". For every field but one, the merged task IS that state — the merge
// copies DG's owned values over the line's, and the snapshot follows. The
// exception is a line whose TIME differs from DG's: DG owns scheduling, so
// the merged task carries DG's time, and a snapshot built from it would
// say "no change" and never write DG's time back. The line would stay
// diverged forever — the shape a lost writeback left behind in the field.
// So when the pipeline reports a differing line time (`lineSchedule`), the
// snapshot records the LINE's time: the very next writeback diff sees
// DG's time as a change and writes it through the ordinary path.

/**
 * @param {object} t  the merged task (DG's values)
 * @param {Record<string,{startTime:string}>|null|undefined} lineSchedule
 *   id → the line's own time, present only when it differs from DG's
 */
export function writebackSnapshotEntry(t, lineSchedule) {
  const line = lineSchedule?.[t.id];
  return {
    completed: t.completed,
    startTime: line?.startTime ?? (t.startTime || null),
    duration: t.duration || null,
    title: t.title,
    date: t.date || null,
    // The project rides the line as metadata (companion §4.3, ruling G as
    // amended); tracked so a reassignment in the app is a write trigger.
    projectId: t.projectId || null,
  };
}

/**
 * Does the app hold a change to this task that the snapshot has not seen,
 * and so has not been written to the vault?
 *
 * The writeback is held while a cycle runs and re-run when it ends, diffing
 * each task against this snapshot. A change made DURING a cycle (a task
 * scheduled over MCP while the stream was being fetched) is therefore still
 * waiting when the cycle refreshes the snapshot for the tasks it observed,
 * and that refresh is built from the merged task: it recorded the waiting
 * change as "what the line agrees with", the re-run found nothing to write,
 * and the note never got the schedule. An observed task whose entry already
 * disagrees with the app's copy keeps its entry, so the write still goes out.
 *
 * @param {object|undefined} entry  the task's current snapshot entry
 * @param {object|undefined} live   the app's copy of the task as the cycle found it
 */
export function hasUnwrittenChange(entry, live) {
  if (!entry || !live) return false;
  const now = writebackSnapshotEntry(live, null);
  return Object.keys(now).some((key) => (entry[key] ?? null) !== (now[key] ?? null));
}
