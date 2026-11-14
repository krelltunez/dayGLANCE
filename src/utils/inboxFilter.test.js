import { describe, it, expect, vi } from 'vitest';
import {
  readInboxFilterPrefs, filterInboxTasks, inboxCountOf, inboxFromStorage,
  liveInboxProjectFilter, liveInboxTagFilter,
  INBOX_SORT_KEY, inboxSortOf,
} from './inboxFilter.js';

// The one Inbox filter (utils/inboxFilter.js). The last block holds the
// launcher's count to the app's own Inbox: the stored-state chain the headless
// refresh runs must give exactly the list useComputedViews gives the app.

vi.mock('react', () => ({ useMemo: (fn) => fn(), useCallback: (fn) => fn }));
const { default: useComputedViews } = await import('../hooks/useComputedViews.js');

function memStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const task = (id, extra = {}) => ({ id, title: id, notes: '', subtasks: [], completed: false, ...extra });
const ids = (list) => list.map((t) => t.id);

describe('readInboxFilterPrefs', () => {
  it('defaults: no priority floor, completed shown, project tasks hidden, no tag or project filter', () => {
    expect(readInboxFilterPrefs(memStorage())).toEqual({
      inboxPriorityFilter: 0, hideCompletedInbox: false, hideProjectTasksInbox: true,
      hideStandaloneTasksInbox: false, inboxTagFilter: [], inboxProjectFilter: [], inboxSort: 'priority',
    });
  });

  it('reads what useLocalStoragePersist writes', () => {
    expect(readInboxFilterPrefs(memStorage({
      inboxPriorityFilter: '2', hideCompletedInbox: 'true', hideProjectTasksInbox: 'false',
      hideStandaloneTasksInbox: 'true', inboxTagFilter: '["work"]', inboxProjectFilter: '["p1"]',
      [INBOX_SORT_KEY]: 'deadline',
    }))).toEqual({
      inboxPriorityFilter: 2, hideCompletedInbox: true, hideProjectTasksInbox: false,
      hideStandaloneTasksInbox: true, inboxTagFilter: ['work'], inboxProjectFilter: ['p1'], inboxSort: 'deadline',
    });
  });

  it('a malformed value falls back to its default rather than throwing', () => {
    const prefs = readInboxFilterPrefs(memStorage({ inboxPriorityFilter: '{', inboxTagFilter: 'not json' }));
    expect(prefs.inboxPriorityFilter).toBe(0);
    expect(prefs.inboxTagFilter).toEqual([]);
  });
});

describe('filterInboxTasks', () => {
  it('drops bucket, archived and other users\' tasks, and project tasks by default', () => {
    const list = [
      task('mine'), task('bucket', { bucketId: 'b1' }), task('archived', { archived: true }),
      task('theirs', { assignedTo: 'them' }), task('project', { projectId: 'p1' }),
    ];
    const out = filterInboxTasks(list, { goalsProjectsEnabled: true, isVisibleForUser: (t) => t.assignedTo !== 'them' });
    expect(ids(out)).toEqual(['mine']);
  });

  it('applies the priority floor, the completed toggle, the tag filter, and sorts open tasks first', () => {
    const list = [
      task('done', { completed: true, priority: 3 }), task('low #work', { priority: 1 }),
      task('high #work', { priority: 3 }), task('home', { priority: 3 }),
    ];
    expect(ids(filterInboxTasks(list, { inboxPriorityFilter: 2 }))).toEqual(['high #work', 'home', 'done']);
    expect(ids(filterInboxTasks(list, { inboxPriorityFilter: 2, hideCompletedInbox: true }))).toEqual(['high #work', 'home']);
    expect(ids(filterInboxTasks(list, { liveTagFilter: ['work'] }))).toEqual(['high #work', 'low #work']);
  });

  it('a completed task with a deadline never counts', () => {
    expect(filterInboxTasks([task('d', { completed: true, deadline: '2026-10-30' })])).toEqual([]);
  });
});

