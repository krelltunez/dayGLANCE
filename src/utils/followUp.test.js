import { describe, it, expect } from 'vitest';
import { normalizeFollowUpTag, taskLink, findTaskLinks, doneDateOf, canFollowUp, completionFollowUpDraft, resolveTaskRef, peekNavigationTarget, plainTitle, taskLinksAsLabels, withFollowUpDestination } from './followUp.js';

const projects = [
  { id: 'p1', status: 'active' },
  { id: 'p2', status: 'completed' },
];

describe('normalizeFollowUpTag', () => {
  it('drops the # and spaces, keeps case', () => {
    expect(normalizeFollowUpTag('  #waitingFor ')).toBe('waitingFor');
    expect(normalizeFollowUpTag('##chase')).toBe('chase');
    expect(normalizeFollowUpTag('work/waiting')).toBe('work/waiting');
  });

  it('is no tag for anything a title could not carry as one', () => {
    expect(normalizeFollowUpTag('')).toBe('');
    expect(normalizeFollowUpTag('#')).toBe('');
    expect(normalizeFollowUpTag('waiting for')).toBe('');
    expect(normalizeFollowUpTag('1later')).toBe('');
    expect(normalizeFollowUpTag(null)).toBe('');
  });
});

describe('plainTitle', () => {
  it('keeps a wikilink\'s name and a web link\'s label, drops the tags', () => {
    expect(plainTitle('Contact [[Robin|R.]] re #people [the doc](https://x.y) #Work')).toBe('Contact R. re the doc');
  });
});

describe('taskLink and findTaskLinks', () => {
  it('round-trips an id, labelled with the title as lists show it', () => {
    const link = taskLink({ id: 'a b/c', title: 'Contact [[Robin]] re #people meeting' });
    expect(link).toBe('[Contact Robin re meeting](dayglance://task?id=a%20b%2Fc)');
    expect(findTaskLinks(`Follows up on ${link}, done`)).toEqual([
      { index: 14, length: link.length, label: 'Contact Robin re meeting', id: 'a b/c' },
    ]);
  });

  it('keeps a numeric id as its string', () => {
    expect(findTaskLinks(taskLink({ id: 1712345678901, title: 'Old' }))[0].id).toBe('1712345678901');
  });

  it('never breaks its own brackets, and an untitled task still has a label', () => {
    expect(taskLink({ id: 1, title: 'Fix [x] now' })).toBe('[Fix x now](dayglance://task?id=1)');
    expect(taskLink({ id: 1, title: '#only' })).toBe('[…](dayglance://task?id=1)');
  });

  it('leaves ordinary links and malformed ids alone', () => {
    expect(findTaskLinks('[site](https://example.com) [bad](dayglance://task?id=%E0%A4%A)')).toEqual([]);
  });

  it('finds several in one note', () => {
    const text = `${taskLink({ id: 1, title: 'One' })}\n${taskLink({ id: 2, title: 'Two' })}`;
    expect(findTaskLinks(text).map(link => link.id)).toEqual(['1', '2']);
  });
});

describe('doneDateOf', () => {
  it('reads the local date of the completion stamp', () => {
    expect(doneDateOf({ completedAt: '2026-10-03T23:30:00-05:00' }, '2026-10-04')).toBe('2026-10-03');
  });
  it('a recurring occurrence is done on its own date', () => {
    expect(doneDateOf({ id: 'recurring-tmpl-1-2026-09-28' }, '2026-10-04')).toBe('2026-09-28');
  });
  it('otherwise the fallback', () => {
    expect(doneDateOf({ id: 't1' }, '2026-10-04')).toBe('2026-10-04');
  });
});

describe('canFollowUp', () => {
  it('a task of the app\'s own, a task-calendar item and an occurrence can', () => {
    expect(canFollowUp({ id: 1 })).toBe(true);
    expect(canFollowUp({ id: 'x', imported: true, isTaskCalendar: true })).toBe(true);
    expect(canFollowUp({ id: 'recurring-a-2026-10-04' })).toBe(true);
  });
  it('a calendar event cannot', () => {
    expect(canFollowUp({ id: 'e', imported: true })).toBe(false);
    expect(canFollowUp({ id: 'n', nativeEventId: 'abc' })).toBe(false);
    expect(canFollowUp(null)).toBe(false);
  });
});

