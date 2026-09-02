// Routines for a day (companion spec 4.2, the sidebar's routine strip). Pure.
//
// dayGLANCE routines are DAY-SCOPED: each morning the user places chips from
// the routine definitions onto today (`todayRoutines`, stamped by
// `routinesDate`), and the midnight rollover clears them. There is no
// projection for other days — a routine exists only once placed — so this
// answers for exactly one date: the one `routinesDate` names (or, when that
// singleton is absent, the local day each chip was last touched).
// `routineCompletions` (id → YYYY-MM-DD) marks the day's completed ones.

import { localDateStr } from './agenda.js';

const chipDate = (chip) => {
  const t = Date.parse(chip?.lastModified || '');
  return Number.isFinite(t) ? localDateStr(new Date(t)) : null;
};

/**
 * @param {{ todayRoutines?: object[], routinesDate?: string|null, routineCompletions?: Record<string,string> }} data
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {object[]}  { id, name, startTime, duration, isAllDay, completed } sorted all-day first, then by time, then name
 */
export function routinesForDate(data, dateStr) {
  const chips = Array.isArray(data?.todayRoutines) ? data.todayRoutines : [];
  const stamped = typeof data?.routinesDate === 'string' && data.routinesDate;
  if (stamped && stamped !== dateStr) return [];
  const completions = data?.routineCompletions || {};
  const out = [];
  for (const r of chips) {
    if (!r || r.id == null) continue;
    if (!stamped && chipDate(r) !== dateStr) continue;
    const startTime = r.isAllDay ? null : (r.startTime || null);
    out.push({
      id: String(r.id),
      name: String(r.name ?? ''),
      startTime,
      duration: r.duration ?? null,
      isAllDay: !startTime,
      completed: completions[String(r.id)] === dateStr,
    });
  }
  out.sort((a, b) => {
    const ka = a.startTime || '', kb = b.startTime || '';
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}
