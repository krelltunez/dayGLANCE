import { describe, expect, it, vi } from 'vitest';
import { canLinkDo, createDoRecord, linkDoRecord, tombstoneDoRecord } from './core.js';
import { prepareDoLink } from './viewActions.js';
import { CARRY_ACTION, checkEntryAction, makeTaskDraft } from './carryForward.js';
import { createCarryForwardActions } from './carryForwardActions.js';
import { joboUndoEntry, planJoboUndo } from './undo.js';
import { buildJoboDayModel } from './viewModel.js';
import { buildCheckJournal } from '../components/jobo/checkJournal.js';
import useTaskActions from '../hooks/useTaskActions.js';
import { TASK_COLORS } from '../utils/colorUtils.js';

// "Make a task" from an unlinked Do: the one place a Do's taskId changes,
// once, from null to the task made from it. Core decides what may be linked
// (canLinkDo, linkDoRecord), the view action links the version the form was
// opened on, the Check and the Do editor offer it, and the task form's save
// does the link.

const date = '2026-10-09';
const stamp = `${date}T10:00:00.000Z`;
const plan = { date, startTime: '09:00', duration: 60 };
const unlinked = (patch = {}) => createDoRecord({
  id: 'manual:a', taskId: null, title: 'Call the bank #admin', source: 'manual', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '09:40', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...patch,
});
const later = (seconds = 60) => new Date(Date.parse(stamp) + seconds * 1000).toISOString();

describe('core: linkDoRecord', () => {
  it('links an unlinked manual Do once, keeping everything it recorded', () => {
    const record = unlinked();
    const linked = linkDoRecord(record, 'task-1', later());
    expect(linked).toEqual({ ...record, taskId: 'task-1', updatedAt: later() });
    expect(record.taskId).toBeNull();
  });

  it('keeps a captured plan as it was, and a numeric task id as given', () => {
    const linked = linkDoRecord(unlinked({ planSnapshot: plan }), 1712345678901, later());
    expect(linked.planSnapshot).toEqual(plan);
    expect(linked.taskId).toBe(1712345678901);
  });

  // MUTATION: drop any clause of canLinkDo and one of these links.
  it.each([
    ['already linked', { taskId: 't0' }],
    ['completion evidence', { source: 'completion', taskId: 't0', timing: 'untimed', startTime: null, endDate: null, endTime: null, progress: 'completed' }],
    ['a Focus record', { source: 'focus', taskId: 't0' }],
    ['completed work', { progress: 'completed' }],
  ])('refuses %s', (_, patch) => {
    const record = unlinked(patch);
    expect(canLinkDo(record)).toBe(false);
    expect(() => linkDoRecord(record, 'task-1', later())).toThrow(TypeError);
  });

  it('refuses a deleted Do, a missing task id, and a version that is not newer', () => {
    expect(() => linkDoRecord(tombstoneDoRecord(unlinked(), later()), 'task-1', later(120))).toThrow(TypeError);
    expect(() => linkDoRecord(unlinked(), null, later())).toThrow(TypeError);
    expect(() => linkDoRecord(unlinked(), '', later())).toThrow(TypeError);
    expect(() => linkDoRecord(unlinked(), 'task-1', stamp)).toThrow(RangeError);
  });
});

describe('prepareDoLink: the version the form was opened on', () => {
  const now = Date.parse(stamp) + 60_000;
  it('links the current record when it is still that version', () => {
    const record = unlinked();
    expect(prepareDoLink({ records: [record], record: { id: record.id, updatedAt: record.updatedAt }, taskId: 'task-1', now }))
      .toMatchObject({ id: 'manual:a', taskId: 'task-1', updatedAt: new Date(now).toISOString() });
  });

  it('a Do changed, deleted or linked meanwhile is left as it is', () => {
    const opened = unlinked();
    const edited = createDoRecord({ ...opened, endTime: '09:50', updatedAt: later(30) });
    const ref = { id: opened.id, updatedAt: opened.updatedAt };
    expect(prepareDoLink({ records: [edited], record: ref, taskId: 'task-1', now })).toBeNull();
    expect(prepareDoLink({ records: [tombstoneDoRecord(opened, later(30))], record: ref, taskId: 'task-1', now })).toBeNull();
    const linked = linkDoRecord(opened, 'other', later(30));
    expect(prepareDoLink({ records: [linked], record: { id: linked.id, updatedAt: linked.updatedAt }, taskId: 'task-1', now })).toBeNull();
  });
});

