import { describe, expect, it } from 'vitest';
import { CARRY_ACTION, checkEntryAction, followUpDraft, nextCivilDate, remainingMinutes } from './carryForward.js';
import { createDoRecord } from './core.js';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckJournal } from '../components/jobo/checkJournal.js';

// Monday's Check, read on Wednesday.
const date = '2026-09-28';
const today = '2026-09-30';
const plan = { date, startTime: '09:00', duration: 60 };
const base = { ...plan, id: 't1', title: 'Report', color: 'bg-green-500', completed: false };

const session = (patch = {}) => createDoRecord({
  id: 'r1', taskId: 't1', title: 'Report', source: 'manual', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '09:20', planSnapshot: plan,
  createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z`, observedAt: `${date}T10:00:00Z`, ...patch,
});

// The entry exactly as the Check builds it, so measured time is the model's own.
function entryFor({ task = base, records = [session()], day = date, lookup = [task] } = {}) {
  const model = buildJoboDayModel({ date: day, tasks: lookup.filter(row => row.date === day), taskLookup: lookup, records });
  const entries = buildCheckJournal(model, day);
  expect(entries).toHaveLength(1);
  return entries[0];
}
const act = (patch, options = {}) => checkEntryAction(entryFor({ task: { ...base, ...patch }, ...options }), { date: options.day || date, today });

describe('nextCivilDate', () => {
  it.each([
    ['2026-09-30', '2026-10-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
    ['2026-03-28', '2026-03-29'], // a DST weekend in Europe changes nothing
  ])('%s → %s', (from, to) => expect(nextCivilDate(from)).toBe(to));
  it('refuses a date that is not a civil date', () => {
    expect(nextCivilDate('2026-02-30')).toBeNull();
    expect(nextCivilDate(undefined)).toBeNull();
  });
});

describe('remainingMinutes', () => {
  it('is the plan less what was measured, rounded up to 15 minutes', () => {
    expect(remainingMinutes(60, 20)).toBe(45);
    expect(remainingMinutes(60, 30)).toBe(30);
    expect(remainingMinutes(90, 1)).toBe(90);
    expect(remainingMinutes(120, 74)).toBe(60);
  });
  it('never rounds up past the plan', () => {
    expect(remainingMinutes(50, 1)).toBe(50);
    expect(remainingMinutes(10, 5)).toBe(10);
  });
  it('keeps the plan when nothing was measured', () => {
    expect(remainingMinutes(60, null)).toBe(60);
    expect(remainingMinutes(60, undefined)).toBe(60);
    expect(remainingMinutes(60, 0)).toBe(60);
  });
  it('keeps the plan when the work met or ran over it', () => {
    expect(remainingMinutes(60, 60)).toBe(60);
    expect(remainingMinutes(60, 95)).toBe(60);
  });
});

describe('checkEntryAction: Continue', () => {
  it('continues an unfinished task to the day after today, at its start, with what is left', () => {
    const action = act({});
    expect(action.kind).toBe(CARRY_ACTION.CONTINUE);
    expect(action.task.id).toBe('t1');
    // Thursday, not Tuesday: tomorrow is measured from today, not the entry.
    expect(action.slot).toEqual({ date: '2026-10-01', startTime: '09:00', duration: 45, isAllDay: false });
  });
  it('counts measured coverage once, so overlapping sessions are not double counted', () => {
    const records = [session(), session({ id: 'r2', startTime: '09:10', endTime: '09:30', createdAt: `${date}T10:05:00Z`, updatedAt: `${date}T10:05:00Z` })];
    expect(act({}, { records }).slot.duration).toBe(30);
  });
  it('keeps the full plan when the only Do is a completion stamp with no measured time', () => {
    const records = [session({ source: 'completion', timing: 'untimed', startTime: null, endDate: null, endTime: null, createdAt: `${date}T09:30:00Z` })];
    expect(act({}, { records }).slot.duration).toBe(60);
  });
  it('keeps the full plan when a duration was only inferred from the plan', () => {
    const records = [session({ endTime: '10:00', timingBasis: 'planDuration' })];
    expect(act({}, { records }).slot.duration).toBe(60);
  });
  it('keeps the full plan when the work ran over', () => {
    const records = [session({ endTime: '10:30' })];
    expect(act({}, { records }).slot.duration).toBe(60);
  });
  it('is offered on today\'s own Check, for the end-of-day read', () => {
    const task = { ...base, date: today };
    const records = [session({ date: today, endDate: today, planSnapshot: { ...plan, date: today } })];
    const action = checkEntryAction(entryFor({ task, records, day: today }), { date: today, today });
    expect(action.kind).toBe(CARRY_ACTION.CONTINUE);
    expect(action.slot.date).toBe('2026-10-01');
  });
  it('carries an all-day task as all-day, without trimming a duration it does not use', () => {
    const records = [session({ source: 'completion', timing: 'untimed', startTime: null, endDate: null, endTime: null, planSnapshot: null, createdAt: `${date}T09:30:00Z` })];
    const action = act({ isAllDay: true, startTime: '00:00', duration: 30 }, { records });
    expect(action.kind).toBe(CARRY_ACTION.CONTINUE);
    expect(action.slot).toEqual({ date: '2026-10-01', startTime: '00:00', duration: 30, isAllDay: true });
  });
});

describe('checkEntryAction: follow-up', () => {
  it('offers a follow-up for a completed task', () => {
    expect(act({ completed: true }).kind).toBe(CARRY_ACTION.FOLLOW_UP);
  });
  it('decides by the task now, not by the last Do: a Partial session on a finished task', () => {
    const action = act({ completed: true }, { records: [session({ progress: 'partial' })] });
    expect(action.kind).toBe(CARRY_ACTION.FOLLOW_UP);
  });
  it('offers a follow-up for a completed task that was moved, since it is done wherever it sits', () => {
    expect(act({ completed: true, date: '2026-10-02' }).kind).toBe(CARRY_ACTION.FOLLOW_UP);
  });
});

describe('checkEntryAction: the cases Continue does not cover', () => {
  it('a recurring occurrence offers nothing', () => {
    const occurrence = { ...base, id: 'recurring-tpl-2026-09-28', recurringTemplateId: 'tpl', isRecurring: true };
    const records = [session({ taskId: 'recurring-tpl-2026-09-28' })];
    expect(checkEntryAction(entryFor({ task: occurrence, records }), { date, today })).toEqual({ kind: CARRY_ACTION.NONE });
  });
  it('a completed recurring occurrence offers no follow-up either', () => {
    const occurrence = { ...base, id: 'recurring-tpl-2026-09-28', recurringTemplateId: 'tpl', isRecurring: true, completed: true };
    const records = [session({ taskId: 'recurring-tpl-2026-09-28' })];
    expect(checkEntryAction(entryFor({ task: occurrence, records }), { date, today }).kind).toBe(CARRY_ACTION.NONE);
  });
  it.each([
    ['today', today],
    ['tomorrow', '2026-10-01'],
    ['a later day', '2026-10-09'],
    ['another past day', '2026-09-29'],
  ])('a task already moved to %s shows its next slot, with no button', (_, moved) => {
    const action = act({ date: moved, startTime: '14:00' });
    expect(action.kind).toBe(CARRY_ACTION.MOVED);
    expect(action.slot).toEqual({ date: moved, startTime: '14:00', isAllDay: false });
  });
  it('a task on a later day than today is not pulled back to tomorrow, even from its own day', () => {
    const later = '2026-10-02';
    const task = { ...base, date: later };
    const records = [session({ date: later, endDate: later, planSnapshot: { ...plan, date: later } })];
    const action = checkEntryAction(entryFor({ task, records, day: later }), { date: later, today });
    expect(action).toMatchObject({ kind: CARRY_ACTION.MOVED, slot: { date: later } });
  });
  it('an unscheduled task offers Schedule, opened on tomorrow', () => {
    const action = act({ date: null, startTime: null });
    expect(action).toMatchObject({ kind: CARRY_ACTION.SCHEDULE, date: '2026-10-01' });
    expect(action.task.id).toBe('t1');
  });
  it('an unlinked Do offers Make a task, unless it is completed (makeTask.test.js)', () => {
    const records = [session({ taskId: null, planSnapshot: null })];
    expect(checkEntryAction(entryFor({ records, lookup: [] }), { date, today }).kind).toBe(CARRY_ACTION.MAKE_TASK);
    const done = [session({ taskId: null, planSnapshot: null, progress: 'completed' })];
    expect(checkEntryAction(entryFor({ records: done, lookup: [] }), { date, today }).kind).toBe(CARRY_ACTION.NONE);
  });
  it('a task since deleted offers nothing', () => {
    expect(checkEntryAction(entryFor({ lookup: [] }), { date, today }).kind).toBe(CARRY_ACTION.NONE);
  });
  it('a task since archived offers nothing, finished or not', () => {
    expect(act({ archived: true }).kind).toBe(CARRY_ACTION.NONE);
    expect(act({ archived: true, completed: true }).kind).toBe(CARRY_ACTION.NONE);
  });
  it('an imported calendar event offers nothing', () => {
    expect(act({ imported: true }).kind).toBe(CARRY_ACTION.NONE);
  });
  it('a task-calendar task is a task, and continues', () => {
    expect(act({ imported: true, isTaskCalendar: true }).kind).toBe(CARRY_ACTION.CONTINUE);
  });
  it('nothing is offered without a usable today', () => {
    expect(checkEntryAction(entryFor(), { date, today: undefined }).kind).toBe(CARRY_ACTION.NONE);
    expect(checkEntryAction(null, { date, today }).kind).toBe(CARRY_ACTION.NONE);
  });
});

describe('followUpDraft', () => {
  const projects = [
    { id: 'p1', name: 'Launch', goalId: 'g1', status: 'active' },
    { id: 'p2', name: 'Old', status: 'archived' },
    { id: 'p3', name: 'Done', status: 'completed' },
  ];
  const done = {
    ...base, completed: true, projectId: 'p1', priority: 3, notes: 'how it went', deadline: '2026-10-05',
    subtasks: [{ id: 's', title: 'x', completed: true }], title: 'Write #Report for #launch, see #report',
  };

  it('carries the project, the tags and the colour, and starts unscheduled in the project', () => {
    expect(followUpDraft(done, { projects })).toEqual({
      title: ' #Report #launch', cursor: 0, color: 'bg-green-500', projectId: 'p1', keepUnscheduled: true,
    });
  });
  it('carries no time, notes, subtasks, priority or deadline', () => {
    const draft = followUpDraft(done, { projects });
    for (const key of ['date', 'startTime', 'duration', 'isAllDay', 'notes', 'subtasks', 'priority', 'deadline', 'recurrence', 'id']) {
      expect(draft).not.toHaveProperty(key);
    }
  });
  it('starts in the Inbox without a project', () => {
    const { projectId: _, ...loose } = done;
    expect(followUpDraft(loose, { projects })).toEqual({
      title: ' #Report #launch', cursor: 0, color: 'bg-green-500', openInInbox: true, deadline: null, priority: 0,
    });
  });
  it.each([['archived', 'p2'], ['completed', 'p3'], ['gone', 'p9']])('starts in the Inbox when the project is %s', (_, projectId) => {
    const draft = followUpDraft({ ...done, projectId }, { projects });
    expect(draft).not.toHaveProperty('projectId');
    expect(draft.openInInbox).toBe(true);
  });
  it('leaves the title empty when the task had no tags', () => {
    expect(followUpDraft({ ...done, title: 'Plain' }, { projects }).title).toBe('');
  });
  it('does not take a fragment of a web address for a tag', () => {
    expect(followUpDraft({ ...done, title: 'Read https://example.com/guide#setup #docs' }, { projects }).title).toBe(' #docs');
  });
});
