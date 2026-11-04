import { describe, expect, it } from 'vitest';
import { applyExceptionStamps, mergeExceptions, stampExceptionChanges, stampExceptionDates, withMergedExceptions } from '../src/recurringExceptions.js';

const T1 = '2026-10-20T09:00:00.000Z';
const T2 = '2026-10-21T09:00:00.000Z';
const T3 = '2026-10-22T09:00:00.000Z';
const series = (over = {}) => ({ id: 'r1', title: 'Gym', startTime: '07:00', duration: 45, recurrence: { type: 'daily', startDate: '2026-10-01' },
  completedDates: [], exceptions: {}, lastModified: T1, ...over });

describe('the save pass stamps the dates that changed', () => {
  it('stamps an added, a changed and a removed date, and nothing else', () => {
    const stored = series({ exceptions: { '2026-10-24': { startTime: '08:00' }, '2026-10-25': { deleted: true }, '2026-10-26': { title: 'x' } },
      exceptionsTimestamps: { '2026-10-26': T1 } });
    const now = series({ exceptions: { '2026-10-24': { startTime: '09:00' }, '2026-10-26': { title: 'x' }, '2026-10-27': { skipped: true } },
      exceptionsTimestamps: { '2026-10-26': T1 } });
    expect(stampExceptionDates(now, stored, T3).exceptionsTimestamps).toEqual({
      '2026-10-24': T3, '2026-10-25': T3, '2026-10-26': T1, '2026-10-27': T3,
    });
  });

  it('reads key order as no change, and returns the same object when nothing changed', () => {
    const stored = series({ exceptions: { '2026-10-24': { startTime: '08:00', title: 'A' } } });
    const now = series({ exceptions: { '2026-10-24': { title: 'A', startTime: '08:00' } } });
    expect(stampExceptionDates(now, stored, T3)).toBe(now);
  });

  it('stamps nothing for a series with no stored copy (created here, or arrived)', () => {
    const fresh = series({ exceptions: { '2026-10-24': { deleted: true } } });
    expect(stampExceptionDates(fresh, undefined, T3)).toBe(fresh);
    expect(stampExceptionChanges([fresh], [], T3)).toEqual([fresh]);
  });

  it('works over a list, returning the same array when nothing changed', () => {
    const list = [series(), series({ id: 'r2' })];
    expect(stampExceptionChanges(list, list, T3)).toBe(list);
    const edited = [list[0], series({ id: 'r2', exceptions: { '2026-10-24': { deleted: true } } })];
    const out = stampExceptionChanges(edited, list, T3);
    expect(out[0]).toBe(list[0]);
    expect(out[1].exceptionsTimestamps).toEqual({ '2026-10-24': T3 });
  });

  it('writes only the stamp map back into live state, by id', () => {
    const live = [series({ title: 'Renamed since', exceptions: { '2026-10-24': { deleted: true } } }), series({ id: 'r2' })];
    const stamped = [series({ exceptionsTimestamps: { '2026-10-24': T3 } })];
    const out = applyExceptionStamps(live, stamped);
    expect(out[0]).toEqual({ ...live[0], exceptionsTimestamps: { '2026-10-24': T3 } });
    expect(out[1]).toBe(live[1]);
    expect(applyExceptionStamps(out, stamped)).toBe(out);
  });
});

