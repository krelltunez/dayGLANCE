import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Resizing a task card by either edge (#2273), through the real handlers.
//
// The top edge moves the start and keeps the end; the bottom edge moves the
// end. Both convert pointer travel at the hour height the view draws with:
// MULTI's measured rows, or the height DAY/JOBO pass. They used a fixed 80px
// per hour, which ran the edge ~2x faster than the pointer on 161px rows.
//
// useDragDrop keeps its state in useState; the react mock below makes that
// state persist across renders (as useDragDrop.dropZones.test.js does), and
// the document mock captures the listeners a resize registers so the test can
// feed pointer positions through them.

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

const nativeUpdateEvent = vi.fn();
vi.mock('../native.js', () => ({
  nativeUpdateEvent: (...args) => nativeUpdateEvent(...args),
  triggerHaptic: () => {},
}));

const docListeners = {};
const savedDocument = globalThis.document;
const savedLocalStorage = globalThis.localStorage;
globalThis.document = {
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
  },
};
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
afterAll(() => {
  globalThis.document = savedDocument;
  globalThis.localStorage = savedLocalStorage;
});

const { default: useDragDrop } = await import('./useDragDrop.js');
const { parseRecurringInstanceId } = await import('../utils/taskMutations.js');

const OVERRIDES = 'day-planner-native-time-overrides';

// A stand-in for MULTI's time grid: hour rows `rowPx` tall, which is what
// getHourHeight measures (the second row's offsetHeight).
const timeGrid = (rowPx) => ({
  current: { children: Array.from({ length: 24 }, (_, i) => ({ offsetHeight: rowPx, offsetTop: i * rowPx })) },
});

function setup({ tasks = [], recurringTasks = [], rowPx = 161, routines = [], frames = [] } = {}) {
  const state = { tasks, recurringTasks, routines, frames };
  const apply = (key) => (v) => { state[key] = typeof v === 'function' ? v(state[key]) : v; };
  const deps = {
    calendarRef: { current: null }, timeGridRef: rowPx ? timeGrid(rowPx) : { current: null },
    setExpandedNotesTaskId: () => {},
    setTasks: apply('tasks'), setRecurringTasks: apply('recurringTasks'),
    setTodayRoutines: apply('routines'), setGtdFrames: apply('frames'),
    gtdFrames: frames,
    pushUndo: vi.fn(), parseRecurringId: parseRecurringInstanceId,
    playUISound: () => {},
  };
  const useRender = () => { cursor = { state: 0, ref: 0 }; return useDragDrop(deps); };
  return { state, deps, render: useRender };
}

const mouseDown = (clientY = 500) => ({ stopPropagation() {}, preventDefault() {}, clientY });
const mouseMove = (clientY) => docListeners.mousemove.at(-1)({ clientY });
const mouseUp = () => docListeners.mouseup.at(-1)();

const task = (over = {}) => ({
  id: 't1', title: 'Write', date: '2026-11-04', startTime: '09:00', duration: 60, ...over,
});

beforeEach(() => {
  stateCells.length = 0; refCells.length = 0;
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  for (const k of Object.keys(store)) delete store[k];
  nativeUpdateEvent.mockReset();
});

