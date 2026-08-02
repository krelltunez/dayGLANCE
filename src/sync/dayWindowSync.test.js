import { describe, it, expect } from 'vitest';
import {
  migrateDayWindows,
  mergeDayWindowMaps,
  dayWindowMapsEqual,
  resolveDayWindow,
  DEFAULTS_KEY,
} from './dayWindowSync.js';

const EPOCH = '1970-01-01T00:00:00.000Z';
const entry = (start, stop, lastModified) => ({ start, stop, lastModified });

describe('migrateDayWindows', () => {
  it('flattens the v1 phase-A shape and stamps entries with the epoch', () => {
    // Epoch, not "now": any REAL synced edit must beat never-edited legacy
    // data, and two devices migrating at different moments must not race.
    const v1 = {
      defaults: { start: '07:00', stop: '22:00' },
      byDate: { '2026-08-06': { start: '09:00', stop: null } },
    };
    expect(migrateDayWindows(v1)).toEqual({
      [DEFAULTS_KEY]: entry('07:00', '22:00', EPOCH),
      '2026-08-06': entry('09:00', null, EPOCH),
    });
  });

  it('passes a v2 map through, stamping any missing lastModified', () => {
    const v2 = {
      [DEFAULTS_KEY]: entry('08:00', '21:00', '2026-08-06T10:00:00.000Z'),
      '2026-08-07': { start: '09:00', stop: '20:00' }, // no stamp
    };
    const out = migrateDayWindows(v2);
    expect(out[DEFAULTS_KEY].lastModified).toBe('2026-08-06T10:00:00.000Z');
    expect(out['2026-08-07'].lastModified).toBe(EPOCH);
  });

  it('returns an empty map for garbage', () => {
    expect(migrateDayWindows(null)).toEqual({});
    expect(migrateDayWindows('nope')).toEqual({});
    expect(migrateDayWindows({ '2026-08-06': 'junk' })).toEqual({});
  });
});

describe('mergeDayWindowMaps', () => {
  it('keeps the newer entry per key', () => {
    const local = { '2026-08-06': entry('07:00', '22:00', '2026-08-06T08:00:00Z') };
    const remote = {
      '2026-08-06': entry('09:00', '21:00', '2026-08-06T12:00:00Z'), // newer
      '2026-08-07': entry('06:00', '20:00', '2026-08-05T00:00:00Z'), // only remote
    };
    expect(mergeDayWindowMaps(local, remote)).toEqual({
      '2026-08-06': entry('09:00', '21:00', '2026-08-06T12:00:00Z'),
      '2026-08-07': entry('06:00', '20:00', '2026-08-05T00:00:00Z'),
    });
  });

  it('concurrent edits to DIFFERENT days both survive — the point of per-key grain', () => {
    const local = { '2026-08-06': entry('07:00', '22:00', '2026-08-06T09:00:00Z') };
    const remote = { '2026-08-07': entry('10:00', '23:00', '2026-08-06T09:00:00Z') };
    const merged = mergeDayWindowMaps(local, remote);
    expect(Object.keys(merged).sort()).toEqual(['2026-08-06', '2026-08-07']);
  });

  it('local wins ties (mergeCalendarConfigByUser convention)', () => {
    const t = '2026-08-06T09:00:00Z';
    const local = { '2026-08-06': entry('07:00', null, t) };
    const remote = { '2026-08-06': entry('08:00', null, t) };
    expect(mergeDayWindowMaps(local, remote)['2026-08-06'].start).toBe('07:00');
  });

  it('a NEWER explicit-off beats an older window — clears propagate, no tombstones needed', () => {
    const local = { '2026-08-06': entry('07:00', '22:00', '2026-08-06T08:00:00Z') };
    const remote = { '2026-08-06': entry(null, null, '2026-08-06T12:00:00Z') };
    expect(mergeDayWindowMaps(local, remote)['2026-08-06']).toEqual(entry(null, null, '2026-08-06T12:00:00Z'));
  });

  it('returns the LOCAL REFERENCE when nothing remote is newer — identity is the change check', () => {
    const local = { '2026-08-06': entry('07:00', '22:00', '2026-08-06T12:00:00Z') };
    const remote = { '2026-08-06': entry('09:00', '21:00', '2026-08-06T08:00:00Z') };
    expect(mergeDayWindowMaps(local, remote)).toBe(local);
    expect(mergeDayWindowMaps(local, {})).toBe(local);
    expect(mergeDayWindowMaps(local, null)).toBe(local);
  });
});

describe('dayWindowMapsEqual', () => {
  it('detects a missing or differing entry', () => {
    const a = { '2026-08-06': entry('07:00', null, '2026-08-06T08:00:00Z') };
    expect(dayWindowMapsEqual(a, { ...a })).toBe(true);
    expect(dayWindowMapsEqual(a, {})).toBe(false);
    expect(dayWindowMapsEqual(a, { '2026-08-06': entry('08:00', null, '2026-08-06T08:00:00Z') })).toBe(false);
  });
});

describe('resolveDayWindow', () => {
  const map = {
    [DEFAULTS_KEY]: entry('08:00', '22:00', EPOCH),
    '2026-08-06': entry('10:00', '20:00', EPOCH),
    '2026-08-09': entry(null, null, EPOCH), // explicit off
  };

  it('explicit entry beats defaults; untouched days inherit; off is off', () => {
    expect(resolveDayWindow(map, '2026-08-06')).toEqual({ start: '10:00', stop: '20:00' });
    expect(resolveDayWindow(map, '2026-08-07')).toEqual({ start: '08:00', stop: '22:00' });
    expect(resolveDayWindow(map, '2026-08-09')).toBeNull();
  });

  it('no entry, no defaults → null', () => {
    expect(resolveDayWindow({}, '2026-08-06')).toBeNull();
    expect(resolveDayWindow(null, '2026-08-06')).toBeNull();
  });
});
