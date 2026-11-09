// Subtasks of a repeating task, ticked per occurrence. Pure.
//
// A series keeps ONE subtask list for every occurrence (the template's
// `subtasks`: their titles, order and ids), and which of them are done
// belongs to one day: `subtaskCompletions[date]` holds the ids ticked on that
// occurrence, sorted, and a date with none has no key. It merges per date
// across devices by its own stamps, as the occurrence edits do
// (packages/dayglance-vault/src/recurringExceptions.js).
//
// Every occurrence starts unticked. A `completed` flag left on the template's
// own subtasks by the old shared model (one tick for every day) is not read:
// it would show a stale tick on every day. Adding, renaming, reordering and
// deleting subtasks stay series-wide, on the template, as before.

const ticksOf = (template, date) => {
  const list = template?.subtaskCompletions?.[date];
  return new Set(Array.isArray(list) ? list.map(String) : []);
};

/** The series' subtasks as the occurrence on `date` has them: its own ticks, nothing else. */
export function occurrenceSubtasks(template, date) {
  const ticks = ticksOf(template, date);
  return (template?.subtasks || []).map((st) => ({ ...st, completed: ticks.has(String(st.id)) }));
}

/**
 * The series with subtask `subtaskId` ticked or unticked on the occurrence of
 * `date` (toggled when `done` is not given). Other dates, and the template's
 * subtasks themselves, are left as they are; a date left with no ticks loses
 * its key, and the save pass stamps the change for the per-date merge.
 */
export function withOccurrenceSubtask(template, date, subtaskId, done) {
  const ticks = ticksOf(template, date);
  const id = String(subtaskId);
  const next = done === undefined ? !ticks.has(id) : !!done;
  if (next === ticks.has(id)) return template;
  if (next) ticks.add(id); else ticks.delete(id);
  const map = { ...(template.subtaskCompletions || {}) };
  if (ticks.size) map[date] = [...ticks].sort();
  else delete map[date];
  return { ...template, subtaskCompletions: map };
}
