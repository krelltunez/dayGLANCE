import { useCallback, useMemo } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { computeAvailableSlots as computeAvailableSlotsPure } from '../utils/dayOccupancy.js';
import { countHiddenOnDates } from '../utils/calendarFilter.js';

/**
 * How App reads one date's tasks, in two kinds that must not be confused
 * (#2307):
 *
 * - what the day HOLDS: getTasksForDate, getPrevDayTasks, computeAvailableSlots
 *   and dialFrameSlots. No filter of any kind: everything that schedules,
 *   measures free time or occupancy, nudges, runs focus or snapshots the day
 *   reads this;
 * - what the CALENDAR SHOWS: getCalendarTasksForDate, the tag filter and the
 *   hidden projects together (utils/calendarFilter.js). The views take it,
 *   directly or through App's getDayDisplayForDate and continuations.
 *
 * The calendar filter is DISPLAY-ONLY, both its parts: a task it leaves off the
 * calendar still occupies its time, so nothing of the first kind may read it.
 * The tag filter used to ride getTasksForDate by default and so reached frames'
 * free time, scheduling, the nudge, focus and the in-app Day Dial; this hook no
 * longer takes the tag filter on its own, so the held day cannot reach it.
 *
 * Moved out of App.jsx with the hide-projects filter, so the line between the
 * two is tested (useDayReads.test.js, useDayReads.wiring.test.js) rather than
 * kept by convention.
 *
 * @param {object} deps
 * @param {Record<string, object[]>} deps.tasksByDate  the visible rows by date
 * @param {(list: object[]) => object[]} deps.filterForCalendar  tags and hidden projects
 * @param {object} deps.routineOccupancy  dayOccupancy's routine state
 * @param {string[]} deps.calendarFilterDateStrs  the dates the view on screen draws
 */
export default function useDayReads({ tasksByDate, filterForCalendar, routineOccupancy, calendarFilterDateStrs = [] }) {
  // A date's tasks as the day HOLDS them: every visible row, no filter. It
  // takes the date alone; there is no filtered variant of it to ask for.
  // Memoized so downstream useCallback/useMemo consumers stay stable; only
  // re-created when the date-grouped task map changes.
  const getTasksForDate = useCallback(
    (date) => tasksByDate[dateToString(date)] || [],
    [tasksByDate],
  );

  // A date's tasks as the CALENDAR shows them: the tag filter and the hidden
  // projects together. View-only: see above.
  const getCalendarTasksForDate = useCallback((date, applyViewFilter = true) => {
    const dayTasks = tasksByDate[dateToString(date)] || [];
    return applyViewFilter ? filterForCalendar(dayTasks) : dayTasks;
  }, [filterForCalendar, tasksByDate]);

  // How many tasks the calendar filter (tags and hidden projects together)
  // leaves off the dates the view on screen draws, for the filter button's
  // count. Over the date-grouped map the views already read, and recomputed
  // only when it, the filter or the dates change.
  const calendarHiddenCount = useMemo(
    () => countHiddenOnDates(calendarFilterDateStrs, (dateStr) => tasksByDate[dateStr], filterForCalendar),
    [calendarFilterDateStrs, tasksByDate, filterForCalendar],
  );

  // The previous date's rows, for what they leave on `date` after midnight
  // (#2278, agenda-core overnight.js). The previous date owns those tasks; the
  // timelines draw their continuation and occupancy counts it as busy, but
  // getTasksForDate(date) never lists it. As the day holds them, unfiltered.
  const getPrevDayTasks = useCallback((date) => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return getTasksForDate(prev);
  }, [getTasksForDate]);

  // Free time inside a frame instance, subtracting tasks, routines, and (for
  // today) elapsed time. The arithmetic, the buffer
  // merging, and the now-floor all live in src/utils/dayOccupancy.js, which is
  // pure and tested; this only resolves the date and supplies the task list.
  //
  // Over the day as it HOLDS, unfiltered: a view preference does not change
  // how much time the user has. A task the calendar leaves out, by its tag or
  // its project, is still busy time for the frames' "N min free" readouts,
  // scheduling into a frame, the AI's slot context and the snapshots'
  // frameAvailableMinutes.
  const computeAvailableSlots = useCallback((frameInstance, date) => {
    const slotDate = date instanceof Date ? date : new Date(frameInstance.date + 'T12:00:00');
    const now = new Date();
    return computeAvailableSlotsPure(frameInstance, {
      state: routineOccupancy,
      tasks: getTasksForDate(slotDate).filter(t => !t.isAllDay && t.startTime),
      // Last night's task still running after midnight is busy time (#2278).
      prevDayTasks: getPrevDayTasks(slotDate),
      dateStr: dateToString(slotDate),
      todayStr: dateToString(now),
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
    });
  }, [getTasksForDate, getPrevDayTasks, routineOccupancy]);

  // A frame's free time as the Day Dial ships it: the same rule over the same
  // unfiltered day, with one difference on purpose. No now floor (todayStr is
  // the day itself and now is 00:00), because each widget entry floors the
  // slots at its own minute (dialFrameAvailableMinutes).
  const dialFrameSlots = useCallback((frameInstance, date) => {
    const dateStr = dateToString(date);
    return computeAvailableSlotsPure(frameInstance, {
      state: routineOccupancy,
      tasks: getTasksForDate(date).filter(t => !t.isAllDay && t.startTime),
      prevDayTasks: getPrevDayTasks(date),
      dateStr,
      todayStr: dateStr,
      nowMinutes: 0,
    });
  }, [getTasksForDate, getPrevDayTasks, routineOccupancy]);

  return {
    getTasksForDate, getCalendarTasksForDate, calendarHiddenCount,
    getPrevDayTasks, computeAvailableSlots, dialFrameSlots,
  };
}
