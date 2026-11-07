// The date range over which recurring templates are expanded into instances
// (the `expandedRecurringTasks` memo in App.jsx). Pulled out so the anchors
// can be tested: the memo used to anchor TODAY into the range and nothing
// else, which was enough for every in-app consumer but not for the widget
// snapshot's projected days — a user parked on last week had no recurring
// instances for today+1…today+N, and a dial with missing blocks looks
// complete, just emptier. Silent. Hence the second anchor.

import { shiftDateStr } from '@glance-apps/agenda-core';
import { dateToString } from './taskUtils.js';
import { schedRollingWindow } from './schedAgenda.js';
import { WIDGET_PROJECTION_DAYS } from './widgetDayProjection.js';
import { monthWindowDates } from './widgetMonthWindow.js';

/**
 * @param opts.visibleDates    Date[] the timeline is showing.
 * @param opts.weekViewDates   Date[] the week view is showing (may be empty).
 * @param opts.monthViewRange  {from, to} 'YYYY-MM-DD' or null.
 * @param opts.selectedDate    Date the user has navigated to.
 * @param opts.schedDaysShown  Rolling SCHED window length in days.
 * @param opts.today           Date (local) — anchored unconditionally.
 * @param opts.projectionDays  How far past today the widget projects; that
 *                             day is anchored unconditionally too.
 * @param opts.weekStartDay    0 = Sunday, 1 = Monday. Anchors the widget
 *                             month window (widgetMonthWindow.js): the start
 *                             of today's week, and the last day of its
 *                             payload (six weeks plus the rollover tail).
 * @returns {{rangeStart: string, rangeEnd: string}} inclusive 'YYYY-MM-DD'.
 */
export function computeRecurringExpansionRange({
  visibleDates = [],
  weekViewDates = [],
  monthViewRange = null,
  selectedDate,
  schedDaysShown = 1,
  today,
  projectionDays = WIDGET_PROJECTION_DAYS,
  weekStartDay = 0,
}) {
  // The SCHED agenda window (mobile SchedView / desktop SchedDashboard)
  // reads days well beyond visibleDates/weekViewDates — on phones weekViewDates
  // is even empty (effectiveViewMode is 'multi'). Always include the agenda's
  // full rolling window so recurring occurrences exist for every rendered day.
  const schedWindow = schedRollingWindow(selectedDate, schedDaysShown);

  // TODAY is anchored into the range unconditionally: plenty of consumers ask
  // about today regardless of where the user has navigated — todayAgenda (and
  // through it GLANCE and the widget snapshot / Live Activity), the macOS NOW
  // bar and title-bar strip. Without the anchor, navigating wholly past (or
  // before) today silently dropped today's recurring instances from all of
  // them — visible as tag pills vanishing from the title bar when paging
  // forward off a weekend-only recurring task's day.
  //
  // TODAY + projectionDays is anchored for the same reason on behalf of the
  // widget snapshot's projected days (widgetDayProjection.js), which are
  // built from tasksByDate whatever the user is looking at.
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + projectionDays);
  // And the widget month window's first and last day, for the same reason:
  // a month grid with a weekly series missing from weeks 3–6 would look
  // complete, just emptier.
  const monthDates = monthWindowDates(today, weekStartDay);
  // And the first cell of today's month grid, for GLANCElauncher's month
  // grid (launcherSnapshot.js), which draws today's whole month from the
  // snapshot's rows: six days before the 1st covers the grid's first cell
  // for any week start. Late in a month the widget window starts weeks after
  // the 1st, and the grid's early weeks lost every recurring occurrence.
  const monthGridStart = new Date(today.getFullYear(), today.getMonth(), 1 - 6, 12);

  const allDateStrs = [
    ...visibleDates.map(d => dateToString(d)),
    ...weekViewDates.map(d => dateToString(d)),
    ...(monthViewRange ? [monthViewRange.from, monthViewRange.to] : []),
    dateToString(selectedDate),
    schedWindow.to,
    dateToString(today),
    dateToString(horizon),
    dateToString(monthDates[0]),
    dateToString(monthDates[monthDates.length - 1]),
    dateToString(monthGridStart),
  ].sort();
  // And the day before the earliest of them: an occurrence that starts there
  // and runs past midnight draws its after-midnight piece on the first day
  // shown and counts as busy there (#2278, agenda-core overnight.js).
  return { rangeStart: shiftDateStr(allDateStrs[0], -1), rangeEnd: allDateStrs[allDateStrs.length - 1] };
}