// #2394: the Inbox list by priority (as it always was) or by deadline.
describe('the Inbox sort', () => {
  // Stored order is deliberately neither order.
  const inbox = () => [
    task('low', { priority: 1 }),
    task('later', { priority: 0, deadline: '2027-01-10' }),
    task('high', { priority: 3 }),
    task('soon-low', { priority: 0, deadline: '2026-11-15' }),
    task('done', { completed: true, priority: 3 }),
    task('soon-high', { priority: 2, deadline: '2026-11-15' }),
    task('none', {}),
    task('high-2', { priority: 3 }),
  ];

  it('inboxSortOf: "deadline" or the priority order, whatever else is stored or passed', () => {
    expect(inboxSortOf('deadline')).toBe('deadline');
    for (const other of ['priority', 'title', '', null, undefined, 7, 'Deadline']) expect(inboxSortOf(other), String(other)).toBe('priority');
    expect(readInboxFilterPrefs(memStorage({ [INBOX_SORT_KEY]: 'title' })).inboxSort).toBe('priority');
  });

  it('by priority, the default: highest first, equal priorities in stored order, completed last', () => {
    const expected = ['high', 'high-2', 'soon-high', 'low', 'later', 'soon-low', 'none', 'done'];
    expect(ids(filterInboxTasks(inbox()))).toEqual(expected);
    expect(ids(filterInboxTasks(inbox(), { inboxSort: 'priority' }))).toEqual(expected);
    expect(ids(filterInboxTasks(inbox(), { inboxSort: 'title' }))).toEqual(expected);
  });

  it('by deadline: soonest first, one date by priority; then the undated by priority; completed last', () => {
    expect(ids(filterInboxTasks(inbox(), { inboxSort: 'deadline' })))
      .toEqual(['soon-high', 'soon-low', 'later', 'high', 'high-2', 'low', 'none', 'done']);
  });

  it('an empty or missing deadline is no deadline', () => {
    const list = [task('blank', { deadline: '' }), task('null', { deadline: null }), task('dated', { deadline: '2026-12-01' })];
    expect(ids(filterInboxTasks(list, { inboxSort: 'deadline' }))).toEqual(['dated', 'blank', 'null']);
    // And the three ways of having none are one: priority orders them, whichever way each is stored.
    for (const [low, high] of [[undefined, null], [null, undefined], ['', null], [null, ''], [undefined, '']]) {
      const pair = [task('low', { priority: 0, deadline: low }), task('high', { priority: 3, deadline: high })];
      expect(ids(filterInboxTasks(pair, { inboxSort: 'deadline' })), `${JSON.stringify(low)} / ${JSON.stringify(high)}`).toEqual(['high', 'low']);
    }
  });

  it('decides the order only: the same tasks under both, with every filter still applied', () => {
    const opts = { inboxPriorityFilter: 1, hideCompletedInbox: true };
    const a = filterInboxTasks(inbox(), { ...opts, inboxSort: 'priority' });
    const b = filterInboxTasks(inbox(), { ...opts, inboxSort: 'deadline' });
    expect(ids(a)).toEqual(['high', 'high-2', 'soon-high', 'low']);
    expect(ids(b)).toEqual(['soon-high', 'high', 'high-2', 'low']);
    expect(inboxCountOf(a)).toBe(inboxCountOf(b));
  });

  it('does not mutate the list it is given', () => {
    const list = inbox();
    const before = ids(list);
    filterInboxTasks(list, { inboxSort: 'deadline' });
    expect(ids(list)).toEqual(before);
  });

  it('stored on the device, it reaches the list the stored-state chain builds', () => {
    const storage = memStorage({ [INBOX_SORT_KEY]: 'deadline' });
    expect(ids(inboxFromStorage({ unscheduledTasks: inbox(), storage })).slice(0, 3)).toEqual(['soon-high', 'soon-low', 'later']);
    expect(ids(inboxFromStorage({ unscheduledTasks: inbox(), storage: memStorage() })).slice(0, 3)).toEqual(['high', 'high-2', 'soon-high']);
  });
});