describe('the Check offers it on an unlinked Do', () => {
  const entryFor = (records) => buildCheckJournal(buildJoboDayModel({ date, tasks: [], taskLookup: [], records }), date);

  it('Make a task, with the record, for unlinked work not completed', () => {
    const [entry] = entryFor([unlinked()]);
    expect(checkEntryAction(entry, { date, today: date })).toEqual({ kind: CARRY_ACTION.MAKE_TASK, record: unlinked() });
  });

  it('nothing for completed unlinked work', () => {
    const [entry] = entryFor([unlinked({ progress: 'completed' })]);
    expect(checkEntryAction(entry, { date, today: date }).kind).toBe(CARRY_ACTION.NONE);
  });

  it('the carry action is there only while the app offers it', () => {
    expect(createCarryForwardActions({}).makeTask).toBeNull();
    const openMakeTask = vi.fn();
    createCarryForwardActions({ openMakeTask }).makeTask(unlinked());
    expect(openMakeTask).toHaveBeenCalledWith(unlinked());
  });
});

describe('the task form makes the task and links the Do', () => {
  it('the draft: the Do\'s title, tags included, in the Inbox, with the version to link', () => {
    expect(makeTaskDraft(unlinked())).toEqual({
      title: 'Call the bank #admin', openInInbox: true, deadline: null, priority: 0,
      linkDo: { id: 'manual:a', updatedAt: stamp },
    });
  });

  const save = (newTask, toInbox) => {
    const setTasks = vi.fn(), setUnscheduledTasks = vi.fn(), setRecurringTasks = vi.fn();
    const onTaskMadeFromDo = vi.fn();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const actions = useTaskActions({
      tasks: [], setTasks, unscheduledTasks: [], setUnscheduledTasks, recurringTasks: [], setRecurringTasks,
      selectedDate: new Date(`${date}T12:00:00`), newTask, setNewTask: vi.fn(), setShowAddTask: vi.fn(),
      pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(), setSyncNotification: vi.fn(),
      getAdjustedTimeForImportedConflicts: (_id, startTime) => ({ conflicted: false, adjustedStartTime: startTime, conflictingEvent: null }),
      onboardingProgress: { hasAddedScheduledTask: true, hasAddedInboxTask: true, hasUsedTags: true, hasCreatedRecurring: true },
      setOnboardingProgress: vi.fn(), swipeSchedulingInboxTaskId: { current: null },
      colors: TASK_COLORS, getNextQuarterHour: () => '09:00', parseRecurringId: () => null,
      onTaskMadeFromDo,
    });
    actions.addTask(toInbox);
    const stored = (setter) => setter.mock.calls[0]?.[0]([]).at(-1);
    return { onTaskMadeFromDo, inbox: stored(setUnscheduledTasks), scheduled: stored(setTasks), template: stored(setRecurringTasks) };
  };
  const form = { ...makeTaskDraft(unlinked()), startTime: '10:00', duration: 30, date, isAllDay: false, recurrence: null };

  // MUTATION: drop the onTaskMadeFromDo call in addTaskFrom and these fail.
  it('to the Inbox: links the Do to the new id; the link is never stored on the task', () => {
    const { onTaskMadeFromDo, inbox } = save(form, true);
    expect(onTaskMadeFromDo).toHaveBeenCalledWith({ id: 'manual:a', updatedAt: stamp }, inbox.id);
    expect(inbox.title).toBe('Call the bank #admin');
    expect(inbox).not.toHaveProperty('linkDo');
  });

  it('scheduled or recurring instead: links to whatever was made', () => {
    const scheduled = save(form, false);
    expect(scheduled.onTaskMadeFromDo).toHaveBeenCalledWith(expect.anything(), scheduled.scheduled.id);
    const recurring = save({ ...form, recurrence: { type: 'daily', interval: 1 } }, false);
    expect(recurring.onTaskMadeFromDo).toHaveBeenCalledWith(expect.anything(), recurring.template.id);
  });

  it('an ordinary new task links nothing', () => {
    const { onTaskMadeFromDo } = save({ title: 'Plain', startTime: '10:00', duration: 30, date, isAllDay: false }, false);
    expect(onTaskMadeFromDo).not.toHaveBeenCalled();
  });
});

describe('undo', () => {
  it('undoing the link unlinks the Do again, as a newer version', () => {
    const before = unlinked();
    const after = linkDoRecord(before, 'task-1', later());
    const plan = planJoboUndo(joboUndoEntry(before, after), 'undo', [after], Date.parse(later(120)));
    expect(plan.record).toMatchObject({ id: before.id, taskId: null, title: before.title, updatedAt: later(120) });
  });
});
