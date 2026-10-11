// What a Check entry offers once the day is read: Continue or Add follow-up
// (docs/jobo-carry-forward.md). Pure: it decides and pre-fills, and the
// panel carries the result out through the app's ordinary task actions.
//
// Nothing here reads or writes the ledger. The entry's own day-model fields
// (its resolved task, its group's measured coverage) are all it needs.
import { tagsIn } from '../utils/taskUtils.js';
import { validCivilDate } from './viewDates.js';
import { canLinkDo } from './core.js';

export const CARRY_ACTION = Object.freeze({
  CONTINUE: 'continue',
  FOLLOW_UP: 'followUp',
  MOVED: 'moved',
  SCHEDULE: 'schedule',
  MAKE_TASK: 'makeTask',
  NONE: 'none',
});

const SLOT_MINUTES = 15;
const NONE = Object.freeze({ kind: CARRY_ACTION.NONE });

/** The civil day after `date`, without a time zone or DST to cross. */
export function nextCivilDate(date) {
  if (!validCivilDate(date)) return null;
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
}

/**
 * What is left of a plan once `recordedMinutes` of it were measured, rounded
 * up to the 15 minutes every view snaps to. Unmeasured work and work that
 * already ran over keep the full plan: neither says how much is left.
 */
export function remainingMinutes(plannedMinutes, recordedMinutes) {
  if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0) return plannedMinutes;
  if (!Number.isFinite(recordedMinutes) || recordedMinutes <= 0 || recordedMinutes >= plannedMinutes) return plannedMinutes;
  // Rounding up never hands back more than was planned.
  return Math.min(plannedMinutes, Math.ceil((plannedMinutes - recordedMinutes) / SLOT_MINUTES) * SLOT_MINUTES);
}

// Moving one occurrence is a series exception, not a continuation, and the
// next occurrence carries the work on anyway.
const recurring = task => task.recurringTemplateId != null || task.isRecurring === true
  || task.isRecurringSeries === true || task.isJoboSyntheticOccurrence === true
  || (typeof task.id === 'string' && task.id.startsWith('recurring-'));

const calendarEvent = task => task.imported === true && !task.isTaskCalendar;

const scheduled = task => validCivilDate(task.date) && (task.isAllDay === true || typeof task.startTime === 'string' && task.startTime !== '');

const slotOf = task => ({ date: task.date, startTime: task.startTime, isAllDay: task.isAllDay === true });

/**
 * The one action a Check entry offers, picked by the state of its task now.
 *
 * `date` is the day the Check reads; `today` is the device's civil today.
 * Continue lands on the day after TODAY, not after the entry's date: a Monday
 * reviewed on Wednesday continues on Thursday.
 */
export function checkEntryAction(entry, { date, today } = {}) {
  const task = entry?.sourceTask;
  // Unlinked work can become a task of its own ("Make a task"): one manual
  // Do, not completed (core's canLinkDo). An unlinked record is its own
  // execution, so the entry holds just that one.
  if (!task) {
    const record = entry?.sessions?.length === 1 ? entry.sessions[0] : null;
    return canLinkDo(record) ? { kind: CARRY_ACTION.MAKE_TASK, record } : NONE;
  }
  // Deleted and archived work offers nothing for now.
  if (task.id == null || task.archived) return NONE;
  if (recurring(task) || calendarEvent(task)) return NONE;
  // A finished task is grown from, never continued, whatever its last Do said.
  if (task.completed === true) return { kind: CARRY_ACTION.FOLLOW_UP, task };
  const tomorrow = nextCivilDate(today);
  if (!tomorrow) return NONE;
  // No planned time to carry: the editor picks one, opened on tomorrow.
  if (!scheduled(task)) return { kind: CARRY_ACTION.SCHEDULE, task, date: tomorrow };
  // Moved off this day already, by hand or from another device. Only the day
  // the task sits on offers Continue, so its remaining time is that day's.
  if (task.date !== date || task.date > today) return { kind: CARRY_ACTION.MOVED, task, slot: slotOf(task) };
  const duration = task.isAllDay
    ? task.duration
    : remainingMinutes(Number(task.duration), entry.comparisonMeta?.measured?.recordedMinutes);
  return {
    kind: CARRY_ACTION.CONTINUE,
    task,
    slot: { date: tomorrow, startTime: task.startTime, duration, isAllDay: task.isAllDay === true },
  };
}

const openProject = (projects, id) => (Array.isArray(projects) ? projects : []).find(project => (
  project && String(project.id) === String(id) && project.status !== 'archived' && project.status !== 'completed'
));

/**
 * The new-task form's pre-fill for a follow-up to `task`: its project (and so
 * its goal), its tags and its colour. Never its time, notes, subtasks or
 * priority, which belong to the finished work.
 *
 * The tags sit after the cursor, so what the user types goes before them. The
 * follow-up starts unscheduled: in its project's list, or in the Inbox when
 * the project is gone or closed. The form can still give it a day.
 */
