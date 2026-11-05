// The drop rule's column limit (useTaskDerived's wouldExceedMaxColumns): a
// drop that would put a task in a fourth side-by-side column is refused.
// Pure, so the rule is tested without the hook around it.

import { continuationsFromPreviousDay, overnightSpillMinutes, shiftDateStr } from '@glance-apps/agenda-core';
import { getOccurrencesInRange } from './recurrenceEngine.js';
import { assignLanes } from './intervalLanes.js';
import { continuationLayoutRow } from './continuations.js';

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Pack a day's tasks into side-by-side columns. Sorting decides who gets the
// lower column on a start-time tie; the packing itself (overlap clusters,
// first-fit columns, per-cluster column counts) is the shared interval packer
// that the Day Dial and the month view use too, so every surface agrees on
// which tasks share a column.
export const packTaskColumns = (tasks, compare) => assignLanes(
  tasks
    .map((task) => {
      const startMin = timeToMinutes(task.startTime);
      return { task, startMin, endMin: startMin + task.duration };
    })
    .sort(compare),
);

// Longer tasks claim the lower column on a start-time tie.
const byStartThenLonger = (a, b) => {
  if (a.startMin !== b.startMin) return a.startMin - b.startMin;
  if (a.task.duration !== b.task.duration) return b.task.duration - a.task.duration;
  return String(a.task.id).localeCompare(String(b.task.id));
};

/**
 * The rows a date's columns are packed from: its timed tasks (imported events
 * aside, as the timelines lay them out full width) and its recurring
 * occurrences with each date's exception, less `excludeId`.
 */
function columnRowsForDate({ tasks, recurringTasks, dateStr, excludeId }) {
  const regular = tasks.filter(t => t.date === dateStr && t.id !== excludeId && !t.isAllDay && (!t.imported || t.isTaskCalendar));
  const recurring = [];
  for (const template of recurringTasks) {
    if (template.isAllDay) continue;
    for (const ds of getOccurrencesInRange(template, dateStr, dateStr)) {
      const rid = `recurring-${template.id}-${ds}`;
      if (rid === excludeId) continue;
      const exception = template.exceptions?.[ds];
      recurring.push({
        id: rid,
        date: ds,
        startTime: exception?.startTime ?? template.startTime,
        duration: exception?.duration ?? template.duration,
        isAllDay: false,
      });
    }
  }
  return [...regular, ...recurring];
}

// Does `row`, packed among `others`, sit in a cluster wider than `maxColumns`?
function exceeds(row, others, maxColumns) {
  const placed = packTaskColumns([...others, row], byStartThenLonger).find(p => p.task === row);
  return !!placed && placed.laneCount > maxColumns;
}

/**
 * Would dropping `droppedTask` at `startTime` on `dropDateStr` put it in more
 * than `maxColumns` side-by-side columns?
 *
 * Counted as the timelines lay a date out (#2278): the previous night's tasks
 * still running after midnight take a column from 00:00 beside the date's own
 * (continuationLayoutRow, the one carry rule), as occupancy counts them busy.
 * A drop that runs past midnight itself is held to the same limit on the
 * next date, where its own piece is laid out.
 */
export function wouldExceedMaxColumns({ tasks = [], recurringTasks = [], droppedTask, startTime, dropDateStr, maxColumns = 3 }) {
  const excludeId = droppedTask.id;
  const rowsFor = (dateStr) => columnRowsForDate({ tasks, recurringTasks, dateStr, excludeId });
  const piecesFrom = (rows) => continuationsFromPreviousDay(rows).map(continuationLayoutRow);

  const sameDay = rowsFor(dropDateStr);
  const hypotheticalTask = { ...droppedTask, startTime, date: dropDateStr };
  if (exceeds(hypotheticalTask, [...sameDay, ...piecesFrom(rowsFor(shiftDateStr(dropDateStr, -1)))], maxColumns)) return true;

  if (overnightSpillMinutes(hypotheticalTask) > 0) {
    const nextDate = shiftDateStr(dropDateStr, 1);
    const [ownPiece] = piecesFrom([hypotheticalTask]);
    return exceeds(ownPiece, [...rowsFor(nextDate), ...piecesFrom(sameDay)], maxColumns);
  }
  return false;
}
