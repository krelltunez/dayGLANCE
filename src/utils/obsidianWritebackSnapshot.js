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
  };
}
