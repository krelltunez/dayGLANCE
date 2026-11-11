import { describe, expect, it } from 'vitest';
import { buildLinkIndex, canLinkTask, findBacklinks, insertTaskLink, linkCandidates, pickerQueryAt, taskThread } from './taskLinks.js';
import { findTaskLinks, taskLink } from './followUp.js';

// #2145: copy a link to a task, insert one with `@@`, and list who links here.

describe('pickerQueryAt', () => {
  it('opens on @@ and carries what is typed after it', () => {
    expect(pickerQueryAt('see @@', 6)).toEqual({ start: 4, query: '' });
    expect(pickerQueryAt('see @@roof rep', 14)).toEqual({ start: 4, query: 'roof rep' });
  });

  it('reads only up to the caret, so the picker follows the cursor', () => {
    expect(pickerQueryAt('@@roof and more', 6)).toEqual({ start: 0, query: 'roof' });
  });

  it('closes on a new line, a single @, no @@, or a long run', () => {
    expect(pickerQueryAt('@@roof\nnext', 11)).toBeNull();
    expect(pickerQueryAt('mail me @ home', 14)).toBeNull();
    expect(pickerQueryAt('a@@b@c', 6)).toBeNull();
    expect(pickerQueryAt('plain note', 10)).toBeNull();
    expect(pickerQueryAt(`@@${'x'.repeat(61)}`, 63)).toBeNull();
  });
});

describe('insertTaskLink', () => {
  it('replaces @@query with the link and a space, and puts the caret after it', () => {
    const text = 'Waiting on @@roo until Friday';
    const out = insertTaskLink(text, { start: 11, caret: 16 }, { id: 'r1', title: 'Roof repair' }, taskLink);
    expect(out.text).toBe('Waiting on [Roof repair](dayglance://task?id=r1)  until Friday');
    expect(out.text.slice(0, out.caret)).toBe('Waiting on [Roof repair](dayglance://task?id=r1) ');
    expect(findTaskLinks(out.text).map(l => l.id)).toEqual(['r1']);
  });
});

describe('linkCandidates', () => {
  const tasks = [
    { id: 's1', title: 'Roof repair #home', date: '2026-10-20' },
    { id: 's2', title: 'Call the roofer', date: '2026-10-24', completed: true },
    { id: 's3', title: 'Roofing quote', date: '2026-10-22' },
    { id: 'ev', title: 'Roof inspection', date: '2026-10-21', imported: true },
    { id: 'nat', title: 'Roof (calendar)', date: '2026-10-21', _native: true },
  ];
  const unscheduledTasks = [{ id: 'i1', title: 'Ask [[Robin]] about the roof' }, { id: 's1', title: 'dup' }];

  it('offers linkable tasks matching the plain-words title, never calendar events', () => {
    const ids = linkCandidates({ tasks, unscheduledTasks }, 'roof').map(c => c.task.id);
    expect(ids).toEqual(expect.arrayContaining(['s1', 's2', 's3', 'i1']));
    expect(ids).not.toContain('ev');
    expect(ids).not.toContain('nat');
    expect(ids.filter(id => id === 's1')).toHaveLength(1);
  });

  it('puts open before done, then a title that starts with the query, then the latest date', () => {
    const ids = linkCandidates({ tasks, unscheduledTasks }, 'roof').map(c => c.task.id);
    expect(ids).toEqual(['s3', 's1', 'i1', 's2']);
  });

  it('leaves out the task being edited, and shows titles as plain words', () => {
    const out = linkCandidates({ tasks, unscheduledTasks }, 'roof', { excludeId: 's3' });
    expect(out.map(c => c.task.id)).not.toContain('s3');
    expect(out.find(c => c.task.id === 's1').title).toBe('Roof repair');
    expect(out.find(c => c.task.id === 'i1').title).toBe('Ask Robin about the roof');
  });

  it('with nothing typed yet offers the open tasks first, capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` }));
    expect(linkCandidates({ tasks: many }, '')).toHaveLength(8);
  });

  // #2369: the plain title has no tags, so a task was not found by its tag.
  describe('by tag', () => {
    const tagged = [
      { id: 'h1', title: 'Call the roofer #home #urgent', date: '2026-10-20' },
      { id: 'h2', title: 'Fix the gutter #homework', date: '2026-10-22' },
      { id: 'w1', title: 'Write the report #work', date: '2026-10-21' },
      { id: 'n1', title: 'Homework club sign-up', date: '2026-10-19' },
    ];

    it('finds a task by one of its tags, with or without the #', () => {
      expect(linkCandidates({ tasks: tagged }, 'urgent').map(c => c.task.id)).toEqual(['h1']);
      expect(linkCandidates({ tasks: tagged }, '#urgent').map(c => c.task.id)).toEqual(['h1']);
    });

    it('says which tags it was found by, and none when the title matched', () => {
      const out = linkCandidates({ tasks: tagged }, '#home');
      expect(out.find(c => c.task.id === 'h1').tags).toEqual(['home']);
      expect(out.find(c => c.task.id === 'h2').tags).toEqual(['homework']);
      expect(linkCandidates({ tasks: tagged }, 'report')[0].tags).toEqual([]);
    });

    it('a title that matches still matches; a title or a tag that starts with the query ranks alike, then the latest date', () => {
      // "Homework club" by its title, and the two tasks tagged home… by their tags.
      expect(linkCandidates({ tasks: tagged }, 'home').map(c => c.task.id)).toEqual(['h2', 'h1', 'n1']);
    });

    it('with a #, only tags count: a title never holds one', () => {
      expect(linkCandidates({ tasks: tagged }, '#homework').map(c => c.task.id)).toEqual(['h2']);
    });

    it('the link is still labelled with the title, without its tags', () => {
      expect(linkCandidates({ tasks: tagged }, 'urgent')[0].title).toBe('Call the roofer');
    });

    it('a lone # is no query to match tags with: nothing is found by it', () => {
      expect(linkCandidates({ tasks: tagged }, '#')).toEqual([]);
    });
  });
});