describe('top edge', () => {
  it('moves the start and keeps the end', () => {
    const { state, render } = setup({ tasks: [task()] });
    render().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    mouseMove(500 - 161); // one hour up on 161px rows
    mouseUp();
    expect(state.tasks[0]).toMatchObject({ startTime: '08:00', duration: 120 });

    const { state: s2, render: r2 } = setup({ tasks: [task()] });
    r2().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    mouseMove(500 + 80); // half an hour down
    mouseUp();
    expect(s2.tasks[0]).toMatchObject({ startTime: '09:30', duration: 30 });
  });

  it('stops 15 minutes short of the end, and at 00:00', () => {
    const { state, render } = setup({ tasks: [task()] });
    render().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    mouseMove(500 + 2000);
    mouseUp();
    expect(state.tasks[0]).toMatchObject({ startTime: '09:45', duration: 15 });

    const early = task({ startTime: '01:00', duration: 30 });
    const { state: s2, render: r2 } = setup({ tasks: [early] });
    r2().handleResizeStart(early, mouseDown(500), { edge: 'top' });
    mouseMove(500 - 2000);
    mouseUp();
    expect(s2.tasks[0]).toMatchObject({ startTime: '00:00', duration: 90 });
  });

  it('works by touch too (tablet)', () => {
    const { state, render } = setup({ tasks: [task()] });
    render().handleTouchResizeStart(task(), { stopPropagation() {}, touches: [{ clientY: 500 }] }, { edge: 'top' });
    docListeners.touchmove.at(-1)({ preventDefault() {}, touches: [{ clientY: 500 - 161 }] });
    docListeners.touchend.at(-1)();
    expect(state.tasks[0]).toMatchObject({ startTime: '08:00', duration: 120 });
  });

  it('a recurring occurrence takes its new start and length in that date\'s exception', () => {
    const template = {
      id: 'tpl', title: 'Standup', startTime: '09:00', duration: 30,
      exceptions: { '2026-11-04': { title: 'Standup (moved room)' } },
    };
    const occurrence = { ...template, id: 'recurring-tpl-2026-11-04', date: '2026-11-04', isRecurring: true };
    const { state, render } = setup({ recurringTasks: [template] });
    render().handleResizeStart(occurrence, mouseDown(500), { edge: 'top' });
    mouseMove(500 - 80);
    mouseUp();
    expect(state.recurringTasks[0].exceptions['2026-11-04']).toEqual({
      title: 'Standup (moved room)', startTime: '08:30', duration: 60,
    });
    // The template itself keeps its own start.
    expect(state.recurringTasks[0].startTime).toBe('09:00');
  });

  it('pushes one undo step before the write, so undo restores start and length together', () => {
    const { state, deps, render } = setup({ tasks: [task()] });
    let tasksAtUndo;
    deps.pushUndo.mockImplementation(() => { tasksAtUndo = state.tasks; });
    render().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    mouseMove(500 - 161);
    mouseMove(500 - 322);
    mouseUp();
    expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'resized', taskId: 't1' });
    // The snapshot useUndo takes at that moment holds the original block.
    expect(tasksAtUndo[0]).toMatchObject({ startTime: '09:00', duration: 60 });
    expect(state.tasks[0]).toMatchObject({ startTime: '07:00', duration: 180 });
  });
});

describe('bottom edge', () => {
  it('moves the end and writes only the duration', () => {
    const { state, render } = setup({ tasks: [task()] });
    render().handleResizeStart(task(), mouseDown(500));
    mouseMove(500 + 161);
    mouseUp();
    expect(state.tasks[0]).toEqual(task({ duration: 120 }));
  });

  it('a recurring occurrence writes only the duration to its exception', () => {
    const template = { id: 'tpl', title: 'Standup', startTime: '09:00', duration: 30 };
    const occurrence = { ...template, id: 'recurring-tpl-2026-11-04', date: '2026-11-04', isRecurring: true };
    const { state, render } = setup({ recurringTasks: [template] });
    render().handleResizeStart(occurrence, mouseDown(500));
    mouseMove(500 + 80);
    mouseUp();
    expect(state.recurringTasks[0].exceptions['2026-11-04']).toEqual({ duration: 60 });
  });
});

describe('hour height (the 80px bug)', () => {
  it('one measured MULTI row of travel is one hour, not two', () => {
    const { state, render } = setup({ tasks: [task()], rowPx: 161 });
    render().handleResizeStart(task(), mouseDown(500));
    mouseMove(500 + 161);
    mouseUp();
    expect(state.tasks[0].duration).toBe(120); // was 180 at 80px per hour
  });

  it('follows the measured rows when MULTI is zoomed', () => {
    const { state, render } = setup({ tasks: [task()], rowPx: 321 });
    render().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    mouseMove(500 - 321);
    mouseUp();
    expect(state.tasks[0]).toMatchObject({ startTime: '08:00', duration: 120 });
  });

  it('uses the hour height a DAY/JOBO column passes, not the MULTI rows', () => {
    // DAY does not mount MULTI's grid; its columns draw at their own height.
    const { state, render } = setup({ tasks: [task()], rowPx: 0 });
    render().handleResizeStart(task(), mouseDown(500), { hourHeight: 100 });
    mouseMove(500 + 100);
    mouseUp();
    expect(state.tasks[0].duration).toBe(120);

    const { state: s2, render: r2 } = setup({ tasks: [task()], rowPx: 161 });
    r2().handleResizeStart(task(), mouseDown(500), { edge: 'top', hourHeight: 100 });
    mouseMove(500 - 50);
    mouseUp();
    expect(s2.tasks[0]).toMatchObject({ startTime: '08:30', duration: 90 });
  });

  it('a routine resizes at the real hour height too', () => {
    const routine = { id: 'r1', name: 'Walk', startTime: '07:00', duration: 30 };
    const { state, render } = setup({ routines: [routine], rowPx: 161 });
    render().handleRoutineResizeStart(routine, mouseDown(500));
    mouseMove(500 + 161);
    mouseUp();
    expect(state.routines[0].duration).toBe(90);

    const { state: s2, render: r2 } = setup({ routines: [routine], rowPx: 161 });
    r2().handleRoutineResizeStart(routine, mouseDown(500), { hourHeight: 100 });
    mouseMove(500 + 100);
    mouseUp();
    expect(s2.routines[0].duration).toBe(90);
  });

  it('a frame in a DAY column resizes at the column\'s hour height', () => {
    const frame = { id: 'f1', label: 'Deep work', start: '09:00', end: '11:00' };
    const { state, render } = setup({ frames: [frame], rowPx: 0 });
    render().handleFrameResizeStart('f1', '2026-11-04', 'top', mouseDown(500), { hourHeight: 100 });
    mouseMove(500 - 100);
    mouseUp();
    expect(state.frames[0].exceptions['2026-11-04']).toMatchObject({ start: '08:00', end: '11:00' });
  });
});

