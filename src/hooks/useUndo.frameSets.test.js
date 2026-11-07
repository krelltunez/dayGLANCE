import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Deleting a frame set (#2305) unassigns its frames in the same step, and that
// step undoes and redoes as one: the set comes back with its frames' setId,
// stamped newer than the tombstone so the next sync keeps the undo; redo
// removes it again, with a tombstone, so the other tiers delete it too.

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useEffect(fn) { runtime.effects.push(fn); },
  useCallback(fn) { return fn; },
  useState(value) {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = value;
    return [runtime.slots[i], (next) => { runtime.slots[i] = next; }];
  },
}));
const { default: useUndo } = await import('./useUndo.js');
const { default: useFrameSetActions } = await import('./useFrameSetActions.js');
const { DELETED_FRAME_SET_IDS_KEY } = await import('../utils/storedSlices.js');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

const T0 = '2026-11-01T00:00:00.000Z';
const work = { id: 'work', name: 'Work', periods: [{ from: null, until: null }], lastModified: T0 };
const desk = { id: 'desk', label: 'Desk', enabled: true, days: [1], start: '09:00', end: '12:00', setId: 'work', lastModified: T0 };

function app() {
  runtime.slots = [];
  const state = { tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [], gtdFrames: [desk], frameSets: [work] };
  const toasts = [];
  const setter = (key) => (next) => { state[key] = typeof next === 'function' ? next(state[key]) : next; };
  const render = () => {
    runtime.cursor = 0;
    runtime.effects = [];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const undo = useUndo({
      ...state,
      setTasks: setter('tasks'), setUnscheduledTasks: setter('unscheduledTasks'),
      setRecycleBin: setter('recycleBin'), setRecurringTasks: setter('recurringTasks'),
      setGtdFrames: setter('gtdFrames'), setFrameSets: setter('frameSets'), playUISound() {},
      t: (key, params) => `${key}:${params?.title ?? ''}`,
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const actions = useFrameSetActions({
      frameSets: state.frameSets, setFrameSets: setter('frameSets'), setGtdFrames: setter('gtdFrames'),
      getTodayStr: () => '2026-11-07', pushUndo: undo.pushUndo, setUndoToast: (toast) => toasts.push(toast),
    });
    // The refs sync as React runs effects after a render; not the toast timer.
    runtime.effects.forEach((fn, i) => { if (i !== 5) fn(); });
    return { ...undo, ...actions };
  };
  return { state, render, toasts };
}

const tombstones = () => JSON.parse(globalThis.localStorage.getItem(DELETED_FRAME_SET_IDS_KEY) || '{}');

describe('undo of a frame set deletion', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z')); });
  afterEach(() => { delete globalThis.localStorage; vi.useRealTimers(); });

  it('deleting unassigns the frames and writes the tombstone, as one step with a toast', () => {
    const { state, render, toasts } = app();
    render().deleteFrameSet('work');
    expect(state.frameSets).toEqual([]);
    expect(state.gtdFrames[0]).not.toHaveProperty('setId');
    expect(state.gtdFrames[0].lastModified).toBe('2026-11-07T10:00:00.000Z');
    expect(tombstones()).toEqual({ work: '2026-11-07T10:00:00.000Z' });
    expect(toasts).toEqual([{ message: 'undo.action.frameSetDeleted:Work', actionable: true }]);
  });

  it('undo brings the set and the frames\' setId back, newer than the tombstone; redo deletes again', () => {
    const { state, render } = app();
    render().deleteFrameSet('work');

    vi.setSystemTime(new Date('2026-11-07T10:01:00.000Z'));
    render().performUndo();
    expect(state.frameSets.map((s) => s.id)).toEqual(['work']);
    expect(state.frameSets[0].periods).toEqual(work.periods);
    expect(Date.parse(state.frameSets[0].lastModified)).toBeGreaterThan(Date.parse(tombstones().work));
    expect(state.gtdFrames[0].setId).toBe('work');

    vi.setSystemTime(new Date('2026-11-07T10:02:00.000Z'));
    render().performRedo();
    expect(state.frameSets).toEqual([]);
    expect(state.gtdFrames[0]).not.toHaveProperty('setId');
    expect(tombstones().work).toBe('2026-11-07T10:02:00.000Z');
  });

  it('undo touches only the set the step deleted: a set made since stays', () => {
    const { state, render } = app();
    render().deleteFrameSet('work');
    render().createFrameSet('Holiday');
    expect(state.frameSets.map((s) => s.name)).toEqual(['Holiday']);
    render().performUndo();
    expect(state.frameSets.map((s) => s.name).sort()).toEqual(['Holiday', 'Work']);
  });

  it('refuses every edit while the stored sets could not be read', () => {
    const { state, render } = app();
    state.frameSets = undefined;
    const r = render();
    expect(r.frameSetsLoaded).toBe(false);
    expect(r.createFrameSet('Holiday')).toBeNull();
    r.deleteFrameSet('work');
    r.switchFrameSet('work', false);
    expect(state.frameSets).toBeUndefined();
    expect(state.gtdFrames[0].setId).toBe('work');
  });
});