describe('completionFollowUpDraft', () => {
  const task = { id: 't1', title: 'Contact [[Robin]] re #people meeting #Work', color: 'bg-rose-500', projectId: 'p1', notes: 'old', subtasks: [{ id: 's' }], deadline: '2026-10-01', priority: 3, startTime: '09:00' };

  it('the prefix and the title, then its tags and the follow-up tag, the prefix selected', () => {
    const draft = completionFollowUpDraft(task, { projects, prefix: 'Follow up:', tag: 'waitingfor', note: 'line' });
    expect(draft.title).toBe('Follow up: Contact [[Robin]] re meeting #people #Work #waitingfor');
    expect(draft.selection).toEqual([0, 'Follow up:'.length]);
    expect(draft.notes).toBe('line');
  });

  it('in the Inbox with no deadline, priority, time, subtasks or old notes', () => {
    const draft = completionFollowUpDraft(task, { projects, prefix: 'Follow up:' });
    expect(draft).toMatchObject({ openInInbox: true, followUp: true, deadline: null, priority: 0, color: 'bg-rose-500', projectId: 'p1' });
    expect(draft).not.toHaveProperty('startTime');
    expect(draft).not.toHaveProperty('subtasks');
    expect(draft).not.toHaveProperty('keepUnscheduled');
    expect(draft.notes).toBe('');
  });

  it('never repeats a tag the task already has, whatever its case', () => {
    expect(completionFollowUpDraft({ id: 1, title: 'Ping Sam #WaitingFor' }, { prefix: 'Follow up:', tag: 'waitingfor' }).title)
      .toBe('Follow up: Ping Sam #WaitingFor');
  });

  it('drops a closed or missing project', () => {
    expect(completionFollowUpDraft({ ...task, projectId: 'p2' }, { projects })).not.toHaveProperty('projectId');
    expect(completionFollowUpDraft({ ...task, projectId: 'gone' }, { projects })).not.toHaveProperty('projectId');
  });

  it('no prefix selects nothing', () => {
    const draft = completionFollowUpDraft({ id: 1, title: 'Ping Sam' }, {});
    expect(draft.title).toBe('Ping Sam');
    expect(draft.selection).toEqual([0, 0]);
  });
});

describe('withFollowUpDestination (#2422)', () => {
  const draft = { title: 'Follow up: Ping Sam', openInInbox: true, followUp: true, deadline: '2026-10-09', priority: 2, date: '2026-10-04', startTime: '09:00' };

  it('to the timeline: scheduled outright, the Inbox fields kept for a switch back', () => {
    expect(withFollowUpDestination(draft, false)).toEqual({ ...draft, openInInbox: false, keepUnscheduled: false });
  });

  it('to the Inbox: no repeat, not all-day', () => {
    const scheduled = { ...draft, openInInbox: false, keepUnscheduled: false, recurrence: { type: 'daily' }, isAllDay: true };
    expect(withFollowUpDestination(scheduled, true)).toEqual({ ...scheduled, openInInbox: true, recurrence: null, isAllDay: false });
  });

  it('the same draft back when it is already there, and switching twice is switching once', () => {
    expect(withFollowUpDestination(draft, true)).toBe(draft);
    const once = withFollowUpDestination(draft, false);
    expect(withFollowUpDestination(once, false)).toBe(once);
    expect(withFollowUpDestination(null, true)).toBeNull();
  });
});

