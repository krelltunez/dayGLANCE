// App.jsx's own parse, kept as it was so the move changes no answer.
const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * The focus block at `nowMin`: the incomplete timed tasks in progress now,
 * extended forward through every task that starts before the block ends and
 * runs past it (back-to-back work), and every task overlapping that span.
 *
 * Moved out of App.jsx, where focusModeAvailable and computeFocusBlockTasks
 * each carried a copy. `dayTasks` is the day as it HOLDS (getTasksForDate),
 * never the calendar's filtered read: focus is about what is actually
 * scheduled now, whatever the calendar is set to show.
 *
 * @param {object[]} dayTasks  the date's tasks
 * @param {number} nowMin      minutes since midnight
 * @returns {{ tasks: object[], start: number, end: number } | null}
 *   null when nothing is in progress
 */
export function focusBlockAt(dayTasks, nowMin) {
  const timelineTasks = (dayTasks || [])
    .filter(t => !t.isAllDay && !t.completed && t.startTime)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const inProgress = timelineTasks.filter(t => {
    const start = timeToMinutes(t.startTime);
    const end = start + t.duration;
    return start <= nowMin && end > nowMin;
  });

  if (inProgress.length === 0) return null;

  const start = Math.min(...inProgress.map(t => timeToMinutes(t.startTime)));
  let end = Math.max(...inProgress.map(t => timeToMinutes(t.startTime) + t.duration));

  let extended = true;
  while (extended) {
    extended = false;
    for (const t of timelineTasks) {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      if (tStart <= end && tEnd > end) {
        end = tEnd;
        extended = true;
      }
    }
  }

  const tasks = timelineTasks.filter(t => {
    const tStart = timeToMinutes(t.startTime);
    const tEnd = tStart + t.duration;
    return tStart < end && tEnd > start;
  });
  return { tasks, start, end };
}

/** Focus mode is offered when the block at `nowMin` has 45 minutes or more left. */
export const FOCUS_MIN_REMAINING_MINUTES = 45;

export function focusModeAvailableAt(dayTasks, nowMin) {
  const block = focusBlockAt(dayTasks, nowMin);
  return !!block && block.end - nowMin >= FOCUS_MIN_REMAINING_MINUTES;
}
