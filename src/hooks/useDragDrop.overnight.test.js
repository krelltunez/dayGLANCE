import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { continuationsFromPreviousDay, adjustPastConflicts } from '@glance-apps/agenda-core';

// A task that crosses midnight (#2278), moved and resized from its piece on
// the next date, through the real handlers. The continuation hands the
// handlers its `task`, the real row (or the recurring occurrence, whose id
// names its own date), so each gesture must write exactly what the same
// gesture on the start-day card writes.
//
// Same harness as useDragDrop.resize.test.js: useState persists across
// renders, and the document listeners a resize registers are captured.

const stateCells = [];
const refCells = [];
let cursor = { state: 0, ref: 0 };
vi.mock('react', () => ({
  useEffect: () => {},
  useState: (init) => {
    const i = cursor.state++;
    if (!(i in stateCells)) stateCells[i] = typeof init === 'function' ? init() : init;
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v; }];
  },
  useRef: (init) => {
    const i = cursor.ref++;
    if (!(i in refCells)) refCells[i] = { current: init };
    return refCells[i];
  },
}));
vi.mock('../native.js', () => ({ nativeUpdateEvent: vi.fn(), triggerHaptic: () => {} }));

const docListeners = {};
const savedDocument = globalThis.document;
globalThis.document = {
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
  },
};
afterAll(() => { globalThis.document = savedDocument; });

const { default: useDragDrop } = await import('./useDragDrop.js');
const { parseRecurringInstanceId } = await import('../utils/taskMutations.js');
const { recurringTaskInstance } = await import('../utils/expandRecurringTasks.js');

const TUE = '2026-11-03';
const WED = '2026-11-04';
const ROW = 161; // MULTI's measured hour row

// MULTI's grid: 24 rows of ROW px, the calendar scrolled to the top.
const timeGrid = { current: { offsetTop: 0, children: Array.from({ length: 24 }, (_, i) => ({ offsetHeight: ROW, offsetTop: i * ROW })) } };
const calendar = { current: { getBoundingClientRect: () => ({ top: 0 }), scrollTop: 0 } };
const atTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h + m / 60) * ROW; };

function setup({ tasks = [], recurringTasks = [] } = {}) {
  const state = { tasks, recurringTasks };
  const apply = (key) => (v) => { state[key] = typeof v === 'function' ? v(state[key]) : v; };
  const deps = {
    calendarRef: calendar, timeGridRef: timeGrid,
    selectedDate: new Date(`${WED}T12:00:00`),
    setExpandedNotesTaskId: () => {},
    tasks, setTasks: apply('tasks'), setRecurringTasks: apply('recurringTasks'),
    setUnscheduledTasks: apply('unscheduled'), setRecycleBin: apply('bin'), setTodayRoutines: () => {},
    pushUndo: vi.fn(), parseRecurringId: parseRecurringInstanceId,
    // The app's resolver: only imported events (and routines) are obstacles.
    getAdjustedTimeForImportedConflicts: (taskId, startTime, duration, dateStr) => adjustPastConflicts({}, dateStr, {
      startTime, duration, excludeId: taskId,
      tasks: state.tasks.filter((t) => t.date === dateStr && t.imported),
    }),
    wouldExceedMaxColumns: () => false,
    playUISound: () => {}, setSyncNotification: vi.fn(),
    onboardingProgress: { hasDraggedToTimeline: true }, setOnboardingProgress: () => {},
  };
  const useRender = () => { cursor = { state: 0, ref: 0 }; return useDragDrop(deps); };
  return { state, deps, render: useRender };
}

// The continuation the next date draws, from the previous date's rows.
const continuationOf = (prevDayRows) => {
  const [c] = continuationsFromPreviousDay(prevDayRows);
  expect(c).toBeTruthy();
  return c;
};

const mouseDown = (clientY = 500) => ({ stopPropagation() {}, preventDefault() {}, clientY });
const mouseMove = (clientY) => docListeners.mousemove.at(-1)({ clientY });
const mouseUp = () => docListeners.mouseup.at(-1)();
const dragEvent = (clientY = 0) => ({ preventDefault() {}, clientY, dataTransfer: {}, currentTarget: null, target: null });

const night = (over = {}) => ({ id: 't1', title: 'Night shift', date: TUE, startTime: '23:00', duration: 120, ...over });

beforeEach(() => {
  stateCells.length = 0; refCells.length = 0;
  for (const k of Object.keys(docListeners)) delete docListeners[k];
});

