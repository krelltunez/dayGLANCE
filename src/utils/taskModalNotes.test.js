import { describe, it, expect } from 'vitest';
import { applyDraftEdit, hasNotesContent, modalNotesTarget } from './taskModalNotes.js';

const inboxTask = { id: 'i1', title: 'Inbox task', notes: 'inbox note', subtasks: [] };
const scheduled = { id: 's1', title: 'Scheduled', date: '2026-10-02', notes: '', subtasks: [] };
const event = { id: 'ev', title: 'Standup', imported: true };
const template = { id: 'tmpl-1', title: 'Daily review', notes: 'series note', subtasks: [{ id: 'a', title: 'A', completed: false }] };
const lists = { tasks: [scheduled, event], unscheduledTasks: [inboxTask], recurringTasks: [template] };

describe('modalNotesTarget', () => {
  it('is a draft for a new task', () => {
    expect(modalNotesTarget({ editingTask: null, ...lists })).toEqual({ kind: 'draft' });
  });

  it('is the live task when editing, from whichever list holds it', () => {
    expect(modalNotesTarget({ editingTask: { id: 'i1' }, ...lists })).toEqual({ kind: 'live', task: inboxTask, isInbox: true });
    expect(modalNotesTarget({ editingTask: { id: 's1' }, ...lists })).toEqual({ kind: 'live', task: scheduled, isInbox: false });
  });

  // MUTATION: drop schedulingId and a swiped Inbox task shows an empty draft
  // while its own notes sit unseen, then are left behind on Add.
  it('is the Inbox task being scheduled from a swipe, not a draft', () => {
    expect(modalNotesTarget({ editingTask: null, schedulingId: 'i1', ...lists })).toEqual({ kind: 'live', task: inboxTask, isInbox: true });
  });

  it('is an occurrence with its series\' notes and subtasks', () => {
    const occurrence = { id: 'recurring-tmpl-1-2026-10-02', title: 'Daily review' };
    const target = modalNotesTarget({ editingTask: occurrence, ...lists });
    expect(target.kind).toBe('live');
    expect(target.task).toMatchObject({ id: occurrence.id, notes: 'series note', subtasks: template.subtasks });
  });

  it('is nothing for a calendar event, an unknown series or a task not found', () => {
    expect(modalNotesTarget({ editingTask: { id: 'ev' }, ...lists })).toBe(null);
    expect(modalNotesTarget({ editingTask: { id: 'recurring-gone-2026-10-02' }, ...lists })).toBe(null);
    expect(modalNotesTarget({ editingTask: { id: 'nope' }, ...lists })).toBe(null);
  });

  it('an occurrence\'s subtasks carry that date\'s ticks, not another day\'s', () => {
    const ticked = { ...template, subtaskCompletions: { '2026-10-02': ['a'] } };
    const withTicks = { ...lists, recurringTasks: [ticked] };
    expect(modalNotesTarget({ editingTask: { id: 'recurring-tmpl-1-2026-10-02' }, ...withTicks }).task.subtasks)
      .toEqual([{ id: 'a', title: 'A', completed: true }]);
    expect(modalNotesTarget({ editingTask: { id: 'recurring-tmpl-1-2026-10-03' }, ...withTicks }).task.subtasks)
      .toEqual([{ id: 'a', title: 'A', completed: false }]);
  });
});

describe('applyDraftEdit', () => {
  const draft = { title: 'New', notesDraftKey: 'k' };

  it('writes notes and each subtask edit to the draft', () => {
    let next = applyDraftEdit(draft, 'k', { type: 'notes', notes: 'hello' });
    next = applyDraftEdit(next, 'k', { type: 'addSubtask', subtask: { id: 'a', title: 'A', completed: false } });
    next = applyDraftEdit(next, 'k', { type: 'addSubtask', subtask: { id: 'b', title: 'B', completed: false } });
    next = applyDraftEdit(next, 'k', { type: 'toggleSubtask', id: 'a' });
    next = applyDraftEdit(next, 'k', { type: 'renameSubtask', id: 'b', title: 'Bee' });
    next = applyDraftEdit(next, 'k', { type: 'deleteSubtask', id: 'a' });
    expect(next).toEqual({ title: 'New', notesDraftKey: 'k', notes: 'hello', subtasks: [{ id: 'b', title: 'Bee', completed: false }] });
  });

  // MUTATION: skip the key check and text the panel saves as it closes,
  // after Add reset the form, turns up in the next new task.
  it('leaves a form that is not this draft\'s alone', () => {
    const reset = { title: '', startTime: '09:00' };
    expect(applyDraftEdit(reset, 'k', { type: 'notes', notes: 'late' })).toBe(reset);
    expect(applyDraftEdit({ ...draft, notesDraftKey: 'other' }, 'k', { type: 'notes', notes: 'x' }).notes).toBeUndefined();
  });
});

describe('hasNotesContent', () => {
  it('is notes with text, or any subtask', () => {
    expect(hasNotesContent({ notes: '  ', subtasks: [] })).toBe(false);
    expect(hasNotesContent({ notes: 'x' })).toBe(true);
    expect(hasNotesContent({ subtasks: [{ id: 'a' }] })).toBe(true);
    expect(hasNotesContent(null)).toBe(false);
  });
});
