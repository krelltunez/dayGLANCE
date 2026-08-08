import { describe, it, expect } from 'vitest';
import { findRunningTask } from './runningTask.js';

// 2026-03-10, 10:30 local — the moment every case below is tested against.
const NOW = new Date(2026, 2, 10, 10, 30);
const TODAY = '2026-03-10';

const task = (extra = {}) => ({
  id: 't1', date: TODAY, startTime: '10:00', duration: 60, title: 'Deep work', ...extra,
});

describe('findRunningTask', () => {
  it('finds the task whose span covers now', () => {
    expect(findRunningTask([task()], NOW)?.id).toBe('t1');
  });

  it('treats the span as start-inclusive and end-exclusive', () => {
    // Starting exactly now counts; ending exactly now does not, so back-to-back
    // tasks never both report as running.
    expect(findRunningTask([task({ startTime: '10:30' })], NOW)?.id).toBe('t1');
    expect(findRunningTask([task({ startTime: '09:30' })], NOW)).toBeUndefined();
  });

  it('ignores tasks outside the current span', () => {
    expect(findRunningTask([task({ startTime: '11:00' })], NOW)).toBeUndefined();
    expect(findRunningTask([task({ startTime: '08:00', duration: 30 })], NOW)).toBeUndefined();
  });

  it('ignores a zero-duration task', () => {
    expect(findRunningTask([task({ startTime: '10:30', duration: 0 })], NOW)).toBeUndefined();
  });

  it('ignores tasks on another day at the same clock time', () => {
    expect(findRunningTask([task({ date: '2026-03-09' })], NOW)).toBeUndefined();
    expect(findRunningTask([task({ date: '2026-03-11' })], NOW)).toBeUndefined();
  });

  it('ignores all-day and completed tasks', () => {
    expect(findRunningTask([task({ isAllDay: true })], NOW)).toBeUndefined();
    expect(findRunningTask([task({ completed: true })], NOW)).toBeUndefined();
  });

  it('ignores read-only imported events but keeps writable task-calendar ones', () => {
    expect(findRunningTask([task({ imported: true })], NOW)).toBeUndefined();
    expect(findRunningTask([task({ imported: true, isTaskCalendar: true })], NOW)?.id).toBe('t1');
  });

  it('defaults a missing start time to midnight rather than throwing', () => {
    expect(findRunningTask([task({ startTime: undefined })], NOW)).toBeUndefined();
    expect(findRunningTask([task({ startTime: undefined, duration: 1440 })], NOW)?.id).toBe('t1');
  });

  it('returns the first match when spans overlap', () => {
    const overlapping = [task({ id: 'a' }), task({ id: 'b', startTime: '10:15' })];
    expect(findRunningTask(overlapping, NOW)?.id).toBe('a');
  });

  it('returns undefined for an empty list', () => {
    expect(findRunningTask([], NOW)).toBeUndefined();
  });
});
