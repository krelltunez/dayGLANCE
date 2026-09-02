// Recurrence expansion — MOVED verbatim from src/utils/recurrenceEngine.js
// (2026-09-02) so the Obsidian plugin's agenda view expands recurring
// series with the SAME code the app does. src/utils/recurrenceEngine.js
// is now a re-export shim; nothing else about this module changed.

const dateToString = (date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Compute all occurrence date strings (YYYY-MM-DD) of a recurring task template
 * that fall within [rangeStartStr, rangeEndStr] inclusive.
 *
 * Optimised with fast-forward logic so it doesn't iterate every day from the
 * start date when the range is far in the future.
 *
 * `maxResults` stops the walk once that many occurrences are in hand. Callers
 * that only need the next one (getNextOccurrence, and through it the project
 * views) would otherwise materialise the whole window to read element 0 — a
 * daily series over two years built 732 dates to return one.
 */
export const getOccurrencesInRange = (template, rangeStartStr, rangeEndStr, maxResults = Infinity) => {
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
    return results.length < maxResults;
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
      if (!addIfInRange(cursor)) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (rec.type === 'weekly' || rec.type === 'biweekly') {
    const step = rec.type === 'biweekly' ? 2 : 1;
    const days = (rec.daysOfWeek && rec.daysOfWeek.length > 0) ? rec.daysOfWeek : [startDate.getDay()];
    // Copied before sorting: `days` is often rec.daysOfWeek itself, and this
    // runs inside render-path memos — sorting in place mutated the template
    // held in React state. Hoisted out of the loop while we're here.
    const sortedDays = [...days].sort((a, b) => a - b);
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
    let stop = false;
    while (!stop && cursor <= rangeEnd && count < maxOcc) {
      for (const dow of sortedDays) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + dow);
        if (d < startDate) continue;
        if (endDate && d > endDate) { stop = true; break; }
        if (d > rangeEnd) { stop = true; break; }
        if (!addIfInRange(d)) { stop = true; break; }
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

// How far ahead getNextOccurrence is willing to look. Only a backstop against
// a pathological search: every real termination comes from the series itself
// (endDate, maxOccurrences) or from finding the occurrence. It was two years,
// which quietly reported "no next occurrence" for a series starting further
// out than that — and callers read that as "ended".
const NEXT_OCCURRENCE_HORIZON_YEARS = 10;

/**
 * Return the next occurrence date string (YYYY-MM-DD) of a recurring task
 * on or after today, or null if the series has no future occurrences.
 */
export const getNextOccurrence = (template) => {
  const today = dateToString(new Date());
  const futureEnd = new Date();
  futureEnd.setFullYear(futureEnd.getFullYear() + NEXT_OCCURRENCE_HORIZON_YEARS);
  const futureEndStr = dateToString(futureEnd);
  const [next] = getOccurrencesInRange(template, today, futureEndStr, 1);
  return next ?? null;
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

const WEEKLY_TYPES = new Set(['weekly', 'biweekly']);

/**
 * Which weekdays a recurrence currently fires on, ascending (0=Sunday).
 *
 * Empty for anything that isn't weekly or biweekly. A weekly recurrence with
 * no explicit daysOfWeek fires on its start date's weekday — the engine's own
 * fallback — so the picker shows that day lit rather than nothing.
 */
export const getSelectedWeekdays = (recurrence, dateStr) => {
  if (!recurrence || !WEEKLY_TYPES.has(recurrence.type)) return [];
  if (recurrence.daysOfWeek?.length) return [...recurrence.daysOfWeek].sort((a, b) => a - b);
  const anchor = recurrence.startDate || dateStr;
  return anchor ? [new Date(anchor + 'T12:00:00').getDay()] : [];
};

/**
 * Add or remove one weekday, returning a NEW recurrence.
 *
 * Turning a day on from a non-weekly recurrence (none, daily, monthly…)
 * converts it to weekly on that day. Removing the last remaining day is
 * refused: a weekly series with no days falls back to its start date's
 * weekday, so the chip would light straight back up. End conditions (endDate,
 * maxOccurrences) survive; monthly-only fields do not.
 */
export const toggleRecurrenceDay = (recurrence, dow, dateStr) => {
  const current = getSelectedWeekdays(recurrence, dateStr);
  const next = current.includes(dow)
    ? current.filter((d) => d !== dow)
    : [...current, dow].sort((a, b) => a - b);
  if (next.length === 0) return recurrence;
  const { monthDay: _md, monthWeekday: _mw, ...rest } = recurrence || {};
  return {
    ...rest,
    type: WEEKLY_TYPES.has(recurrence?.type) ? recurrence.type : 'weekly',
    daysOfWeek: next,
  };
};

/**
 * Switch between 'weekly' and 'biweekly', keeping the chosen days. Reachable
 * from a recurrence that is neither, so the days are resolved first and fall
 * back to the task's own date.
 */
export const setRecurrenceFrequency = (recurrence, type, dateStr) => {
  const days = getSelectedWeekdays(recurrence, dateStr);
  const { monthDay: _md, monthWeekday: _mw, ...rest } = recurrence || {};
  return {
    ...rest,
    type,
    daysOfWeek: days.length ? days : [new Date(dateStr + 'T12:00:00').getDay()],
  };
};

/**
 * The seven weekday numbers starting at the user's first day of the week, so
 * the chip row reads Mon..Sun for a Monday-start user.
 */
export const weekdayOrder = (weekStartDay = 0) =>
  Array.from({ length: 7 }, (_, i) => (i + weekStartDay) % 7);
