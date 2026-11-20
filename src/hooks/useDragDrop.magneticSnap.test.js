import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { adjustPastConflicts } from '@glance-apps/agenda-core';

// Magnetic snapping (#2430) through the real drag handlers: a block dropped
// near another block's start or end on the same date lands on it, and keeps
// the 15-minute grid anywhere else.
//
// Same harness as useDragDrop.overnight.test.js.

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

const TUE = '2026-11-03';
const WED = '2026-11-04';
const ROW = 161; // MULTI's measured hour row

// MULTI's grid: 24 rows of ROW px, the calendar scrolled to the top.
const timeGrid = { current: { offsetTop: 0, children: Array.from({ length: 24 }, (_, i) => ({ offsetHeight: ROW, offsetTop: i * ROW })) } };
const calendar = { current: { getBoundingClientRect: () => ({ top: 0 }), scrollTop: 0 } };
const atTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h + m / 60) * ROW; };

function setup({ tasks = [], recurringTasks = [], withEdges = true } = {}) {
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
    // The day as it holds it, as App's getTasksForDate answers.
    getTasksForDate: withEdges
      ? (date) => state.tasks.filter((t) => t.date === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
      : undefined,
  };
  const useRender = () => { cursor = { state: 0, ref: 0 }; return useDragDrop(deps); };
  return { state, deps, render: useRender };
}

const dragEvent = (clientY = 0) => ({ preventDefault() {}, clientY, dataTransfer: {}, currentTarget: null, target: null });

const ON_TUE = new Date(`${TUE}T12:00:00`);
// 09:00 to 10:07: its end is off the grid, which is the case the issue names.
const before = { id: 'a', title: 'Before', date: TUE, startTime: '09:00', duration: 67 };
const mover = { id: 'm', title: 'Mover', date: TUE, startTime: '14:00', duration: 30 };

beforeEach(() => {
  stateCells.length = 0; refCells.length = 0;
  for (const k of Object.keys(docListeners)) delete docListeners[k];
});

const drop = (opts, hhmm, date = ON_TUE) => {
  const { state, render } = setup(opts);
  render().handleDragStart(state.tasks.find((t) => t.id === 'm'), 'calendar', dragEvent());
  render().handleDropOnCalendar(dragEvent(atTime(hhmm)), date);
  return state.tasks.find((t) => t.id === 'm');
};

describe('dropping a block near another block\'s edge', () => {
  it('lands its start on the end of the block before', () => {
    expect(drop({ tasks: [before, mover] }, '10:04').startTime).toBe('10:07');
  });

  it('lands its end on the start of the block after', () => {
    // 08:33 + 30 minutes ends at 09:03, three minutes past the block at 09:00.
    expect(drop({ tasks: [before, mover] }, '08:33').startTime).toBe('08:30');
    const after = { id: 'b', title: 'After', date: TUE, startTime: '11:52', duration: 30 };
    expect(drop({ tasks: [after, mover] }, '11:20')).toMatchObject({ startTime: '11:22', duration: 30 });
  });

  it('keeps the grid away from any edge', () => {
    expect(drop({ tasks: [before, mover] }, '10:20').startTime).toBe('10:15');
  });

  it('does not stick to its own old position', () => {
    expect(drop({ tasks: [mover] }, '14:03').startTime).toBe('14:00');
    expect(drop({ tasks: [{ ...mover, startTime: '14:07' }] }, '14:05').startTime).toBe('14:00');
  });

  it('only sticks to blocks on the date it is dropped on', () => {
    const WED_DATE = new Date(`${WED}T12:00:00`);
    expect(drop({ tasks: [before, mover] }, '10:04', WED_DATE)).toMatchObject({ date: WED, startTime: '10:00' });
  });

  it('the preview shows where the drop will land', () => {
    const { state, render } = setup({ tasks: [before, mover] });
    render().handleDragStart(state.tasks[1], 'calendar', dragEvent());
    render().handleDragOver(dragEvent(atTime('10:04')), ON_TUE);
    expect(render().dragPreviewTime).toBe('10:07');
  });

  it('falls back to the grid without the day\'s tasks', () => {
    expect(drop({ tasks: [before, mover], withEdges: false }, '10:04').startTime).toBe('10:00');
  });
});
