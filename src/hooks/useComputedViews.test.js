import { describe, it, expect, vi } from 'vitest';

// The hook is pure computation over its arguments; a thin useMemo/useCallback
// shim lets the test call it without a renderer (same approach as
// useDayWindows.test.js's React mock).
vi.mock('react', () => ({
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}));

const { default: useComputedViews } = await import('./useComputedViews.js');

const inboxTask = (id, extra = {}) => ({
  id, title: id, notes: '', subtasks: [], completed: false, ...extra,
});

const baseArgs = (over = {}) => ({
  tasks: [],
  unscheduledTasks: [],
  recurringTasks: [],
  selectedDate: new Date('2026-10-19T12:00:00'),
  selectedTags: [],
  inboxPriorityFilter: 0,
  hideCompletedInbox: false,
  hideProjectTasksInbox: true,
  hideStandaloneTasksInbox: false,
  inboxTagFilter: [],
  inboxProjectFilter: [],
  projects: [],
  goalsProjectsEnabled: true,
  isVisibleForUser: () => true,
  ...over,
});

const ids = (tasks) => tasks.map(task => task.id);

// #2137 review, point 5: a saved filter whose target no longer exists used to
// empty the Inbox while the "filter is active" dot said a filter was on. It is
// ignored at read time instead of pruned from the preference, because tasks and
// tags keep arriving after the first load.
describe('Inbox filters ignore stale selections', () => {
  it('does not hide tasks when the only selected project is gone', () => {
    const view = useComputedViews(baseArgs({
      unscheduledTasks: [inboxTask('u1', { projectId: 'p1' }), inboxTask('u2')],
      projects: [{ id: 'p1' }],
      inboxProjectFilter: ['deleted-project'],
      // The default type toggle (hide project tasks) is a separate preference;
      // turn it off so this asserts exactly that the stale filter stops hiding
      // everything, and the list falls back to the unfiltered default view.
      hideProjectTasksInbox: false,
    }));

    expect(view.liveInboxProjectFilter).toEqual([]);
    expect(ids(view.filteredUnscheduledTasks)).toEqual(['u1', 'u2']);
  });

  it('still applies the selections that do resolve, dropping only the stale ones', () => {
    const view = useComputedViews(baseArgs({
      unscheduledTasks: [inboxTask('u1', { projectId: 'p1' }), inboxTask('u2', { projectId: 'p2' })],
      projects: [{ id: 'p1' }, { id: 'p2' }],
      inboxProjectFilter: ['deleted-project', 'p1'],
    }));

    expect(view.liveInboxProjectFilter).toEqual(['p1']);
    expect(ids(view.filteredUnscheduledTasks)).toEqual(['u1']);
  });

  it('does not hide tasks when the only selected tag no task carries any more', () => {
    const view = useComputedViews(baseArgs({
      unscheduledTasks: [inboxTask('u1', { title: 'call mom' }), inboxTask('u2', { title: 'write #report' })],
      inboxTagFilter: ['renamed-away'],
    }));

    expect(view.liveInboxTagFilter).toEqual([]);
    expect(ids(view.filteredUnscheduledTasks)).toEqual(['u1', 'u2']);
  });

  it('still filters by a tag that exists', () => {
    const view = useComputedViews(baseArgs({
      unscheduledTasks: [inboxTask('u1', { title: 'call mom' }), inboxTask('u2', { title: 'write #report' })],
      inboxTagFilter: ['report'],
    }));

    expect(view.liveInboxTagFilter).toEqual(['report']);
    expect(ids(view.filteredUnscheduledTasks)).toEqual(['u2']);
  });

  it('returns the saved arrays (same identity) when every selection resolves', () => {
    const inboxProjectFilter = ['p1'];
    const inboxTagFilter = ['report'];
    const view = useComputedViews(baseArgs({
      unscheduledTasks: [inboxTask('u1', { projectId: 'p1', title: 'x #report' })],
      projects: [{ id: 'p1' }],
      recurringTasks: [{ id: 'r1', title: 'y #report' }],
      inboxProjectFilter,
      inboxTagFilter,
    }));

    expect(view.liveInboxProjectFilter).toBe(inboxProjectFilter);
    expect(view.liveInboxTagFilter).toBe(inboxTagFilter);
  });
});

// #2143, step 3: allTags and filterableTags come from one pass. These pin the
// rules the two passes had: imported events count for neither; Bucket List
// items count for allTags (autocomplete, AI) but are not offered as filters.
describe('allTags and filterableTags', () => {
  it('one pass keeps both lists\' rules', () => {
    const views = useComputedViews(baseArgs({
      tasks: [inboxTask('Meeting #Work', { date: '2026-10-19' }), inboxTask('Dentist #health', { imported: true })],
      unscheduledTasks: [inboxTask('Paint #home'), inboxTask('Learn piano #someday', { bucketId: 'b1' })],
      recurringTasks: [inboxTask('Water plants #home #garden')],
    }));
    expect(views.allTags).toEqual(['garden', 'home', 'someday', 'work']);
    expect(views.filterableTags).toEqual(['garden', 'home', 'work']);
  });
});

// #2307: the calendar's Hide projects. The rules are utils/calendarFilter.js's;
// these pin how the hook feeds them.
describe('filterForCalendar', () => {
  const day = [
    inboxTask('chore', { projectId: 'household' }),
    inboxTask('loose'),
    inboxTask('later', { projectId: 'shelved' }),
  ];
  const projects = [{ id: 'household' }, { id: 'shelved', status: 'archived' }];

  it('leaves out a hidden project and keeps a task with no project', () => {
    const view = useComputedViews(baseArgs({ projects, hiddenProjects: ['household'] }));
    expect(ids(view.filterForCalendar(day))).toEqual(['loose', 'later']);
    expect([...view.liveHiddenProjects]).toEqual(['household']);
  });

  it('ignores an archived or unknown project without dropping it from the saved list', () => {
    const hiddenProjects = ['shelved', 'gone'];
    const view = useComputedViews(baseArgs({ projects, hiddenProjects }));
    expect(view.filterForCalendar(day)).toBe(day);
    expect(view.liveHiddenProjects.size).toBe(0);
    expect(hiddenProjects).toEqual(['shelved', 'gone']);
  });

  it('hides nothing while Goals & Projects is off', () => {
    const view = useComputedViews(baseArgs({ projects, hiddenProjects: ['household'], goalsProjectsEnabled: false }));
    expect(view.filterForCalendar(day)).toBe(day);
  });

  it('leaves filterByTags as the tag filter alone', () => {
    const view = useComputedViews(baseArgs({ projects, hiddenProjects: ['household'] }));
    expect(ids(view.filterByTags(day))).toEqual(['chore', 'loose', 'later']);
  });
});