describe('findBacklinks', () => {
  const target = { id: 'r 1', title: 'Roof repair' };
  const link = taskLink(target);
  it('lists the tasks whose notes link here, not the task itself or a mere mention', () => {
    const tasks = [
      { id: 'a', title: 'Call roofer', notes: `About ${link}` },
      { id: 'r 1', title: 'Roof repair', notes: `self ${link}` },
      { id: 'b', title: 'Mentions', notes: 'dayglance://task?id=r%201 without brackets' },
      { id: 'c', title: 'Other link', notes: '[x](dayglance://task?id=r%2010)' },
    ];
    const unscheduledTasks = [{ id: 'd', title: 'Follow up: #waitingfor', notes: `Follows up on ${link}, done Oct 20.` }];
    expect(findBacklinks('r 1', { tasks, unscheduledTasks }).map(b => [b.task.id, b.title])).toEqual([['a', 'Call roofer'], ['d', 'Follow up:']]);
  });

  it('finds links to one occurrence of a recurring task by its occurrence id', () => {
    const occurrence = 'recurring-tpl-2026-10-20';
    const tasks = [{ id: 'a', title: 'Notes on that standup', notes: taskLink({ id: occurrence, title: 'Standup' }) }];
    expect(findBacklinks(occurrence, { tasks }).map(b => b.task.id)).toEqual(['a']);
  });

  it('is empty without an id or without links', () => {
    expect(findBacklinks(null, { tasks: [{ id: 'a', notes: link }] })).toEqual([]);
    expect(findBacklinks('zzz', { tasks: [{ id: 'a', notes: link }] })).toEqual([]);
  });
});

describe('canLinkTask', () => {
  it('a task we keep, never a calendar event', () => {
    expect(canLinkTask({ id: 'a' })).toBe(true);
    expect(canLinkTask({ id: 'a', imported: true, isTaskCalendar: true })).toBe(true);
    expect(canLinkTask({ id: 'a', imported: true })).toBe(false);
    expect(canLinkTask({ id: 'a', nativeEventId: 'x' })).toBe(false);
  });
});

