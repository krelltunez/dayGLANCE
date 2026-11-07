// Today's agenda, the list GLANCE draws (desktop GlanceSidebar, the phone's
// MobileGlanceSection) and the tray, the Stream Deck and the widget snapshot
// read for what is happening now. Moved out of App.jsx (its `todayAgenda` and
// `agendaNowMarker` memos) when the list learned about the night before
// (#2278); App keeps the memos and the clock.
//
// THE NIGHT BEFORE. A timed task that started yesterday and runs past
// midnight is yesterday's task (agenda-core overnight.js: the start date owns
// it), but at 00:08 it is what is happening. The agenda lists it, first, as a
// CONTINUATION: the task's own row (a copy, like every agenda item, with its
// real date, start and duration, so every action on it acts as on the task)
// tagged `_continuation: { fromDate, minutes }`. Its block on today's clock is
// [00:00, minutes), never its own start: read it with agendaItemSpan, or
// agendaNowAndNext for what runs now and what is next. It stays while it
// runs and leaves when it ends: done, it is a finished item, and unfinished
// it is in the Overdue section (utils/getOverdueTasks.js), listed once, as
// SCHED lists it.
//
// The calendar filter is not applied here: GLANCE applies it to the whole
// list at render, the continuation included, as getContinuationsForDate
// does for the timelines.

import { continuationsFromPreviousDay, nowAndNext, shiftDateStr } from '@glance-apps/agenda-core';
import { notBucketed } from './bucketList.js';

const minutesOf = (time) => {
  const [h, m] = (time || '0:0').split(':').map(Number);
  return h * 60 + m;
};

/**
 * @param {object} input
 * @param {string} input.todayStr   today's YYYY-MM-DD (the wall clock's)
 * @param {number} input.nowMinutes minutes since today's midnight
 * @param {Array} input.tasks @param {Array} input.expandedRecurringTasks
 * @param {Array} input.unscheduledTasks @param {Function} input.isVisibleForUser
 * @returns {Array} deadlines, all-day items, then the timed ones in start
 *   order (the night before's first), each tagged `_agendaType`.
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
    const endMinutes = minutesOf(t.startTime) + (t.duration || 0);
    // Past: hide completed tasks and imported calendar events; keep incomplete user/task-calendar tasks
    if (endMinutes <= nowMinutes) return !t.completed && !(t.imported && !t.isTaskCalendar);
    return true;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  // The night before's tasks still running (see the header): while they run.
  const yesterday = shiftDateStr(today, -1);
  const yesterdayRows = [...tasks, ...expandedRecurringTasks]
    .filter(t => t.date === yesterday && isVisibleForUser(t));
  const continuations = continuationsFromPreviousDay(yesterdayRows)
    .filter(c => c.endMinutes > nowMinutes)
    .map(c => ({ ...c.task, _agendaType: 'scheduled', _continuation: { fromDate: c.fromDate, minutes: c.minutes } }));

  return [
    ...deadlines.map(t => ({ ...t, _agendaType: 'deadline' })),
    ...allDay.map(t => ({ ...t, _agendaType: 'allday' })),
    ...continuations,
    ...scheduled.map(t => ({ ...t, _agendaType: 'scheduled' })),
  ].filter(t => !t.isExample);
}

/**
 * An agenda item's block on today's clock, in minutes: its own start and
 * duration, or [0, minutes) for the night before's continuation.
 * `defaultDuration` stands in for a missing duration.
 */
export function agendaItemSpan(item, { defaultDuration = 0 } = {}) {
  if (item._continuation) return { start: 0, end: item._continuation.minutes };
  const start = minutesOf(item.startTime);
  return { start, end: start + (item.duration || defaultDuration) };
}

/**
 * What runs now and what is next among the agenda's timed items, across
 * midnight: agenda-core's nowAndNext over today's own items (plus
 * `extraDayRows`, e.g. the day's hyperGLANCE sessions) and the night
 * before's continuations, each judged from its own row.
 *
 * @param {Function} [opts.include] which timed items count (e.g. not completed)
 * @returns agenda-core nowAndNext's { blocks, current, next, ahead }; a
 *   block's `task` is the agenda item, its `startTime`/`duration` the block
 *   on today's clock ('00:00' and the piece for a continuation).
 */
export function agendaNowAndNext(agenda, nowMinutes, { include = () => true, extraDayRows = [], defaultDuration = 0 } = {}) {
  const timed = agenda.filter(t => t._agendaType === 'scheduled' && t.startTime && include(t));
  return nowAndNext(
    [...timed.filter(t => !t._continuation), ...extraDayRows],
    timed.filter(t => t._continuation),
    nowMinutes,
    { defaultDuration },
  );
}

/**
 * A block (agendaNowAndNext, agenda-core dayTimedBlocks) as a row on today's
 * clock: the task's fields with the block's `startTime` and `duration`, so the
 * night before's task reads '00:00' for the minutes it runs into today. For a
 * reader that takes start + duration as today's span (the Stream Deck's Task,
 * the widgets' rows), never for an action: act on `block.task`.
 */
export const blockAsTodayRow = (block) => ({ ...block.task, startTime: block.startTime, duration: block.duration });

/**
 * An agenda item as a row on today's clock: itself, or for the night before's
 * continuation the same copy from '00:00' for its minutes (as blockAsTodayRow).
 */
export const agendaItemAsTodayRow = (item) => (item._continuation
  ? { ...item, startTime: '00:00', duration: item._continuation.minutes }
  : item);

/**
 * Where GLANCE's "now" marker goes and the free time it announces ("You have
 * free time at …"): moved verbatim from App.jsx, with each item's block read
 * through agendaItemSpan, so the night before's task running at 00:08 is
 * "in progress" and the free time starts once it ends.
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
      const { start, end } = agendaItemSpan(t);
      if (nowMin >= end) {
        insertAfterIndex = i;
      } else if (nowMin >= start) {
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
    gapMinutes = agendaItemSpan(todayAgenda[nextScheduledIdx]).start - nowMin;
  } else {
    // No more scheduled tasks — gap is rest of day (cap at a large number)
    gapMinutes = 24 * 60 - nowMin;
  }
  const incompleteInbox = unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample && isVisibleForUser(t));
  const showNudge = gapMinutes >= 60 && incompleteInbox.length > 0;
  return { insertAfterIndex, nowTimeStr, showNudge, inboxCount: incompleteInbox.length, gapMinutes, insideTask };
}
