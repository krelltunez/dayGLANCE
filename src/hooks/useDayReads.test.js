import { describe, it, expect, vi } from 'vitest';

// The calendar filter is a VIEW preference (#2307), both its parts: a task a
// hidden project or a deselected tag leaves off the calendar still occupies
// its time. App reads a day through useDayReads, and its filters come from
// useComputedViews, so both run here as App runs them; the consumers below
// (scheduling, the nudge, focus, the dial, the snapshots) are fed what App
// feeds them.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal()),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}));

const { default: useDayReads } = await import('./useDayReads.js');
const { default: useComputedViews } = await import('./useComputedViews.js');
const { default: useTaskActions } = await import('./useTaskActions.js');
const { planFrameNudge } = await import('../utils/frameNudge.js');
const { focusBlockAt, focusModeAvailableAt } = await import('../utils/focusBlock.js');
const { computeDialModel } = await import('../utils/dayDial.js');
const { buildProjectedDay } = await import('../utils/widgetDayProjection.js');

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

function useReads({ hiddenProjects = [], selectedTags = ['errand'], dates = [DAY], byDate = tasksByDate } = {}) {
  const { filterForCalendar } = useComputedViews({
    tasks: [], unscheduledTasks: [], recurringTasks: [], selectedDate: at(DAY),
    selectedTags, hiddenProjects,
    inboxPriorityFilter: 0, hideCompletedInbox: false, hideProjectTasksInbox: true, hideStandaloneTasksInbox: false,
    inboxTagFilter: [], inboxProjectFilter: [], projects, goalsProjectsEnabled: true, isVisibleForUser: () => true,
  });
  return useDayReads({ tasksByDate: byDate, filterForCalendar, routineOccupancy: {}, calendarFilterDateStrs: dates });
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

// ── The TAG filter is display-only too ───────────────────────────────────────
// It used to ride getTasksForDate by default, so a deselected tag took its
// tasks out of frames' free time, scheduling, the AI's slots, the snapshots,
// the nudge, focus and the in-app dial, which could then book over time that
// is taken. Each path below is fed the read App feeds it.

const tagged = {
  [PREV]: [row('late-deep', { title: 'Late deploy #deep', date: PREV, startTime: '23:00', duration: 120 })],
  [DAY]: [
    row('deep', { title: 'Deep work #deep', startTime: '10:00', duration: 60 }),
    row('meeting', { startTime: '13:00' }),
  ],
};

describe('a deselected tag leaves the calendar', () => {
  // #deep is not selected, so the calendar leaves "Deep work" out.
  const tagHidden = useReads({ byDate: tagged, selectedTags: ['errand'] });
  const tagShown = useReads({ byDate: tagged, selectedTags: ['deep'] });

  it('is not among the day the calendar shows, and the button counts it', () => {
    expect(ids(tagHidden.getCalendarTasksForDate(at(DAY)))).toEqual(['meeting']);
    expect(tagHidden.calendarHiddenCount).toBe(1);
    expect(ids(tagShown.getCalendarTasksForDate(at(DAY)))).toEqual(['deep', 'meeting']);
  });
});

describe('a task hidden by its tag still occupies its time', () => {
  const tagHidden = useReads({ byDate: tagged, selectedTags: ['errand'] });
  const tagShown = useReads({ byDate: tagged, selectedTags: ['deep'] });

  it('stays in the day the app holds, whatever is passed after the date', () => {
    expect(ids(tagHidden.getTasksForDate(at(DAY)))).toEqual(['deep', 'meeting']);
    // There is no filtered variant of the held day to ask for.
    expect(ids(tagHidden.getTasksForDate(at(DAY), true))).toEqual(['deep', 'meeting']);
    expect(ids(tagHidden.getPrevDayTasks(at(DAY)))).toEqual(['late-deep']);
  });

  it('is busy time in a frame\'s free time (the "N min free" readouts)', () => {
    expect(slots(tagHidden.computeAvailableSlots(frame, at(DAY)))).toEqual(['09:00-10:00', '11:00-13:00', '14:00-17:00']);
    expect(tagHidden.computeAvailableSlots(frame, at(DAY))).toEqual(tagShown.computeAvailableSlots(frame, at(DAY)));
  });

  it('keeps last night\'s tagged task busy past midnight', () => {
    expect(slots(tagHidden.computeAvailableSlots(nightFrame, at(DAY)))).toEqual(['01:00-02:00']);
  });

  it('is not offered to the AI schedulers as a free slot', () => {
    // App's auto-schedule and reschedule list computeAvailableSlots per frame
    // per date as the slot context the model may book into.
    const offered = tagHidden.computeAvailableSlots(frame, at(DAY));
    expect(offered.some((s) => s.start < '11:00' && s.end > '10:00')).toBe(false);
    expect(offered.reduce((sum, s) => sum + s.minutes, 0)).toBe(360);
  });

  it('is not where an Inbox task is scheduled into a frame', () => {
    const writes = [];
    const actions = useTaskActions({
      tasks: [], setTasks: (u) => writes.push(u),
      unscheduledTasks: [{ id: 'inbox', title: 'Write the brief', duration: 60 }],
      setUnscheduledTasks: () => {},
      frameScheduleModal: { frameId: 'f', dateStr: DAY, frame: { start: '10:00', end: '12:00', label: 'Focus', bufferMinutes: 0 } },
      setFrameScheduleModal: () => {},
      computeAvailableSlots: tagHidden.computeAvailableSlots,
      pushUndo: () => '', playUISound: () => {}, setSyncNotification: () => {},
    });
    actions.manuallyScheduleTask('inbox');
    const placed = writes.reduce((acc, u) => u(acc), []);
    expect(placed).toMatchObject([{ id: 'inbox', date: DAY, startTime: '11:00' }]);
  });

  it('counts in the snapshots\' frameAvailableMinutes', () => {
    // App's projected widget and launcher days, and the widget's today, wrap
    // computeAvailableSlots the same way (buildScheduleSections).
    const day = buildProjectedDay({
      date: at(DAY), dateStr: DAY, dateLabel: DAY,
      dayTasks: tagHidden.getTasksForDate(at(DAY)),
      prevDayTasks: tagHidden.getPrevDayTasks(at(DAY)),
      frames: [{ ...frame, label: 'Work', color: 'bg-indigo-200' }],
      frameAvailableMinutes: (f) => tagHidden.computeAvailableSlots(f, at(DAY)).reduce((sum, s) => sum + s.minutes, 0),
    });
    const section = day.sections.find((s) => s.type === 'frame');
    expect(section.availableMinutes).toBe(360);
    expect(section.tasks.map((t) => t.id)).toEqual(['deep', 'meeting']);
  });

  it('is a candidate for the frame nudge once its slot has passed', () => {
    const plan = planFrameNudge({
      nowMin: 12 * 60, frames: [frame], gapMinutes: 60, inboxTasks: [],
      todayTasks: tagHidden.getTasksForDate(at(DAY)),
    });
    expect(plan.status).toBe('ok');
    expect(plan.candidates.map((c) => c.task.id)).toEqual(['deep']);
  });

  it('is in the focus block, and makes focus available', () => {
    const dayTasks = tagHidden.getTasksForDate(at(DAY));
    expect(ids(focusBlockAt(dayTasks, 10 * 60 + 10).tasks)).toEqual(['deep']);
    expect(focusModeAvailableAt(dayTasks, 10 * 60 + 10)).toBe(true);
  });

  it('is on the Day Dial\'s ring and in its totals', () => {
    const dial = (reads) => computeDialModel(reads.getTasksForDate(at(DAY)), null, reads.getPrevDayTasks(at(DAY)));
    const model = dial(tagHidden);
    expect(model.blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['deep', 'meeting', 'late-deep']));
    // The day's own blocks: "Deep work" and the meeting.
    expect(model.effortMinutes + model.restoreMinutes).toBe(60 + 60);
    expect(model).toEqual(dial(tagShown));
  });

  it('keeps the dial\'s frame slots as they were', () => {
    expect(tagHidden.dialFrameSlots(frame, at(DAY))).toEqual(tagShown.dialFrameSlots(frame, at(DAY)));
    expect(slots(tagHidden.dialFrameSlots(frame, at(DAY)))).toEqual(['09:00-10:00', '11:00-13:00', '14:00-17:00']);
  });
});
