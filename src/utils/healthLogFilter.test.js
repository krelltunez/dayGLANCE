import { describe, it, expect } from 'vitest';
import { healthSourcedHabitIds, stripHealthSourcedLogs } from './healthLogFilter.js';
import { mergeSyncData } from '../mergeSync.js';

const habits = [
  { id: 'h-steps', source: 'healthKit', unit: 'steps' },
  { id: 'h-sleep', source: 'healthKit', unit: 'min' },
  { id: 'h-water', source: undefined, unit: 'count' },
  { id: 'h-android', source: 'healthConnect', unit: 'steps' },
];

describe('healthSourcedHabitIds', () => {
  it('collects healthKit and healthConnect habit ids as strings', () => {
    const ids = healthSourcedHabitIds(habits);
    expect([...ids].sort()).toEqual(['h-android', 'h-sleep', 'h-steps']);
  });

  it('coerces numeric ids to strings and ignores non-health habits', () => {
    const ids = healthSourcedHabitIds([{ id: 42, source: 'healthKit' }, { id: 7, source: 'manual' }]);
    expect(ids.has('42')).toBe(true);
    expect(ids.has('7')).toBe(false);
  });

  it('tolerates empty/undefined input', () => {
    expect(healthSourcedHabitIds().size).toBe(0);
    expect(healthSourcedHabitIds([]).size).toBe(0);
  });
});

describe('stripHealthSourcedLogs', () => {
  const payload = {
    version: 2,
    lastModified: 'X',
    data: {
      habitLogs: {
        '2026-07-01': { 'h-steps': 8000, 'h-water': 4 },
        '2026-07-02': { 'h-sleep': 420, 'h-android': 9000 },
      },
      habitLogTimestamps: {
        '2026-07-01:h-steps': 'T1',
        '2026-07-01:h-water': 'T2',
        '2026-07-02:h-sleep': 'T3',
      },
    },
  };

  it('removes health-sourced log entries but keeps manual ones', () => {
    const out = stripHealthSourcedLogs(payload, habits);
    expect(out.data.habitLogs['2026-07-01']).toEqual({ 'h-water': 4 });
    expect(out.data.habitLogs['2026-07-02']).toEqual({});
  });

  it('removes the sibling habitLogTimestamps for health entries only', () => {
    const out = stripHealthSourcedLogs(payload, habits);
    expect(out.data.habitLogTimestamps).toEqual({ '2026-07-01:h-water': 'T2' });
  });

  it('does not mutate the input payload', () => {
    const before = JSON.stringify(payload);
    stripHealthSourcedLogs(payload, habits);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('preserves top-level fields (version, lastModified, other data keys)', () => {
    const p = { ...payload, data: { ...payload.data, tasks: [{ id: 1 }] } };
    const out = stripHealthSourcedLogs(p, habits);
    expect(out.version).toBe(2);
    expect(out.lastModified).toBe('X');
    expect(out.data.tasks).toEqual([{ id: 1 }]);
  });

  it('returns the payload unchanged when there are no health habits', () => {
    const out = stripHealthSourcedLogs(payload, [{ id: 'h-water', source: undefined }]);
    expect(out).toBe(payload);
  });

  it('returns the payload unchanged when there are no habitLogs', () => {
    const p = { data: { tasks: [] } };
    expect(stripHealthSourcedLogs(p, habits)).toBe(p);
  });

  it('handles a payload with no habitLogTimestamps', () => {
    const p = { data: { habitLogs: { '2026-07-01': { 'h-steps': 100, 'h-water': 1 } } } };
    const out = stripHealthSourcedLogs(p, habits);
    expect(out.data.habitLogs['2026-07-01']).toEqual({ 'h-water': 1 });
    expect(out.data.habitLogTimestamps).toBeUndefined();
  });
});

describe('merge preserves local health logs when remote (stripped) omits them', () => {
  // Simulates the iCloud read/merge side: the remote payload was written by a
  // device that stripped health-sourced logs, so it lacks the health habit ids.
  // Local health counts must survive the merge (they are device-local).
  it('keeps a local health count absent from the remote payload', () => {
    const local = {
      habitLogs: { '2026-07-01': { 'h-steps': 8000, 'h-water': 4 } },
      habitLogTimestamps: { '2026-07-01:h-water': 'T2' }, // health count is NOT stamped
      tasks: [{ id: 1 }],
    };
    const remote = {
      habitLogs: { '2026-07-01': { 'h-water': 4 } }, // health-stripped
      habitLogTimestamps: { '2026-07-01:h-water': 'T2' },
      tasks: [{ id: 1 }],
    };
    const { data } = mergeSyncData(local, remote, 0);
    expect(data.habitLogs['2026-07-01']['h-steps']).toBe(8000);
    expect(data.habitLogs['2026-07-01']['h-water']).toBe(4);
  });
});
