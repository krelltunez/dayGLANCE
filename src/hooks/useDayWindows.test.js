import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Single-useState harness: the hook keeps all state in one useState, so a box
// that applies functional updates lets each useDayWindows() call see current
// state without a renderer (same spirit as the captured-effect tests).
let box;
let initialized;
vi.mock('react', () => ({
  useState: (init) => {
    if (!initialized) {
      box = typeof init === 'function' ? init() : init;
      initialized = true;
    }
    return [box, (up) => { box = typeof up === 'function' ? up(box) : up; }];
  },
  useCallback: (fn) => fn,
}));

const { default: useDayWindows } = await import('./useDayWindows.js');

describe('useDayWindows', () => {
  let setItem;

  beforeEach(() => {
    initialized = false;
    box = undefined;
    setItem = vi.fn();
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem, removeItem: vi.fn() };
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('resolves to null when nothing has ever been set', () => {
    const { getDayWindow } = useDayWindows();
    expect(getDayWindow('2026-08-06')).toBeNull();
  });

  it('setting a day is sticky-forward: other days inherit it as the default', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    const { getDayWindow } = useDayWindows();

    // The day itself.
    expect(getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: '22:00' });
    // A day never touched — past or future — inherits the default.
    expect(getDayWindow('2026-08-20')).toEqual({ start: '07:00', stop: '22:00' });
  });

  it('a later edit updates the default without rewriting explicitly-set days', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    useDayWindows().setDayWindow('2026-08-07', { start: '09:00', stop: '21:00' });
    const { getDayWindow } = useDayWindows();

    // The alarm-clock model: Wednesday keeps its own entry; untouched days
    // follow the most recent edit.
    expect(getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: '22:00' });
    expect(getDayWindow('2026-08-07')).toEqual({ start: '09:00', stop: '21:00' });
    expect(getDayWindow('2026-08-15')).toEqual({ start: '09:00', stop: '21:00' });
  });

  it('clearing writes an explicit off for that day only — defaults survive', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    useDayWindows().clearDayWindow('2026-08-09');
    const { getDayWindow } = useDayWindows();

    // One quiet Sunday off does not erase the standing window.
    expect(getDayWindow('2026-08-09')).toBeNull();
    expect(getDayWindow('2026-08-10')).toEqual({ start: '07:00', stop: '22:00' });
  });

  it('a single-bound window resolves with the other bound null', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00' });
    expect(useDayWindows().getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: null });
  });

  it('persists on every mutation', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    expect(setItem).toHaveBeenCalledTimes(1);
    const [key, value] = setItem.mock.calls[0];
    expect(key).toBe('day-planner-day-windows');
    expect(JSON.parse(value)).toEqual({
      defaults: { start: '07:00', stop: '22:00' },
      byDate: { '2026-08-06': { start: '07:00', stop: '22:00' } },
    });
  });

  it('survives corrupt storage by starting fresh', () => {
    globalThis.localStorage.getItem = vi.fn(() => '{not json');
    expect(useDayWindows().getDayWindow('2026-08-06')).toBeNull();
  });
});
