import { useCallback, useMemo } from 'react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { buildJoboDayModel } from '../jobo/viewModel.js';
import { summarizeJoboDayModel } from '../jobo/dayStats.js';
import { buildStatisticsReports, statisticsEvidenceDates, statisticsReportFromModel } from '../jobo/checkStatistics.js';
import { weekViewDatesFor } from '../utils/weekViewDates.js';
import { skippedOccurrences } from '../jobo/skipOccurrence.js';

/**
 * What JOBO's statistics read for the selected date, shared by the desktop's
 * date-row tiles (JoboStatsHeader) and the phone's statistics sheet (slice
 * 8): the day's model and its summary, and for the full panel the week's
 * dates, the dates with evidence (only while `open`, since All time walks
 * the whole ledger) and the report builder. The pure day model, without
 * estimates, drag previews, ledger state or a writer. Not loaded is not an
 * empty ledger: the model is null until the ledger is.
 */
export default function useJoboStatistics({ open = false } = {}) {
  const planner = useDayPlannerCtx();
  const features = useFeaturesCtx();
  const { selectedDate, getTasksForDate, tasks, unscheduledTasks, expandedRecurringTasks, recurringTasks } = planner;
  const { joboLoaded, joboRecords, joboError } = features;
  const isVisibleForUser = planner.isVisibleForUser || features.isVisibleForUser;
  const date = dateToString(selectedDate);
  const currentTime = planner.currentTime instanceof Date ? planner.currentTime : new Date();
  const nowDate = dateToString(currentTime);
  const nowTime = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
  const model = useMemo(() => {
    if (!joboLoaded || !Array.isArray(joboRecords)) return null;
    const dayTasks = getTasksForDate(selectedDate, false).filter(task => !task.isAllDay && task.startTime);
    return buildJoboDayModel({
      date, tasks: dayTasks,
      taskLookup: [...(tasks || []), ...(unscheduledTasks || []), ...(expandedRecurringTasks || []), ...dayTasks],
      recurringTasks, records: joboRecords, isVisibleForUser, now: { date: nowDate, time: nowTime },
    });
  }, [date, selectedDate, getTasksForDate, tasks, unscheduledTasks, expandedRecurringTasks, recurringTasks,
    joboLoaded, joboRecords, isVisibleForUser, nowDate, nowTime]);
  // Occurrences skipped from the Check on this date: hidden by the engine, so
  // not in the model, but still planned, so still in the denominator.
  const skips = useMemo(() => (Array.isArray(joboRecords)
    ? skippedOccurrences(recurringTasks, date, { records: joboRecords, isVisibleForUser }) : []),
  [recurringTasks, date, joboRecords, isVisibleForUser]);
  const stats = useMemo(() => summarizeJoboDayModel(model, { skips }), [model, skips]);
  const weekDates = useMemo(() => weekViewDatesFor({
    viewMode: 'week', selectedDate, weekViewMode: planner.weekViewMode,
    weekStartDay: planner.weekStartDay, today: new Date(`${nowDate}T12:00:00`),
  }), [selectedDate, planner.weekViewMode, planner.weekStartDay, nowDate]);
  const evidenceDates = useMemo(() => open ? statisticsEvidenceDates({
    records: joboRecords, tasks: [...(tasks || []), ...(unscheduledTasks || [])],
    recurringTasks, anchorDate: date, throughDate: nowDate, isVisibleForUser,
  }) : [], [open, joboRecords, tasks, unscheduledTasks, recurringTasks, date, nowDate, isVisibleForUser]);
  const buildReports = useCallback((reportDates, scope) => {
    if (!joboLoaded || joboError || !Array.isArray(joboRecords)) return [];
    // Day uses the selected header's actual model, including now/notStarted.
    // Wider scopes reconstruct only saved history, independently of whatever
    // recurrence dates App currently has expanded for its visible window.
    if (scope === 'day') return [statisticsReportFromModel(model, {
      date: reportDates[0], inboxTasks: unscheduledTasks, isVisibleForUser, skips,
    })];
    return buildStatisticsReports({
      dates: reportDates, tasks, inboxTasks: unscheduledTasks, recurringTasks,
      records: joboRecords, isVisibleForUser, now: { date: nowDate, time: nowTime },
    });
  }, [joboLoaded, joboError, joboRecords, model, skips, tasks, unscheduledTasks, recurringTasks, isVisibleForUser, nowDate, nowTime]);
  return { date, model, stats, weekDates, evidenceDates, buildReports, loaded: joboLoaded, error: joboError };
}