describe('guide lines', () => {
  it('track the block\'s start and end while resizing, and clear on release', () => {
    const { render } = setup({ tasks: [task()] });
    render().handleResizeStart(task(), mouseDown(500), { edge: 'top' });
    expect(render().resizePreview).toEqual({
      taskId: 't1', dateStr: '2026-11-04', edge: 'top', startMinutes: 540, endMinutes: 600,
    });
    mouseMove(500 - 161);
    expect(render().resizePreview).toMatchObject({ startMinutes: 480, endMinutes: 600 });
    expect(render().isResizing).toBe(true);
    mouseUp();
    expect(render().resizePreview).toBeNull();
    expect(render().isResizing).toBe(false);
  });

  it('a recurring occurrence\'s guides go to its own date', () => {
    const occurrence = { id: 'recurring-tpl-2026-11-06', title: 'Standup', startTime: '09:00', duration: 30, isRecurring: true };
    const { render } = setup({ recurringTasks: [{ id: 'tpl' }] });
    render().handleResizeStart(occurrence, mouseDown(500));
    expect(render().resizePreview).toMatchObject({ dateStr: '2026-11-06', edge: 'bottom', startMinutes: 540, endMinutes: 570 });
    mouseUp();
  });
});

describe('device-calendar events', () => {
  const event = () => task({ id: 'n1', imported: true, nativeEventId: 42, notes: 'n', location: 'here' });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('send the new start and end, and update the time override, after a top-edge resize', async () => {
    store[OVERRIDES] = JSON.stringify({ 42: { startTime: '09:00', duration: 60, date: '2026-11-04' } });
    nativeUpdateEvent.mockResolvedValue({ success: true });
    const { state, render } = setup({ tasks: [event()] });
    render().handleResizeStart(event(), mouseDown(500), { edge: 'top' });
    mouseMove(500 - 80);
    expect(nativeUpdateEvent).not.toHaveBeenCalled(); // only on release
    mouseUp();
    expect(nativeUpdateEvent).toHaveBeenCalledWith({
      id: 42, title: 'Write', start: '2026-11-04T08:30:00', end: '2026-11-04T10:00:00',
      allDay: false, notes: 'n', location: 'here',
    });
    await flush();
    expect(state.tasks[0]).toMatchObject({ startTime: '08:30', duration: 90 });
    expect(JSON.parse(store[OVERRIDES])['42']).toEqual({ startTime: '08:30', duration: 90, date: '2026-11-04' });
  });

  it('roll back both start and duration when the device refuses', async () => {
    nativeUpdateEvent.mockResolvedValue({ success: false });
    const { state, render } = setup({ tasks: [event()] });
    render().handleResizeStart(event(), mouseDown(500), { edge: 'top' });
    mouseMove(500 - 161);
    mouseUp();
    expect(state.tasks[0]).toMatchObject({ startTime: '08:00', duration: 120 });
    await flush();
    expect(state.tasks[0]).toMatchObject({ startTime: '09:00', duration: 60 });
  });

  it('a bottom-edge resize keeps the start it sends', async () => {
    nativeUpdateEvent.mockResolvedValue({ success: true });
    const { render } = setup({ tasks: [event()] });
    render().handleResizeStart(event(), mouseDown(500));
    mouseMove(500 + 80);
    mouseUp();
    expect(nativeUpdateEvent).toHaveBeenCalledWith(expect.objectContaining({
      start: '2026-11-04T09:00:00', end: '2026-11-04T10:30:00',
    }));
  });

  it('a press that does not move writes nothing to the device', () => {
    const { state, render } = setup({ tasks: [event()] });
    render().handleResizeStart(event(), mouseDown(500), { edge: 'top' });
    mouseMove(505);
    mouseUp();
    expect(nativeUpdateEvent).not.toHaveBeenCalled();
    expect(state.tasks[0]).toEqual(event());
  });
});
