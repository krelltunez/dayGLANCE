// Device-calendar events for the widget snapshot, independent of what the app
// is showing.
//
// WHY: device events (EventKit / CalendarContract) are never stored; App.jsx
// fetches them live for the span on screen (utils/nativeFetchWindow.js) and
// each fetch replaces the last. The snapshot read the same list, so the month
// grid only had device events for the days last viewed — ±2 days around the
// selection on DAY. The widget needs the whole window whatever is on screen,
// so it gets its own fetch (hooks/useWidgetNativeEvents.js) over exactly the
// days the window reads (widgetMonthWindow.js monthWindowFetchDates), and this
// module swaps those events in when the snapshot is built.

/**
 * The fetch, grouped by day: { dates: Set<'YYYY-MM-DD'>, byDate: {date: task[]} }.
 * `dates` is every day fetched, including days with no events — an empty day
 * in the fetch is information ("nothing on this day"), not a gap.
 */
export function groupWidgetNativeEvents(dates, tasks) {
  const byDate = {};
  for (const t of tasks) {
    if (!t?.date) continue;
    (byDate[t.date] ||= []).push(t);
  }
  return { dates: new Set(dates), byDate };
}

/**
 * A day's tasks for the widget: the app's list with its device events
 * replaced by the widget fetch's, on any day the fetch covered. Elsewhere
 * (or before the first fetch lands) the app's list is returned untouched.
 *
 * @param dateStr  'YYYY-MM-DD'.
 * @param dayTasks getTasksForDate(date) for that day.
 * @param widgetNative groupWidgetNativeEvents(…) or null.
 */
export function widgetDayTasks(dateStr, dayTasks, widgetNative) {
  if (!widgetNative || !widgetNative.dates.has(dateStr)) return dayTasks;
  return [...(dayTasks || []).filter(t => !t._native), ...(widgetNative.byDate[dateStr] || [])];
}