export function followUpDraft(task, { projects = [] } = {}) {
  const seen = new Set();
  const tags = tagsIn(task?.title).filter(tag => !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()));
  const project = task?.projectId != null ? openProject(projects, task.projectId) : null;
  return {
    title: tags.length ? ` ${tags.map(tag => `#${tag}`).join(' ')}` : '',
    cursor: 0,
    ...(typeof task?.color === 'string' && task.color ? { color: task.color } : {}),
    ...(project
      ? { projectId: project.id, keepUnscheduled: true }
      : { openInInbox: true, deadline: null, priority: 0 }),
  };
}

/**
 * The new-task form for "Make a task" from an unlinked Do: its title, tags
 * included, in the Inbox, carrying the Do it came from. The save links that
 * Do to the new task (useTaskActions → prepareDoLink) as the version the form
 * was opened on, so a Do changed meanwhile, here or on another device, is
 * left as it is. `linkDo` is read by the save and never stored on the task.
 */
export function makeTaskDraft(record) {
  return {
    title: typeof record?.title === 'string' ? record.title : '',
    openInInbox: true, deadline: null, priority: 0,
    linkDo: { id: record.id, updatedAt: record.updatedAt },
  };
}

// ── Tasks not started (the addendum in docs/jobo-carry-forward.md) ─────────

const dayMinute = (time) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * What a task in the Not started group offers. Nothing for a recurring
 * occurrence, which the next one carries on. Otherwise Continue to the day
 * after today with its full duration, since nothing was recorded, and, for a
 * task of the app's own, moving it off the timeline or deleting it. A
 * task-calendar item belongs to its calendar, which a move or a delete here
 * would not reach, so it only continues.
 */
export function notStartedAction(task, { today } = {}) {
  if (!task || task.id == null || recurring(task)) return NONE;
  const tomorrow = nextCivilDate(today);
  if (!tomorrow) return NONE;
  const own = !task.imported;
  return {
    kind: CARRY_ACTION.CONTINUE,
    task,
    slot: { date: tomorrow, startTime: task.startTime, duration: task.duration, isAllDay: task.isAllDay === true },
    ...(own ? { unschedule: task.projectId != null ? 'project' : 'inbox', remove: true } : {}),
  };
}

/**
 * The day's planned tasks that were never started: no Do recorded, not
 * completed, still on `date`. Read from the day's plan, never from the
 * ledger, so no Do record is made for them.
 *
 * A timed task counts once its plan has fully ended with nothing recorded,
 * the day model's own rule (`comparison.notStarted`), so today's Check skips
 * work still to come or under way. An all-day task has no planned end, so it
 * counts on past days only; `dayTasks` supplies them. A task that appears in
 * the journal (`entries`) has a Do, under whatever plan, and is not listed.
 */
export function notStartedTasks(model, { date, today, entries = [], dayTasks = [] } = {}) {
  if (!model || !validCivilDate(date)) return [];
  const withDo = new Set(entries.map(entry => entry?.sourceTask?.id).filter(id => id != null).map(String));
  const eligible = task => task && task.id != null && task.date === date && !task.completed
    && !task.archived && !calendarEvent(task) && !withDo.has(String(task.id));
  const found = new Map();
  for (const item of model.plans || []) {
    const task = item.currentTask;
    if (!eligible(task) || item.comparison?.notStarted !== true) continue;
    found.set(String(task.id), { task, allDay: false, startMinute: dayMinute(task.startTime) });
  }
  if (validCivilDate(today) && date < today) {
    for (const task of dayTasks || []) {
      if (!eligible(task) || task.isAllDay !== true || found.has(String(task.id))) continue;
      found.set(String(task.id), { task, allDay: true, startMinute: -1 });
    }
  }
  return [...found.values()]
    .sort((a, b) => a.startMinute - b.startMinute || String(a.task.title).localeCompare(String(b.task.title)) || (String(a.task.id) < String(b.task.id) ? -1 : 1))
    .map(item => ({ ...item, id: String(item.task.id), recurring: recurring(item.task), action: notStartedAction(item.task, { today }) }));
}

/**
 * The Check's summary: how many tasks from the day still need a next step.
 * A task needs one while it is unfinished and still sits on the day: a
 * journal entry that still offers Continue, or a task in Not started.
 * Recurring occurrences never count. Null on a day with no plan and no Do,
 * where there is nothing to say. Worked out from the tasks as they stand.
 */
export function nextStepSummary(model, { date, today, entries = [], notStarted = [] } = {}) {
  const pending = new Set();
  for (const entry of entries) {
    if (checkEntryAction(entry, { date, today }).kind === CARRY_ACTION.CONTINUE) pending.add(String(entry.sourceTask.id));
  }
  for (const item of notStarted) if (!item.recurring) pending.add(item.id);
  const planned = (model?.plans || []).some(item => item.currentTask && !calendarEvent(item.currentTask));
  if (!entries.length && !notStarted.length && !planned) return null;
  return { pending: pending.size };
}