describe('resolveTaskRef', () => {
  const lists = {
    tasks: [{ id: 1712345678901, title: 'Scheduled', date: '2026-10-04' }],
    unscheduledTasks: [{ id: 'in-1', title: 'Inbox' }],
    recurringTasks: [{
      id: 'tmpl-1', title: 'Weekly ping', notes: 'series notes', color: 'bg-blue-500',
      startTime: '09:00', completedDates: ['2026-09-28'],
      exceptions: { '2026-09-28': { title: 'Ping, moved', startTime: '10:00' } },
    }],
    recycleBin: [{ id: 'gone-1', title: 'Deleted' }],
  };

  it('finds a scheduled task by its id as a string', () => {
    expect(resolveTaskRef('1712345678901', lists)).toMatchObject({ where: 'calendar', task: { title: 'Scheduled' } });
  });

  it('finds an Inbox task', () => {
    expect(resolveTaskRef('in-1', lists)).toMatchObject({ where: 'inbox' });
  });

  it('builds a recurring occurrence as that day saw it', () => {
    expect(resolveTaskRef('recurring-tmpl-1-2026-09-28', lists)).toEqual({
      where: 'recurring',
      task: expect.objectContaining({
        id: 'recurring-tmpl-1-2026-09-28', title: 'Ping, moved', notes: 'series notes',
        date: '2026-09-28', startTime: '10:00', completed: true,
      }),
    });
    expect(resolveTaskRef('recurring-tmpl-1-2026-10-05', lists).task.completed).toBe(false);
  });

  it('a deleted task is found in the Recycle Bin', () => {
    expect(resolveTaskRef('gone-1', lists)).toMatchObject({ where: 'deleted' });
  });

  it('null when it is gone for good', () => {
    expect(resolveTaskRef('nope', lists)).toBeNull();
    expect(resolveTaskRef('recurring-missing-2026-10-04', lists)).toBeNull();
    expect(resolveTaskRef('', lists)).toBeNull();
  });
});

// #2231: the peek's "Go to task" goes where search goes (useNavigation
// handleSpotlightSelect), in its shape.
describe('peekNavigationTarget', () => {
  const lists = {
    tasks: [{ id: 's-1', title: 'Scheduled', date: '2026-10-04' }],
    unscheduledTasks: [{ id: 'in-1', title: 'Inbox' }, { id: 'in-2', title: 'Shelved', archived: true }],
    recurringTasks: [{ id: 'tmpl-1', title: 'Weekly ping', startTime: '09:00' }],
    recycleBin: [{ id: 'gone-1', title: 'Deleted' }],
  };
  const target = (id) => peekNavigationTarget(resolveTaskRef(id, lists));

  it('a scheduled task: its day', () => {
    expect(target('s-1')).toMatchObject({ source: 'scheduled', task: { id: 's-1', date: '2026-10-04' } });
  });

  it('an occurrence of a series: that day, by the id its card carries', () => {
    expect(target('recurring-tmpl-1-2026-09-28')).toMatchObject({
      source: 'scheduled', task: { id: 'recurring-tmpl-1-2026-09-28', date: '2026-09-28' },
    });
  });

  it('an Inbox task: its row, in the archive when it is archived', () => {
    expect(target('in-1')).toMatchObject({ source: 'inbox', task: { id: 'in-1' } });
    expect(target('in-2')).toMatchObject({ source: 'archived', task: { id: 'in-2' } });
  });

  it('nowhere for a deleted task, or one that is gone', () => {
    expect(target('gone-1')).toBeNull();
    expect(target('nope')).toBeNull();
    expect(peekNavigationTarget({ where: 'calendar', task: { id: 'x' } })).toBeNull();
  });
});

// A note as it reads: what search looks at.
describe('taskLinksAsLabels', () => {
  it('reads each task link as its label, the rest as typed', () => {
    const text = `Ask about ${taskLink({ id: 'a 1', title: 'Roofing quote' })} and ${taskLink({ id: 'b', title: 'Tiles' })}.`;
    expect(taskLinksAsLabels(text)).toBe('Ask about Roofing quote and Tiles.');
  });
  it('leaves an ordinary link, a bare URL and plain text alone', () => {
    const text = 'See [docs](https://example.com) and https://example.org/task?id=1';
    expect(taskLinksAsLabels(text)).toBe(text);
    expect(taskLinksAsLabels('')).toBe('');
    expect(taskLinksAsLabels(undefined)).toBe('');
  });
});
