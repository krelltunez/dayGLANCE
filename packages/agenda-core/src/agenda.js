// Day-agenda building (companion spec 4.2 — the sidebar view). Pure.
//
// Mirrors the app's own expansion (App.jsx glanceAhead / todayAgenda): a
// regular scheduled task contributes on its own date; a recurring template
// contributes one instance per occurrence in range, honoring completedDates
// and per-date exceptions exactly as the app does. The two consumers share
// this code so "what does today hold" has one answer.
import { getOccurrencesInRange } from './recurrence.js';

/** Synthetic instance id, the app's own shape (parseRecurringId reads it). */
export const recurringInstanceId = (templateId, dateStr) => `recurring-${templateId}-${dateStr}`;

/**
 * Expand one recurring template into agenda instances for [from, to].
 * @returns {object[]} instances: { id, templateId, instanceDate, title, startTime, duration, color, isAllDay, completed, recurring: true }
 */
export function expandRecurringTemplate(template, fromStr, toStr) {
  if (!template || template.archived) return [];
  const completedDates = new Set(template.completedDates || []);
  return getOccurrencesInRange(template, fromStr, toStr).map((dateStr) => {
    const exception = template.exceptions?.[dateStr];
    if (exception?.deleted) return null;
    return {
      id: recurringInstanceId(template.id, dateStr),
      templateId: template.id,
      instanceDate: dateStr,
      title: exception?.title ?? template.title,
      startTime: exception?.startTime ?? template.startTime ?? null,
      duration: exception?.duration ?? template.duration ?? null,
      color: exception?.color ?? template.color ?? null,
      isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
      completed: completedDates.has(dateStr),
      recurring: true,
      date: dateStr,
    };
  }).filter(Boolean);
}

const timeKey = (t) => (t.isAllDay || !t.startTime ? '' : t.startTime);

/**
 * Build the agenda for a date window.
 *
 * @param {{ tasks?: object[], recurringTasks?: object[], calendarEvents?: object[] }} data  the app's lists
 *   (calendarEvents: read-only events merged from device projections — see calendar.js)
 * @param {{ from: string, to: string, includeImported?: boolean }} opts  inclusive YYYY-MM-DD bounds
 * @returns {Record<string, object[]>}  date → items sorted all-day first, then by time
 *
 * Inbox (unscheduled) tasks are deliberately absent — the ruling for the
 * sidebar's v1 scope. Imported calendar events ride along by default
 * (they are `tasks` with `imported: true`); pass includeImported:false to
 * drop them.
 */
export function buildAgenda(data, { from, to, includeImported = true } = {}) {
  const byDate = {};
  const push = (dateStr, item) => { (byDate[dateStr] ||= []).push(item); };
  for (const t of data?.tasks || []) {
    if (!t || !t.date || t.archived || t.isExample) continue;
    if (t.date < from || t.date > to) continue;
    if (t.imported && !includeImported) continue;
    push(t.date, {
      id: t.id, title: t.title, startTime: t.startTime || null, duration: t.duration ?? null,
      color: t.color || null, isAllDay: !!t.isAllDay, completed: !!t.completed,
      recurring: false, imported: !!t.imported, isTaskCalendar: !!t.isTaskCalendar, date: t.date,
      projectId: t.projectId ?? null,
    });
  }
  for (const r of data?.recurringTasks || []) {
    for (const inst of expandRecurringTemplate(r, from, to)) push(inst.date, inst);
  }
  if (includeImported) {
    for (const e of data?.calendarEvents || []) {
      if (!e || !e.date || e.date < from || e.date > to) continue;
      push(e.date, {
        id: String(e.id), title: e.title ?? '', startTime: e.isAllDay ? null : (e.startTime || null), duration: e.duration ?? null,
        color: e.color || null, isAllDay: !!e.isAllDay, completed: !!e.completed,
        recurring: false, imported: true, projected: true, date: e.date, projectId: null,
        ...(e.calendarName ? { calendarName: e.calendarName } : {}),
      });
    }
  }
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => {
      const ka = timeKey(a), kb = timeKey(b);
      if (ka !== kb) return ka < kb ? -1 : 1; // '' (all-day) sorts first
      return String(a.title).localeCompare(String(b.title));
    });
  }
  return byDate;
}

/** The dates in [from, to] with at least one item (for the month grid's dots). */
export function datesWithItems(agenda) {
  return new Set(Object.keys(agenda).filter((d) => agenda[d].length > 0));
}

/** Local YYYY-MM-DD for a Date (the app's dateToString). */
export function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD shifted by `days` (local calendar arithmetic). */
export function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}