describe('taskThread', () => {
  const ref = (id, title = id) => taskLink({ id, title });
  const thread = (id, lists, refs = {}, opts) =>
    taskThread(id, buildLinkIndex(lists), { ...lists, ...refs }, opts);
  const ids = (t) => t.items.map(item => item.id);

  // A follow-up chain, made out of order: each new task links back to the last.
  const chain = {
    tasks: [
      { id: 'quote', title: 'Sent quote request', date: '2026-10-07', completed: true, completedAt: '2026-10-08T09:00:00Z', notes: `After ${ref('call')}` },
      { id: 'call', title: 'Called vendor #home', date: '2026-10-03', completed: true, completedAt: '2026-10-03T15:00:00Z' },
      { id: 'chase', title: 'Follow up on quote', date: '2026-10-27', notes: `Follows up on ${ref('quote')}` },
      { id: 'other', title: 'Unrelated', date: '2026-10-01' },
    ],
    unscheduledTasks: [{ id: 'decide', title: 'Decide on vendor', notes: `See ${ref('chase')}` }],
  };

  it('lists a chain from either end, oldest first, the Inbox last', () => {
    for (const from of ['call', 'chase', 'decide']) {
      expect(ids(thread(from, chain))).toEqual(['call', 'quote', 'chase', 'decide']);
    }
    const t = thread('chase', chain);
    expect(t.items.find(item => item.isSelf).id).toBe('chase');
    expect(t.items.filter(item => item.isSelf)).toHaveLength(1);
    expect(t.items.map(item => item.title)).toEqual(['Called vendor', 'Sent quote request', 'Follow up on quote', 'Decide on vendor']);
    expect(t.open).toBe(2);
    expect(t.more).toBe(0);
  });

  it('dates a finished task by the day it was done', () => {
    expect(thread('call', chain).items.find(item => item.id === 'quote').date).toBe('2026-10-08');
  });

  it('takes in a branch, and a cycle or a self-link ends rather than loops', () => {
    const lists = {
      tasks: [
        { id: 'a', title: 'A', date: '2026-10-01', notes: `${ref('a')} ${ref('b')} ${ref('c')}` },
        { id: 'b', title: 'B', date: '2026-10-02', notes: ref('a') },
        { id: 'c', title: 'C', date: '2026-10-03', notes: `${ref('b')} ${ref('b')}` },
      ],
    };
    expect(ids(thread('b', lists))).toEqual(['a', 'b', 'c']);
  });

  it('is just the task itself without links', () => {
    expect(ids(thread('other', chain))).toEqual(['other']);
    expect(thread(null, chain).items).toEqual([]);
  });

  it('shows a deleted task and follows the links into it', () => {
    const lists = {
      tasks: [
        { id: 'x', title: 'X', date: '2026-10-01', notes: ref('gone-ish') },
        { id: 'y', title: 'Y', date: '2026-10-02', notes: ref('gone-ish') },
      ],
    };
    const recycleBin = [{ id: 'gone-ish', title: 'Binned', date: '2026-09-01', notes: ref('far') }];
    const t = thread('x', lists, { recycleBin });
    expect(ids(t)).toEqual(['x', 'y', 'gone-ish']);
    expect(t.items[2]).toMatchObject({ where: 'deleted', title: 'Binned', date: '' });
    // The deleted task's own notes are not read: 'far' is not in the thread.
    expect(ids(t)).not.toContain('far');
    expect(t.open).toBe(2);
  });

  it('keeps a task that is gone, by the label of the link to it', () => {
    const lists = { tasks: [{ id: 'x', title: 'X', date: '2026-10-01', notes: taskLink({ id: 'lost', title: 'Old roof task' }) }] };
    const t = thread('x', lists);
    expect(t.items[1]).toMatchObject({ id: 'lost', task: null, where: null, title: 'Old roof task', date: '' });
    expect(t.open).toBe(1);
  });

  it('never reads a recurring occurrence\'s notes, so a series does not become one thread', () => {
    const template = { id: 'tpl', title: 'Standup', notes: ref('a'), completedDates: [] };
    const occ1 = 'recurring-tpl-2026-10-20';
    const occ2 = 'recurring-tpl-2026-10-21';
    const lists = {
      tasks: [
        { id: 'a', title: 'A', date: '2026-10-01' },
        { id: 'n1', title: 'Notes on Monday', date: '2026-10-20', notes: ref(occ1) },
        { id: 'n2', title: 'Notes on Tuesday', date: '2026-10-21', notes: ref(occ2) },
        // An occurrence in a list (as a view may hold one) is still not a source.
        { id: occ2, title: 'Standup', date: '2026-10-21', notes: ref('a') },
      ],
    };
    const t = thread('n1', lists, { recurringTasks: [template] });
    expect(ids(t)).toEqual(['n1', occ1]);
    expect(t.items[1]).toMatchObject({ where: 'recurring', title: 'Standup', date: '2026-10-20' });
    expect(ids(thread('a', lists, { recurringTasks: [template] }))).toEqual(['a']);
  });

  it('caps a long thread at the nearest tasks and counts the rest', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, date: `2026-10-${String(30 - i).padStart(2, '0')}`,
      notes: i ? ref(`t${i - 1}`) : '',
    }));
    const t = thread('t0', { tasks }, {}, { limit: 5 });
    expect(ids(t)).toEqual(['t4', 't3', 't2', 't1', 't0']);
    expect(t.more).toBe(7);
  });

  it('agrees with findBacklinks on who links in', () => {
    const lists = { tasks: [...chain.tasks, { id: 'dup', title: 'D', notes: `${ref('quote')} ${ref('quote')}` }], unscheduledTasks: chain.unscheduledTasks };
    const index = buildLinkIndex(lists);
    for (const id of ['call', 'quote', 'chase', 'decide', 'other']) {
      expect(index.in.get(id) || []).toEqual(findBacklinks(id, lists).map(b => String(b.task.id)));
    }
  });
});
