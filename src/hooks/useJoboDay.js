import { useMemo } from 'react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { assignOverlapColumns, buildJoboDayModel } from '../jobo/viewModel.js';
import { estimateCompletion } from '../components/jobo/DoColumn.jsx';

const clock = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * One day of JOBO, as both its views read it: the desktop view and the
 * phone's (slice 8). The day's timed plan, the lookup records resolve their
 * tasks through, the day model (src/jobo/viewModel.js), and the Do items laid
 * out in overlap columns at `hourHeight`, estimates included. Shared so the
 * two views can never disagree about a day.
 */
export default function useJoboDay({ hourHeight, zoom = 1 }) {
  const ctx = useDayPlannerCtx();
  const { joboRecords, isVisibleForUser } = useFeaturesCtx();
  const { selectedDate, getTasksForDate } = ctx;
  const date = dateToString(selectedDate);
  const currentTime = ctx.currentTime instanceof Date ? ctx.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = clock(currentTime.getHours() * 60 + currentTime.getMinutes());

  const dayTasks = useMemo(
    () => getTasksForDate(selectedDate).filter((task) => !task.isAllDay && task.startTime),
    [getTasksForDate, selectedDate],
  );
  const lookup = useMemo(
    () => [...(ctx.tasks || []), ...(ctx.unscheduledTasks || []), ...(ctx.expandedRecurringTasks || []), ...dayTasks],
    [ctx.tasks, ctx.unscheduledTasks, ctx.expandedRecurringTasks, dayTasks],
  );
  const model = useMemo(() => buildJoboDayModel({
    date, tasks: dayTasks, taskLookup: lookup, recurringTasks: ctx.recurringTasks,
    records: joboRecords || [], scale: hourHeight, isVisibleForUser,
    now: { date: nowDate, time: nowTime },
  }), [date, dayTasks, lookup, ctx.recurringTasks, joboRecords, hourHeight, isVisibleForUser, nowDate, nowTime]);
  const doItems = useMemo(
    () => assignOverlapColumns(
      [...model.timedRecords, ...model.untimedRecords.map(estimateCompletion)],
      { scale: hourHeight, minHeightPx: 27 * zoom, gapPx: 2 },
    ),
    [model.timedRecords, model.untimedRecords, hourHeight, zoom],
  );
  return { date, dayTasks, lookup, model, doItems, currentTime, nowDate, nowTime };
}
