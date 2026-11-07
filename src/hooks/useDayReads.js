import { useCallback, useMemo } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { computeAvailableSlots as computeAvailableSlotsPure } from '../utils/dayOccupancy.js';
import { countHiddenOnDates } from '../utils/calendarFilter.js';

/**
 * How App reads one date's tasks, in two kinds that must not be confused
 * (#2307):
 *
 * - what the day HOLDS, for everything that schedules, counts free time or
 *   snapshots the day: getTasksForDate, getPrevDayTasks, computeAvailableSlots
 *   and dialFrameSlots. getTasksForDate(date, true) applies the TAG filter and
 *   nothing more, as it always has (a known leak of a view preference into
 *   frames' free time, kept as it was; see computeAvailableSlots below);
 * - what the CALENDAR SHOWS: getCalendarTasksForDate, the tag filter and the
 *   hidden projects together (utils/calendarFilter.js). The views take it,
 *   directly or through App's getDayDisplayForDate and continuations. A hidden
 *   task still occupies its time, so nothing in the first kind may read it.
 *
 * Moved out of App.jsx with the hide-projects filter, so the line between the
 * two is tested (useDayReads.test.js) rather than kept by convention.
 *
 * @param {object} deps
 * @param {Record<string, object[]>} deps.tasksByDate  the visible rows by date
 * @param {(list: object[]) => object[]} deps.filterByTags
 * @param {(list: object[]) => object[]} deps.filterForCalendar  tags and hidden projects
 * @param {object} deps.routineOccupancy  dayOccupancy's routine state
 * @param {string[]} deps.calendarFilterDateStrs  the dates the view on screen draws
 */
export default function useDayReads({ tasksByDate, filterByTags, filterForCalendar, routineOccupancy, calendarFilterDateStrs = [] }) {
  // Helper to get tasks for a specific date (must be after filterByTags).
  // Memoized so downstream useCallback/useMemo consumers stay stable; only
  // re-created when the tag filter or the date-grouped task map changes.
  // `true` applies the TAG filter only: several of its callers are not views.
  const getTasksForDate = useCallback((date, applyTagFilter = true) => {
    const dateStr = dateToString(date);
    const dayTasks = tasksByDate[dateStr] || [];
    return applyTagFilter ? filterByTags(dayTasks) : dayTasks;
  }, [filterByTags, tasksByDate]);

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
  // getTasksForDate(date) never lists it.
  const getPrevDayTasks = useCallback((date, applyTagFilter = true) => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return getTasksForDate(prev, applyTagFilter);
  }, [getTasksForDate]);

  // Free time inside a frame instance, subtracting tasks, routines, and (for
  // today) elapsed time. The arithmetic, the buffer
  // merging, and the now-floor all live in src/utils/dayOccupancy.js, which is
  // pure and tested; this only resolves the date and supplies the task list.
  //
  // The list stays TAG-FILTERED (getTasksForDate applies the active filter by
  // default), preserving today's behaviour exactly. That coupling is dubious
  // on its own terms, since a view preference should not change how much time
  // the app believes you have, but unpicking it changes numbers on screen for
  // anyone with a filter active and does not belong in the same change as the
  // routine fix. The hidden projects (#2307) are NOT applied here.
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

  // A frame's free time as the Day Dial ships it: the same rule, with two
  // differences on purpose. No now floor (todayStr is the day itself and now
  // is 00:00), because each widget entry floors the slots at its own minute
  // (dialFrameAvailableMinutes); and no tag filter, because the dial draws the
  // unfiltered day.
  const dialFrameSlots = useCallback((frameInstance, date) => {
    const dateStr = dateToString(date);
    return computeAvailableSlotsPure(frameInstance, {
      state: routineOccupancy,
      tasks: getTasksForDate(date, false).filter(t => !t.isAllDay && t.startTime),
      prevDayTasks: getPrevDayTasks(date, false),
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