describe('the start-day card stops at 24:00', () => {
  it('calculateTaskPosition clips a task running past midnight at the bottom of the last row', () => {
    const { render } = setup();
    const { top, height } = render().calculateTaskPosition(night());
    expect(top).toBe(23 * ROW);
    expect(top + height).toBeLessThanOrEqual(24 * ROW);
    expect(top + height).toBeGreaterThan(24 * ROW - 3);
  });

  it('a task ending exactly at midnight reaches the same bottom, read from the rows', () => {
    const { render } = setup();
    const { top, height } = render().calculateTaskPosition(night({ duration: 60 }));
    expect(top + height).toBeGreaterThan(24 * ROW - 3);
    expect(top + height).toBeLessThanOrEqual(24 * ROW);
  });

  it('a piece placed from 00:00 for its spill sits at the top of the next date', () => {
    const { render } = setup();
    expect(render().calculateTaskPosition({ startTime: '00:00', duration: 60 })).toEqual({ top: 0, height: ROW - 1 });
  });
});

describe('resizing the continuation\'s bottom edge changes the task\'s end', () => {
  it('one hour down on the next date adds an hour to the duration', () => {
    const { state, deps, render } = setup({ tasks: [night()] });
    const c = continuationOf(state.tasks);
    render().handleResizeStart(c.task, mouseDown(500));
    mouseMove(500 + ROW);
    mouseUp();
    expect(state.tasks[0]).toEqual(night({ duration: 180 }));
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'resized', taskId: 't1' });
  });

  it('at DAY\'s hour height, snapped to 15 minutes', () => {
    const { state, render } = setup({ tasks: [night()] });
    render().handleResizeStart(continuationOf(state.tasks).task, mouseDown(500), { hourHeight: 60 });
    mouseMove(500 - 22); // 22 minutes up, snapped to 15
    mouseUp();
    expect(state.tasks[0].duration).toBe(105);
  });

  it('never makes the task longer than a whole day', () => {
    const { state, render } = setup({ tasks: [night()] });
    render().handleResizeStart(continuationOf(state.tasks).task, mouseDown(0), { hourHeight: 60 });
    mouseMove(30 * 60);
    mouseUp();
    expect(state.tasks[0].duration).toBe(24 * 60);
  });

  it('shows the guides on the date the task started; the next date shifts them (resizePreviewForDate)', () => {
    const { state, render } = setup({ tasks: [night()] });
    render().handleResizeStart(continuationOf(state.tasks).task, mouseDown(500), { hourHeight: 60 });
    mouseMove(560);
    expect(render().resizePreview).toMatchObject({ dateStr: TUE, startMinutes: 23 * 60, endMinutes: 26 * 60 });
    mouseUp();
  });

  it('a recurring occurrence\'s continuation writes that occurrence\'s own date\'s exception', () => {
    const template = { id: 's', title: 'Night shift', startTime: '23:00', duration: 120, recurrence: { type: 'daily', startDate: '2026-11-01' } };
    const { state, render } = setup({ recurringTasks: [template] });
    const c = continuationOf([recurringTaskInstance(template, TUE)]);
    render().handleResizeStart(c.task, mouseDown(500), { hourHeight: 60 });
    mouseMove(530);
    mouseUp();
    expect(state.recurringTasks[0].exceptions).toEqual({ [TUE]: { duration: 150 } });
  });
});

