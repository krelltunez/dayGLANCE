import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPastDayIndex } from '../jobo/pastDay.js';
import { createDoRecord } from '../jobo/core.js';

// Today, split at the NOW line: the views read today through this set, so it
// must change only when a block ends or a task is completed, and never
// under a drag.

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', () => ({
  useRef(value) { const i = runtime.cursor++; return runtime.slots[i] ||= { current: value }; },
  useMemo(fn, deps) {
    const i = runtime.cursor++;
    const slot = runtime.slots[i];
    if (slot && deps.length === slot.deps.length && deps.every((d, k) => Object.is(d, slot.deps[k]))) return slot.value;
    runtime.slots[i] = { value: fn(), deps };
    return runtime.slots[i].value;
  },
}));
const { default: useTodayEnded } = await import('./useTodayEnded.js');

const TODAY = '2026-10-04';
const at = (hh, mm = 0) => new Date(`${TODAY}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);

let tasks;
const getTasksForDate = (date) => {
  return tasks.filter(task => task.date === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
};
const stamp = `${TODAY}T08:00:00.000Z`;
const record = (taskId, startTime, endTime) => createDoRecord({
  id: `manual:${taskId}:${startTime}`, taskId, title: taskId, source: 'manual', progress: 'partial',
  timing: 'timed', date: TODAY, startTime, endDate: TODAY, endTime, planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp,
});

let index;
function render(currentTime, { gestureActive = false } = {}) {
  runtime.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useTodayEnded({ pastDayIndex: index, currentTime, getTasksForDate, isVisibleForUser: () => true, gestureActive });
}

beforeEach(() => {
  runtime.slots = [];
  tasks = [
    { id: 'spec', title: 'Write spec', date: TODAY, startTime: '09:00', duration: 60, completed: true },
    { id: 'call', title: 'Call bank', date: TODAY, startTime: '11:00', duration: 60, completed: true },
  ];
  const records = [record('spec', '09:00', '09:45'), record('call', '10:00', '10:30')];
  index = buildPastDayIndex({ records, taskLookup: tasks });
});

describe('useTodayEnded', () => {
  it('lists completed tasks whose block has ended, from the clock', () => {
    expect([...render(at(9, 30)).todayEnded]).toEqual([]);
    expect([...render(at(10)).todayEnded]).toEqual(['spec']);
    expect([...render(at(12)).todayEnded].sort()).toEqual(['call', 'spec']);
  });

  it('keeps the same set across ticks until a block ends', () => {
    const first = render(at(10)).todayEnded;
    expect(render(at(10, 15)).todayEnded).toBe(first);
    expect(render(at(10, 59)).todayEnded).toBe(first);
    const next = render(at(11, 0)).todayEnded;
    expect(next).toBe(first);
    expect(render(at(12)).todayEnded).not.toBe(first);
  });

  it('changes when a task is completed, without waiting for a tick', () => {
    tasks[0] = { ...tasks[0], completed: false };
    index = buildPastDayIndex({ records: [record('spec', '09:00', '09:45')], taskLookup: tasks });
    expect([...render(at(10)).todayEnded]).toEqual([]);
    tasks = [{ ...tasks[0], completed: true }, tasks[1]];
    expect([...render(at(10)).todayEnded]).toEqual(['spec']);
  });

  it('holds the set under a drag or resize and catches up on the drop', () => {
    const before = render(at(10, 59)).todayEnded;
    expect(render(at(12), { gestureActive: true }).todayEnded).toBe(before);
    expect([...render(at(12), { gestureActive: false }).todayEnded].sort()).toEqual(['call', 'spec']);
  });

  it('is null with no index, so today shows as planned', () => {
    index = null;
    expect(render(at(12)).todayEnded).toBeNull();
    expect(render(at(12)).todayStr).toBe(TODAY);
  });
});
