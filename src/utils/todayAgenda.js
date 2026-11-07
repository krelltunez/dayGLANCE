// Today's agenda, the list GLANCE draws (desktop GlanceSidebar, the phone's
// MobileGlanceSection) and the tray, the Stream Deck and the widget snapshot
// read for what is happening now. Moved verbatim out of App.jsx (its
// `todayAgenda` and `agendaNowMarker` memos); App keeps the memos and the
// clock.

import { notBucketed } from './bucketList.js';

/**
 * @param {object} input
 * @param {string} input.todayStr   today's YYYY-MM-DD (the wall clock's)
 * @param {number} input.nowMinutes minutes since today's midnight
 * @param {Array} input.tasks @param {Array} input.expandedRecurringTasks
 * @param {Array} input.unscheduledTasks @param {Function} input.isVisibleForUser
 * @returns {Array} deadlines, all-day items, then the timed ones in start
 *   order, each tagged `_agendaType`.
 */
export function buildTodayAgenda({ todayStr, nowMinutes, tasks, expandedRecurringTasks, unscheduledTasks, isVisibleForUser }) {
  const today = todayStr;

  // Include recurring instances for today
  const todayRecurring = expandedRecurringTasks.filter(t => t.date === today);
  const allTodayTasks = [...tasks, ...todayRecurring];

  const allDay = allTodayTasks.filter(t => t.date === today && t.isAllDay && !t.completed && isVisibleForUser(t));
  const deadlines = unscheduledTasks.filter(t => notBucketed(t) && t.deadline === today && t.deadline >= today && !t.completed && isVisibleForUser(t));
  const scheduled = allTodayTasks.filter(t => {
    if (t.date !== today || t.isAllDay || !isVisibleForUser(t)) return false;
    const [h, m] = (t.startTime || '0:0').split(':').map(Number);
    const endMinutes = h * 60 + m + (t.duration || 0);
    // Past: hide completed tasks and imported calendar events; keep incomplete user/task-calendar tasks
    if (endMinutes <= nowMinutes) return !t.completed && !(t.imported && !t.isTaskCalendar);
    return true;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  return [
    ...deadlines.map(t => ({ ...t, _agendaType: 'deadline' })),
    ...allDay.map(t => ({ ...t, _agendaType: 'allday' })),
    ...scheduled.map(t => ({ ...t, _agendaType: 'scheduled' })),
  ].filter(t => !t.isExample);
}

/**
 * Where GLANCE's "now" marker goes and the free time it announces ("You have
 * free time at …"). Moved verbatim from App.jsx.
 *
 * @param {object} input
 * @param {Array} input.todayAgenda @param {Date} input.now
 * @param {Array} input.unscheduledTasks @param {Function} input.isVisibleForUser
 */
export function buildAgendaNowMarker({ todayAgenda, now, unscheduledTasks, isVisibleForUser }) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowH = String(now.getHours()).padStart(2, '0');
  const nowM = String(now.getMinutes()).padStart(2, '0');
  const nowTimeStr = `${nowH}:${nowM}`;
  // Only consider scheduled (timed) tasks, sorted by start time
  const scheduled = todayAgenda.filter(t => t._agendaType === 'scheduled');
  // Find where "now" falls among scheduled tasks
  // insertAfterIndex: index in todayAgenda after which to insert the marker (-1 = before all)
  let insertAfterIndex = -1;
  let insideTask = false;
  if (scheduled.length > 0) {
    for (let i = 0; i < todayAgenda.length; i++) {
      const t = todayAgenda[i];
      if (t._agendaType !== 'scheduled') continue;
      const [h, m] = (t.startTime || '0:0').split(':').map(Number);
      const endMin = h * 60 + m + (t.duration || 0);
      if (nowMin >= endMin) {
        insertAfterIndex = i;
      } else if (nowMin >= h * 60 + m) {
        // Currently within this task — place marker before it (it shows "In Progress")
        insertAfterIndex = i - 1;
        insideTask = true;
        break;
      } else {
        break;
      }
    }
  }
  // Ensure the now-marker never appears above all-day or deadline tasks
  const lastNonScheduledIdx = todayAgenda.reduce((acc, t, i) => t._agendaType !== 'scheduled' ? i : acc, -1);
  if (insertAfterIndex < lastNonScheduledIdx) {
    insertAfterIndex = lastNonScheduledIdx;
  }
  // If no scheduled tasks, place marker after all items
  if (scheduled.length === 0) {
    insertAfterIndex = todayAgenda.length - 1;
  }
  // Calculate gap to next scheduled task
  let gapMinutes = 0;
  const nextScheduledIdx = todayAgenda.findIndex((t, i) => i > insertAfterIndex && t._agendaType === 'scheduled');
  if (nextScheduledIdx !== -1) {
    const next = todayAgenda[nextScheduledIdx];
    const [nh, nm] = (next.startTime || '0:0').split(':').map(Number);
    gapMinutes = (nh * 60 + nm) - nowMin;
  } else {
    // No more scheduled tasks — gap is rest of day (cap at a large number)
    gapMinutes = 24 * 60 - nowMin;
  }
  const incompleteInbox = unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample && isVisibleForUser(t));
  const showNudge = gapMinutes >= 60 && incompleteInbox.length > 0;
  return { insertAfterIndex, nowTimeStr, showNudge, inboxCount: incompleteInbox.length, gapMinutes, insideTask };
}