describe('the live filters ignore stale selections', () => {
  it('a deleted project or a vanished tag is dropped; nothing stale keeps the same array', () => {
    const saved = ['p1', 'gone'];
    expect(liveInboxProjectFilter(saved, [{ id: 'p1' }])).toEqual(['p1']);
    const intact = ['p1'];
    expect(liveInboxProjectFilter(intact, [{ id: 'p1' }])).toBe(intact);
    expect(liveInboxTagFilter(['gone'], ['work'])).toEqual([]);
  });
});

describe('inboxCountOf', () => {
  it('counts the filtered Inbox without example tasks', () => {
    expect(inboxCountOf([task('a'), task('b', { isExample: true }), task('c', { completed: true })])).toBe(2);
  });
});

describe("the launcher's count is the app's Inbox", () => {
  const unscheduledTasks = [
    task('open #work', { priority: 2 }), task('open #home', { priority: 0, deadline: '2026-11-15' }),
    task('done', { completed: true }), task('done with deadline', { completed: true, deadline: '2026-10-01' }),
    task('project #work', { projectId: 'p1', priority: 3 }), task('bucket', { bucketId: 'b1' }),
    task('archived', { archived: true }), task('theirs', { assignedTo: 'them' }), task('example', { isExample: true }),
  ];
  const tasks = [task('scheduled #errand', { date: '2026-10-23' })];
  const projects = [{ id: 'p1' }];
  const isVisibleForUser = (t) => t.assignedTo !== 'them';

  const cases = {
    defaults: {},
    'priority 2 and completed hidden': { inboxPriorityFilter: '2', hideCompletedInbox: 'true' },
    'project tasks shown': { hideProjectTasksInbox: 'false' },
    'one project selected': { inboxProjectFilter: '["p1"]' },
    'a tag selected, plus a stale one': { inboxTagFilter: '["work","gone"]' },
    'standalone hidden': { hideStandaloneTasksInbox: 'true', hideProjectTasksInbox: 'false' },
    // Only stale selections: no filter at all, not an empty Inbox (#2137 review).
    'only a stale tag': { inboxTagFilter: '["gone"]' },
    'only a deleted project': { inboxProjectFilter: '["deleted"]' },
    // The sort (#2394) changes the order of both, and the count of neither.
    'sorted by deadline': { [INBOX_SORT_KEY]: 'deadline', hideProjectTasksInbox: 'false' },
  };

  for (const [name, stored] of Object.entries(cases)) {
    it(name, () => {
      const storage = memStorage(stored);
      const prefs = readInboxFilterPrefs(storage);
      const app = useComputedViews({
        tasks, unscheduledTasks, recurringTasks: [], selectedDate: new Date('2026-10-23T12:00:00'), selectedTags: [],
        ...prefs, projects, goalsProjectsEnabled: true, isVisibleForUser,
      }).filteredUnscheduledTasks;
      const headless = inboxFromStorage({ tasks, unscheduledTasks, recurringTasks: [], projects, goalsProjectsEnabled: true, isVisibleForUser, storage });
      expect(ids(headless)).toEqual(ids(app));
      if (name.startsWith('a tag')) expect(ids(headless)).toEqual(['open #work']);
      if (name.startsWith('only')) expect(inboxCountOf(headless)).toBe(3);
      // The one dated task leads, though its priority is the lowest.
      if (name.startsWith('sorted')) expect(ids(app)).toEqual(['open #home', 'project #work', 'open #work', 'example', 'done']);
      expect(inboxCountOf(headless)).toBe(app.filter((t) => !t.isExample).length);
    });
  }

  it('with defaults, the count leaves out everything the Inbox hides', () => {
    const headless = inboxFromStorage({ tasks, unscheduledTasks, recurringTasks: [], projects, goalsProjectsEnabled: true, isVisibleForUser, storage: memStorage() });
    // open #work, open #home and done: not the project, bucket, archived, other user's, example or completed-with-deadline tasks.
    expect(inboxCountOf(headless)).toBe(3);
  });
});