describe('the merge picks each date by its stamp', () => {
  it('keeps a skip on one device and a rename on the other (the problem this solves)', () => {
    const base = series({ lastModified: T1 });
    const phone = { ...base, exceptions: { '2026-10-24': { skipped: true, skip: { at: 'x', plan: {} } } }, exceptionsTimestamps: { '2026-10-24': T2 }, lastModified: T2 };
    const desktop = { ...base, title: 'Gym (new)', lastModified: T3 };
    for (const [l, r] of [[phone, desktop], [desktop, phone]]) {
      const merged = withMergedExceptions(desktop, l, r);
      expect(merged.title).toBe('Gym (new)');
      expect(merged.exceptions['2026-10-24'].skipped).toBe(true);
      expect(merged.exceptionsTimestamps).toEqual({ '2026-10-24': T2 });
    }
  });

  it('keeps two dates edited on two devices', () => {
    const a = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-24': T2 }, lastModified: T2 });
    const b = series({ exceptions: { '2026-10-25': { startTime: '09:00' } }, exceptionsTimestamps: { '2026-10-25': T3 }, lastModified: T3 });
    expect(mergeExceptions(a, b).exceptions).toEqual({ '2026-10-24': { startTime: '08:00' }, '2026-10-25': { startTime: '09:00' } });
  });

  it('lets a newer removal win over an older copy that still has the date', () => {
    const removed = series({ exceptions: {}, exceptionsTimestamps: { '2026-10-24': T3 }, lastModified: T1 });
    const older = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-24': T2 }, lastModified: T2 });
    expect(mergeExceptions(removed, older)).toEqual({ exceptions: {}, exceptionsTimestamps: { '2026-10-24': T3 } });
  });

  it('takes the whole exception of the newer date, never a field-level blend', () => {
    const a = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-24': T2 } });
    const b = series({ exceptions: { '2026-10-24': { title: 'Swim' } }, exceptionsTimestamps: { '2026-10-24': T3 } });
    expect(mergeExceptions(a, b).exceptions).toEqual({ '2026-10-24': { title: 'Swim' } });
  });

  it('merges rows without stamps exactly as whole-row last-writer-wins did', () => {
    const older = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, lastModified: T1 });
    const newer = series({ exceptions: { '2026-10-25': { deleted: true } }, lastModified: T2 });
    expect(mergeExceptions(older, newer)).toEqual({ exceptions: newer.exceptions, exceptionsTimestamps: {} });
  });

  it('lets a stamped edit beat an unstamped one of the same date (an older app version)', () => {
    const stamped = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-24': T2 }, lastModified: T2 });
    const legacy = series({ exceptions: { '2026-10-24': { startTime: '10:00' } }, lastModified: T3 });
    expect(mergeExceptions(stamped, legacy).exceptions['2026-10-24']).toEqual({ startTime: '08:00' });
  });

  it('falls back to the row winner where the stamps agree (an older version edited a stamped date)', () => {
    const before = series({ exceptions: { '2026-10-24': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-24': T1 }, lastModified: T1 });
    const legacyEdit = { ...before, exceptions: { '2026-10-24': { startTime: '11:00' } }, lastModified: T3 };
    expect(mergeExceptions(before, legacyEdit).exceptions['2026-10-24']).toEqual({ startTime: '11:00' });
  });

  it('leaves a series alone when only one copy exists', () => {
    const only = series();
    expect(withMergedExceptions(only, only, undefined)).toBe(only);
  });
});

describe('order independence and idempotence, exhaustively', () => {
  // Every combination, per side, of: the date present or absent, two
  // contents, four stamps (none, T1, T2, and T2 written with an offset),
  // and two lastModified values.
  const stamps = [undefined, T1, T2, '2026-10-21T11:00:00+02:00'];
  const contents = [undefined, { startTime: '08:00' }, { startTime: '09:00', title: 'x' }];
  const copies = [];
  for (const content of contents) for (const stamp of stamps) for (const lastModified of [T1, T3]) {
    copies.push(series({
      exceptions: content ? { '2026-10-24': content } : {},
      ...(stamp ? { exceptionsTimestamps: { '2026-10-24': stamp } } : {}),
      lastModified,
    }));
  }

  it('gives the same result whichever copy is local', () => {
    for (const a of copies) for (const b of copies) {
      expect(mergeExceptions(a, b)).toEqual(mergeExceptions(b, a));
    }
  });

  it('changes nothing when the result is merged again with either copy', () => {
    for (const a of copies) for (const b of copies) {
      const merged = { ...a, ...mergeExceptions(a, b), lastModified: [a, b].map(c => c.lastModified).sort().at(-1) };
      expect(mergeExceptions(merged, a)).toEqual(mergeExceptions(a, b));
      expect(mergeExceptions(merged, b)).toEqual(mergeExceptions(a, b));
    }
  });
});
