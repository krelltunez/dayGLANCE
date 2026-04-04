import { dateToString } from './taskUtils.js';

/**
 * Compute all occurrence date strings (YYYY-MM-DD) of a recurring task template
 * that fall within [rangeStartStr, rangeEndStr] inclusive.
 *
 * Optimised with fast-forward logic so it doesn't iterate every day from the
 * start date when the range is far in the future.
 */
export const getOccurrencesInRange = (template, rangeStartStr, rangeEndStr) => {
  const rec = template.recurrence;
  if (!rec) return [];
  const results = [];
  const startDate = new Date(rec.startDate + 'T12:00:00');
  const rangeStart = new Date(rangeStartStr + 'T12:00:00');
  const rangeEnd = new Date(rangeEndStr + 'T12:00:00');
  const endDate = rec.endDate ? new Date(rec.endDate + 'T12:00:00') : null;
  let count = 0;
  const maxOcc = rec.maxOccurrences || Infinity;

  const addIfInRange = (d) => {
    if (count >= maxOcc) return false;
    if (endDate && d > endDate) return false;
    const ds = dateToString(d);
    if (template.exceptions && (template.exceptions[ds]?.deleted || template.exceptions[ds]?.skipped)) { count++; return true; }
    if (d >= rangeStart && d <= rangeEnd) results.push(ds);
    count++;
    return true;
  };

  if (rec.type === 'daily') {
    // Fast-forward: skip directly to rangeStart instead of iterating from a
    // potentially distant startDate.  Adjust count so maxOccurrences still works.
    const cursor = new Date(Math.max(startDate.getTime(), rangeStart.getTime()));
    if (cursor > startDate) {
      // All noon-anchored dates, so dividing by 86400000 and rounding handles DST correctly.
      count = Math.round((cursor.getTime() - startDate.getTime()) / 86400000);
    }
    while (cursor <= rangeEnd && count < maxOcc) {
      if (endDate && cursor > endDate) break;
      addIfInRange(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (rec.type === 'weekly' || rec.type === 'biweekly') {
    const step = rec.type === 'biweekly' ? 2 : 1;
    const days = (rec.daysOfWeek && rec.daysOfWeek.length > 0) ? rec.daysOfWeek : [startDate.getDay()];
    // Find the week start (Sunday) of the start date
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    // Fast-forward weekStart to the week that contains rangeStart, adjusting count.
    if (rangeStart > startDate) {
      const rangeWeekStart = new Date(rangeStart);
      rangeWeekStart.setDate(rangeWeekStart.getDate() - rangeWeekStart.getDay());
      const msPerCycle = 7 * step * 86400000;
      const cyclesSkip = Math.max(0, Math.floor((rangeWeekStart.getTime() - weekStart.getTime()) / msPerCycle));
      if (cyclesSkip > 0) {
        weekStart.setDate(weekStart.getDate() + cyclesSkip * 7 * step);
        // Conservatively under-count to avoid cutting off valid occurrences.
        // Each skipped cycle has at most days.length occurrences; subtract one
        // cycle as a safety buffer so early occurrences in the window aren't missed.
        count = Math.max(0, (cyclesSkip - 1)) * days.length;
      }
    }
    const cursor = new Date(weekStart);
    while (cursor <= rangeEnd && count < maxOcc) {
      for (const dow of days.sort((a, b) => a - b)) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + dow);
        if (d < startDate) continue;
        if (endDate && d > endDate) break;
        if (d > rangeEnd) break;
        if (!addIfInRange(d)) break;
      }
      cursor.setDate(cursor.getDate() + 7 * step);
    }
  } else if (rec.type === 'monthly') {
    const cursor = new Date(startDate);
    cursor.setDate(1);
    while (cursor <= rangeEnd && count < maxOcc) {
      let target;
      if (rec.monthWeekday) {
        // Nth weekday of month (e.g., 1st Monday)
        const { week, day } = rec.monthWeekday;
        const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const firstDow = firstOfMonth.getDay();
        let offset = day - firstDow;
        if (offset < 0) offset += 7;
        target = new Date(firstOfMonth);
        target.setDate(1 + offset + (week - 1) * 7);
        // Verify still in same month
        if (target.getMonth() !== cursor.getMonth()) {
          cursor.setMonth(cursor.getMonth() + 1, 1);
          continue;
        }
      } else {
        const md = rec.monthDay || startDate.getDate();
        const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        target = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(md, daysInMonth));
      }
      target.setHours(12, 0, 0, 0);
      if (target >= startDate) {
        if (endDate && target > endDate) break;
        if (!addIfInRange(target)) break;
      }
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
  } else if (rec.type === 'yearly') {
    const cursor = new Date(startDate);
    while (cursor <= rangeEnd && count < maxOcc) {
      if (cursor >= startDate) {
        if (endDate && cursor > endDate) break;
        if (!addIfInRange(cursor)) break;
      }
      cursor.setFullYear(cursor.getFullYear() + 1);
    }
  }
  return results;
};

/**
 * Return the standard set of recurrence preset options for a given date string.
 * Used to populate the recurrence picker dropdown in the task editor.
 */
export const getRecurrencePresets = (dateStr) => {
  const taskDate = new Date(dateStr + 'T12:00:00');
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][taskDate.getDay()];
  const monthDay = taskDate.getDate();
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][taskDate.getMonth()];
  const suffix = monthDay === 1 || monthDay === 21 || monthDay === 31 ? 'st' : monthDay === 2 || monthDay === 22 ? 'nd' : monthDay === 3 || monthDay === 23 ? 'rd' : 'th';
  const weekOfMonth = Math.ceil(monthDay / 7);
  const ordinals = ['','1st','2nd','3rd','4th','5th'];

  return [
    { label: 'None', value: null },
    { label: 'Every day', value: { type: 'daily' } },
    taskDate.getDay() === 0 || taskDate.getDay() === 6
      ? { label: 'Every weekend (Sat-Sun)', value: { type: 'weekly', daysOfWeek: [0,6] } }
      : { label: 'Every weekday (Mon-Fri)', value: { type: 'weekly', daysOfWeek: [1,2,3,4,5] } },
    { label: `Every week on ${dayName}`, value: { type: 'weekly', daysOfWeek: [taskDate.getDay()] } },
    { label: `Every 2 weeks on ${dayName}`, value: { type: 'biweekly', daysOfWeek: [taskDate.getDay()] } },
    { label: `Monthly on the ${monthDay}${suffix}`, value: { type: 'monthly', monthDay: monthDay, monthWeekday: null } },
    { label: `Monthly on the ${ordinals[weekOfMonth]} ${dayName}`, value: { type: 'monthly', monthDay: null, monthWeekday: { week: weekOfMonth, day: taskDate.getDay() } } },
    { label: `Yearly on ${monthName} ${monthDay}`, value: { type: 'yearly' } },
  ];
};