describe('dragging the continuation moves the whole task', () => {
  it('the drop time on the next date is the task\'s new start', () => {
    const { state, deps, render } = setup({ tasks: [night()] });
    const c = continuationOf(state.tasks);
    render().handleDragStart(c.task, 'calendar', dragEvent());
    render().handleDropOnCalendar(dragEvent(), new Date(`${WED}T12:00:00`), '00:30');
    expect(state.tasks[0]).toMatchObject({ id: 't1', date: WED, startTime: '00:30', duration: 120, isAllDay: false });
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'moved', taskId: 't1' });
  });

  it('a drop from the cursor keeps a late start, letting the task run past midnight again', () => {
    const { state, render } = setup({ tasks: [night()] });
    const c = continuationOf(state.tasks);
    render().handleDragStart(c.task, 'calendar', dragEvent());
    // Dropped on Tuesday at 23:30: the start is 23:30, not pulled back to 22:00.
    render().handleDropOnCalendar(dragEvent(atTime('23:30')), new Date(`${TUE}T12:00:00`));
    expect(state.tasks[0]).toMatchObject({ date: TUE, startTime: '23:30', duration: 120 });
  });

  it('the latest start is 23:45', () => {
    const { state, render } = setup({ tasks: [night()] });
    render().handleDragStart(state.tasks[0], 'calendar', dragEvent());
    render().handleDropOnCalendar(dragEvent(atTime('23:59')), new Date(`${TUE}T12:00:00`));
    expect(state.tasks[0].startTime).toBe('23:45');
  });

  it('a recurring occurrence moved to the next date leaves its own date, as the start-day card\'s cross-date drop does', () => {
    const template = { id: 's', title: 'Night shift', startTime: '23:00', duration: 120, recurrence: { type: 'daily', startDate: '2026-11-01' } };
    const { state, render } = setup({ recurringTasks: [template] });
    const c = continuationOf([recurringTaskInstance(template, TUE)]);
    render().handleDragStart(c.task, 'calendar', dragEvent());
    render().handleDropOnCalendar(dragEvent(), new Date(`${WED}T12:00:00`), '01:00');
    expect(state.recurringTasks[0].exceptions[TUE]).toEqual({ deleted: true });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ date: WED, startTime: '01:00', duration: 120, title: 'Night shift' });
    expect(state.tasks[0].id).not.toBe(`recurring-s-${TUE}`);
  });

  it('a drop on the next date slides past an imported event still running from the night before', () => {
    const event = { id: 'ev', title: 'Flight', date: TUE, startTime: '22:00', duration: 240, imported: true };
    const { state, deps, render } = setup({ tasks: [{ id: 'x', title: 'Pack', date: WED, startTime: '09:00', duration: 30 }, event] });
    deps.getAdjustedTimeForImportedConflicts = (taskId, startTime, duration, dateStr) => adjustPastConflicts({}, dateStr, {
      startTime, duration, excludeId: taskId,
      tasks: state.tasks.filter((t) => t.date === dateStr && t.imported),
      prevDayTasks: state.tasks.filter((t) => t.date === TUE && t.imported),
    });
    render().handleDragStart(state.tasks[0], 'calendar', dragEvent());
    render().handleDropOnCalendar(dragEvent(), new Date(`${WED}T12:00:00`), '01:00');
    expect(state.tasks[0]).toMatchObject({ date: WED, startTime: '02:00' });
  });
});

describe('on the phone, the continuation\'s tab drags the whole task from 00:00', () => {
  const savedWindow = globalThis.window;
  const savedStyle = globalThis.getComputedStyle;
  const column = { getBoundingClientRect: () => ({ left: 0, right: 400 }), getAttribute: () => WED };
  const phoneCalendar = {
    current: {
      getBoundingClientRect: () => ({ top: 0, bottom: 5000, left: 0, right: 400 }),
      scrollTop: 0, scrollHeight: 5000, clientHeight: 5000, style: {},
      querySelectorAll: () => [column],
    },
  };
  const touchAt = (clientY) => ({
    touches: [{ clientX: 200, clientY }], changedTouches: [{ clientX: 200, clientY }],
    preventDefault() {}, stopPropagation() {},
    currentTarget: { closest: () => null },
    target: { closest: (sel) => (sel === '[data-drag-handle]' ? {} : null) },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.window = { innerWidth: 400, innerHeight: 5000, getSelection: () => null, addEventListener() {}, removeEventListener() {} };
    globalThis.getComputedStyle = () => ({ fontSize: '16px' });
    globalThis.document.documentElement = {};
    globalThis.document.body = { style: {} };
  });
  afterAll(() => {
    vi.useRealTimers();
    globalThis.window = savedWindow;
    globalThis.getComputedStyle = savedStyle;
  });

  const longPressDrag = (dd, render, task, deltaPx) => {
    dd.handleMobileTaskTouchStart(touchAt(300), task, 'timeline', { anchor: { startTime: '00:00', date: WED } });
    vi.advanceTimersByTime(500);
    render().handleMobileTaskTouchMove(touchAt(300 + deltaPx));
    render().handleMobileTaskTouchEnd(touchAt(300 + deltaPx), task.id, 'timeline');
  };

  it('half an hour down from the piece\'s top starts the task at 00:30 on the next date', () => {
    const { state, deps, render } = setup({ tasks: [night()] });
    deps.calendarRef = phoneCalendar;
    const c = continuationOf(state.tasks);
    longPressDrag(render(), render, c.task, ROW / 2);
    expect(state.tasks[0]).toMatchObject({ id: 't1', date: WED, startTime: '00:30', duration: 120 });
  });

  it('a recurring occurrence\'s piece moves the occurrence off its own date, as the desktop drop does', () => {
    const template = { id: 's', title: 'Night shift', startTime: '23:00', duration: 120, recurrence: { type: 'daily', startDate: '2026-11-01' } };
    const { state, deps, render } = setup({ recurringTasks: [template] });
    deps.calendarRef = phoneCalendar;
    const c = continuationOf([recurringTaskInstance(template, TUE)]);
    longPressDrag(render(), render, c.task, ROW);
    expect(state.recurringTasks[0].exceptions[TUE]).toEqual({ deleted: true });
    expect(state.tasks).toEqual([expect.objectContaining({ date: WED, startTime: '01:00', duration: 120 })]);
  });
});
