import { describe, it, expect, vi } from 'vitest';

// A hidden project is a VIEW preference (#2307): its tasks leave the calendar
// and still occupy their time. App reads a day through useDayReads, and its
// filters come from useComputedViews, so both run here as App runs them.
vi.mock('react', () => ({
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}));

const { default: useDayReads } = await import('./useDayReads.js');
const { default: useComputedViews } = await import('./useComputedViews.js');

const DAY = '2030-01-07';
const PREV = '2030-01-06';
const at = (dateStr) => new Date(`${dateStr}T12:00:00`);
const row = (id, extra = {}) => ({ id, title: id, date: DAY, startTime: '10:00', duration: 60, ...extra });

const tasksByDate = {
  [PREV]: [row('late-chore', { date: PREV, startTime: '23:00', duration: 120, projectId: 'household' })],
  [DAY]: [
    row('chore', { projectId: 'household' }),
    row('meeting', { startTime: '13:00' }),
    row('errand', { title: 'errand #errand', isAllDay: true, startTime: null }),
  ],
};
const projects = [{ id: 'household', title: 'Household' }, { id: 'work', title: 'Work' }];

function useReads({ hiddenProjects = [], selectedTags = ['errand'], dates = [DAY] } = {}) {
  const { filterByTags, filterForCalendar } = useComputedViews({
    tasks: [], unscheduledTasks: [], recurringTasks: [], selectedDate: at(DAY),
    selectedTags, hiddenProjects,
    inboxPriorityFilter: 0, hideCompletedInbox: false, hideProjectTasksInbox: true, hideStandaloneTasksInbox: false,
    inboxTagFilter: [], inboxProjectFilter: [], projects, goalsProjectsEnabled: true, isVisibleForUser: () => true,
  });
  return useDayReads({ tasksByDate, filterByTags, filterForCalendar, routineOccupancy: {}, calendarFilterDateStrs: dates });
}

const ids = (list) => list.map((t) => t.id);
const slots = (list) => list.map((s) => `${s.start}-${s.end}`);
const frame = { frameId: 'f', date: DAY, start: '09:00', end: '17:00' };
const nightFrame = { frameId: 'n', date: DAY, start: '00:00', end: '02:00' };

describe('a hidden project leaves the calendar', () => {
  it('is not among the day the calendar shows', () => {
    expect(ids(useReads({ hiddenProjects: ['household'] }).getCalendarTasksForDate(at(DAY))))
      .toEqual(['meeting', 'errand']);
  });

  it('shows again once unhidden', () => {
    expect(ids(useReads().getCalendarTasksForDate(at(DAY)))).toEqual(['chore', 'meeting', 'errand']);
  });
});

describe('a hidden task still occupies its time', () => {
  const hidden = useReads({ hiddenProjects: ['household'] });
  const shown = useReads();

  it('stays in the day the app schedules against', () => {
    expect(ids(hidden.getTasksForDate(at(DAY)))).toContain('chore');
    expect(ids(hidden.getTasksForDate(at(DAY), false))).toContain('chore');
    expect(ids(hidden.getPrevDayTasks(at(DAY)))).toContain('late-chore');
  });

  it('keeps a frame\'s free time as it was: the hidden task is busy time', () => {
    expect(slots(hidden.computeAvailableSlots(frame, at(DAY)))).toEqual(['09:00-10:00', '11:00-13:00', '14:00-17:00']);
    expect(hidden.computeAvailableSlots(frame, at(DAY))).toEqual(shown.computeAvailableSlots(frame, at(DAY)));
  });

  it('keeps last night\'s hidden task busy past midnight', () => {
    expect(slots(hidden.computeAvailableSlots(nightFrame, at(DAY)))).toEqual(['01:00-02:00']);
  });

  it('keeps the dial\'s frame slots as they were', () => {
    expect(hidden.dialFrameSlots(frame, at(DAY))).toEqual(shown.dialFrameSlots(frame, at(DAY)));
    expect(slots(hidden.dialFrameSlots(frame, at(DAY)))).toEqual(['09:00-10:00', '11:00-13:00', '14:00-17:00']);
  });
});

describe('the count on the filter button', () => {
  it('counts what the tags and the hidden projects leave out, together', () => {
    // The errand is left out by its tag, the chore by its project.
    expect(useReads({ hiddenProjects: ['household'], selectedTags: [] }).calendarHiddenCount).toBe(2);
    expect(useReads({ hiddenProjects: ['household'] }).calendarHiddenCount).toBe(1);
    expect(useReads({ selectedTags: [] }).calendarHiddenCount).toBe(1);
  });

  it('is zero when nothing is left out, and counts only the dates on screen', () => {
    expect(useReads().calendarHiddenCount).toBe(0);
    expect(useReads({ hiddenProjects: ['household'], dates: [] }).calendarHiddenCount).toBe(0);
    expect(useReads({ hiddenProjects: ['household'], dates: [PREV, DAY] }).calendarHiddenCount).toBe(2);
  });

  it('ignores a stale id', () => {
    expect(useReads({ hiddenProjects: ['gone'] }).calendarHiddenCount).toBe(0);
  });
});
