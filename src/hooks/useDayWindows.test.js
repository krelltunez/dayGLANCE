import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULTS_KEY } from '../sync/dayWindowSync.js';

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
  useRef: (init) => ({ current: init }),
}));

const schedulePush = vi.fn();
vi.mock('../sync/dirtyTracker.js', () => ({
  schedulePush: (...args) => schedulePush(...args),
}));

const { default: useDayWindows } = await import('./useDayWindows.js');

describe('useDayWindows', () => {
  let setItem;

  beforeEach(() => {
    initialized = false;
    box = undefined;
    setItem = vi.fn();
    schedulePush.mockClear();
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

    expect(getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: '22:00' });
    // A day never touched — past or future — inherits the default.
    expect(getDayWindow('2026-08-20')).toEqual({ start: '07:00', stop: '22:00' });
  });

  it('a later edit updates the default without rewriting explicitly-set days', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    useDayWindows().setDayWindow('2026-08-07', { start: '09:00', stop: '21:00' });
    const { getDayWindow } = useDayWindows();

    expect(getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: '22:00' });
    expect(getDayWindow('2026-08-07')).toEqual({ start: '09:00', stop: '21:00' });
    expect(getDayWindow('2026-08-15')).toEqual({ start: '09:00', stop: '21:00' });
  });

  it('clearing writes an explicit off for that day only — defaults survive', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    useDayWindows().clearDayWindow('2026-08-09');
    const { getDayWindow } = useDayWindows();

    expect(getDayWindow('2026-08-09')).toBeNull();
    expect(getDayWindow('2026-08-10')).toEqual({ start: '07:00', stop: '22:00' });
  });

  it('persists the SYNCED v2 shape: flat map, per-entry lastModified stamps', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    const [key, value] = setItem.mock.calls.at(-1);
    expect(key).toBe('day-planner-day-windows');
    const stored = JSON.parse(value);
    expect(Object.keys(stored).sort()).toEqual(['2026-08-06', DEFAULTS_KEY].sort());
    for (const e of Object.values(stored)) {
      expect(e.start).toBe('07:00');
      expect(e.stop).toBe('22:00');
      // A real timestamp, not the epoch — the edit must win LWW elsewhere.
      expect(new Date(e.lastModified).getTime()).toBeGreaterThan(0);
    }
  });

  it('schedules a vault push on every mutation, never on remote apply', () => {
    const hook = useDayWindows();
    hook.setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    hook.clearDayWindow('2026-08-07');
    expect(schedulePush).toHaveBeenCalledTimes(2);

    schedulePush.mockClear();
    useDayWindows().applyRemoteDayWindows({
      '2026-08-08': { start: '06:00', stop: '20:00', lastModified: '2026-08-06T00:00:00Z' },
    });
    // A pulled change is not a user edit; pushing here would echo every apply.
    expect(schedulePush).not.toHaveBeenCalled();
  });

  it('applyRemoteDayWindows merges per-entry LWW and persists only on change', () => {
    useDayWindows().setDayWindow('2026-08-06', { start: '07:00', stop: '22:00' });
    const writesBefore = setItem.mock.calls.length;

    // Older remote entry for the same day: nothing changes, nothing persists.
    useDayWindows().applyRemoteDayWindows({
      '2026-08-06': { start: '01:00', stop: '02:00', lastModified: '2000-01-01T00:00:00Z' },
    });
    expect(setItem.mock.calls.length).toBe(writesBefore);
    expect(useDayWindows().getDayWindow('2026-08-06')).toEqual({ start: '07:00', stop: '22:00' });

    // A new day from another device lands and persists.
    useDayWindows().applyRemoteDayWindows({
      '2026-08-08': { start: '06:00', stop: '20:00', lastModified: '2026-08-06T00:00:00Z' },
    });
    expect(setItem.mock.calls.length).toBe(writesBefore + 1);
    expect(useDayWindows().getDayWindow('2026-08-08')).toEqual({ start: '06:00', stop: '20:00' });
  });

  it('migrates the phase-A v1 shape on load, preserving semantics', () => {
    globalThis.localStorage.getItem = vi.fn(() => JSON.stringify({
      defaults: { start: '08:00', stop: '21:00' },
      byDate: { '2026-08-05': { start: null, stop: null } },
    }));
    const { getDayWindow } = useDayWindows();

    expect(getDayWindow('2026-08-05')).toBeNull(); // explicit off survived
    expect(getDayWindow('2026-08-06')).toEqual({ start: '08:00', stop: '21:00' });
  });

  it('survives corrupt storage by starting fresh', () => {
    globalThis.localStorage.getItem = vi.fn(() => '{not json');
    expect(useDayWindows().getDayWindow('2026-08-06')).toBeNull();
  });
});
