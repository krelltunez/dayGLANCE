import { describe, it, expect } from 'vitest';
import {
  readFrameSetPeriod, frameSetActiveOn, frameSetsById, frameSetAllows,
  normalizeFrameSetPeriods, switchFrameSetOn, switchFrameSetOff, withFrameSetPeriods,
} from './frameSets.js';
import { frameInstancesForDate, frameAppliesTo } from './frameInstances.js';

const S = (periods, over = {}) => ({ id: 's1', name: 'Holiday', periods, lastModified: '2026-11-01T00:00:00.000Z', ...over });

describe('frameSetActiveOn: period edges', () => {
  const holiday = S([{ from: '2027-01-20', until: '2027-02-20' }]);

  it('includes both ends of a closed period', () => {
    expect(frameSetActiveOn(holiday, '2027-01-20')).toBe(true);
    expect(frameSetActiveOn(holiday, '2027-02-20')).toBe(true);
    expect(frameSetActiveOn(holiday, '2027-02-01')).toBe(true);
  });

  it('excludes the day before it starts and the day after it ends', () => {
    expect(frameSetActiveOn(holiday, '2027-01-19')).toBe(false);
    expect(frameSetActiveOn(holiday, '2027-02-21')).toBe(false);
  });

  it('reads an open end as "from then on"', () => {
    const open = S([{ from: '2026-11-07', until: null }]);
    expect(frameSetActiveOn(open, '2026-11-06')).toBe(false);
    expect(frameSetActiveOn(open, '2026-11-07')).toBe(true);
    expect(frameSetActiveOn(open, '2099-12-31')).toBe(true);
  });

  it('reads an open start as "since always"', () => {
    const since = S([{ from: null, until: '2026-11-06' }]);
    expect(frameSetActiveOn(since, '1970-01-01')).toBe(true);
    expect(frameSetActiveOn(since, '2026-11-06')).toBe(true);
    expect(frameSetActiveOn(since, '2026-11-07')).toBe(false);
  });

  it('a period open at both ends covers every date', () => {
    expect(frameSetActiveOn(S([{ from: null, until: null }]), '2026-11-07')).toBe(true);
  });

  it('a set with no periods is never active', () => {
    expect(frameSetActiveOn(S([]), '2026-11-07')).toBe(false);
    expect(frameSetActiveOn(S(undefined), '2026-11-07')).toBe(false);
    expect(frameSetActiveOn(null, '2026-11-07')).toBe(false);
  });

  it('is active when any of several periods covers the date, overlapping or adjacent', () => {
    const overlapping = S([{ from: '2026-01-01', until: '2026-01-10' }, { from: '2026-01-05', until: '2026-01-20' }]);
    expect(frameSetActiveOn(overlapping, '2026-01-07')).toBe(true);
    expect(frameSetActiveOn(overlapping, '2026-01-15')).toBe(true);
    const adjacent = S([{ from: '2026-01-01', until: '2026-01-10' }, { from: '2026-01-11', until: '2026-01-20' }]);
    expect(frameSetActiveOn(adjacent, '2026-01-10')).toBe(true);
    expect(frameSetActiveOn(adjacent, '2026-01-11')).toBe(true);
    const gap = S([{ from: '2026-01-01', until: '2026-01-10' }, { from: '2026-01-12', until: '2026-01-20' }]);
    expect(frameSetActiveOn(gap, '2026-01-11')).toBe(false);
  });

  it('ignores a malformed period rather than reading it as always', () => {
    expect(readFrameSetPeriod({ from: '2026-01-10', until: '2026-01-01' })).toBeNull();
    expect(readFrameSetPeriod({ from: 'soon', until: null })).toBeNull();
    expect(frameSetActiveOn(S([{ from: '2026-01-10', until: '2026-01-01' }]), '2026-01-05')).toBe(false);
    expect(frameSetActiveOn(S(['nonsense', null]), '2026-01-05')).toBe(false);
  });

  it('answers false for a malformed date', () => {
    expect(frameSetActiveOn(S([{ from: null, until: null }]), 'nonsense')).toBe(false);
  });
});

describe('frameSetAllows: the gate a frame passes', () => {
  const sets = [S([{ from: '2026-11-01', until: '2026-11-10' }])];

  it('lets a frame with no set through', () => {
    expect(frameSetAllows({ id: 'f' }, '2026-12-01', sets)).toBe(true);
    expect(frameSetAllows({ id: 'f', setId: null }, '2026-12-01', sets)).toBe(true);
  });

  it('lets a frame whose set is unknown through: a sync gap never hides frames', () => {
    expect(frameSetAllows({ id: 'f', setId: 'gone' }, '2026-12-01', sets)).toBe(true);
    expect(frameSetAllows({ id: 'f', setId: 's1' }, '2026-12-01', undefined)).toBe(true);
  });

  it('follows the set when it is known', () => {
    expect(frameSetAllows({ id: 'f', setId: 's1' }, '2026-11-05', sets)).toBe(true);
    expect(frameSetAllows({ id: 'f', setId: 's1' }, '2026-12-01', sets)).toBe(false);
    // The same through the Map callers build once per date.
    expect(frameSetAllows({ id: 'f', setId: 's1' }, '2026-12-01', frameSetsById(sets))).toBe(false);
  });
});

describe('normalizeFrameSetPeriods', () => {
  it('sorts, and merges overlapping and adjacent periods', () => {
    expect(normalizeFrameSetPeriods([
      { from: '2026-03-01', until: '2026-03-10' },
      { from: '2026-01-01', until: '2026-01-10' },
      { from: '2026-01-11', until: '2026-01-15' },
      { from: '2026-03-05', until: '2026-03-20' },
    ])).toEqual([
      { from: '2026-01-01', until: '2026-01-15' },
      { from: '2026-03-01', until: '2026-03-20' },
    ]);
  });

  it('lets an open end absorb everything after it, and an open start everything before', () => {
    expect(normalizeFrameSetPeriods([
      { from: '2026-01-01', until: null },
      { from: '2027-01-20', until: '2027-02-20' },
    ])).toEqual([{ from: '2026-01-01', until: null }]);
    expect(normalizeFrameSetPeriods([
      { from: '2025-06-01', until: '2025-06-10' },
      { from: null, until: '2026-01-01' },
    ])).toEqual([{ from: null, until: '2026-01-01' }]);
  });

  it('keeps a gap of one day as two periods, and drops malformed ones', () => {
    expect(normalizeFrameSetPeriods([
      { from: '2026-01-01', until: '2026-01-10' },
      { from: '2026-01-12', until: '2026-01-20' },
      { from: '2026-02-10', until: '2026-02-01' },
    ])).toEqual([
      { from: '2026-01-01', until: '2026-01-10' },
      { from: '2026-01-12', until: '2026-01-20' },
    ]);
  });

  it('never changes which dates are covered', () => {
    const raw = [{ from: '2026-01-05', until: '2026-01-08' }, { from: '2026-01-01', until: '2026-01-04' }, { from: '2026-01-20', until: null }];
    const norm = normalizeFrameSetPeriods(raw);
    for (const d of ['2025-12-31', '2026-01-01', '2026-01-04', '2026-01-05', '2026-01-09', '2026-01-19', '2026-01-20', '2030-01-01']) {
      expect(frameSetActiveOn(S(norm), d), d).toBe(frameSetActiveOn(S(raw), d));
    }
  });
});

describe('the one-tap switch keeps history', () => {
  const TODAY = '2026-11-07';

  it('OFF closes the open period at yesterday: past dates keep the set, today and later lose it', () => {
    const off = switchFrameSetOff(S([{ from: null, until: null }]), TODAY);
    expect(off.periods).toEqual([{ from: null, until: '2026-11-06' }]);
    expect(frameSetActiveOn(off, '2026-11-06')).toBe(true);
    expect(frameSetActiveOn(off, TODAY)).toBe(false);
    expect(frameSetActiveOn(off, '2026-12-01')).toBe(false);
  });

  it('OFF drops a period that began today', () => {
    const off = switchFrameSetOff(S([{ from: '2026-10-01', until: '2026-10-31' }, { from: TODAY, until: null }]), TODAY);
    expect(off.periods).toEqual([{ from: '2026-10-01', until: '2026-10-31' }]);
  });

  it('OFF closes a planned period it lands inside, and keeps periods planned later', () => {
    const off = switchFrameSetOff(S([
      { from: '2026-11-01', until: '2026-11-20' },
      { from: '2027-01-20', until: '2027-02-20' },
    ]), TODAY);
    expect(off.periods).toEqual([
      { from: '2026-11-01', until: '2026-11-06' },
      { from: '2027-01-20', until: '2027-02-20' },
    ]);
  });

  it('ON opens a period at today; earlier dates stay as they were', () => {
    const on = switchFrameSetOn(S([]), TODAY);
    expect(on.periods).toEqual([{ from: TODAY, until: null }]);
    expect(frameSetActiveOn(on, '2026-11-06')).toBe(false);
    expect(frameSetActiveOn(on, TODAY)).toBe(true);
  });

  it('ON merges with a period that ended yesterday, so OFF then ON on one day is a no-op', () => {
    const start = S([{ from: null, until: null }]);
    const back = switchFrameSetOn(switchFrameSetOff(start, TODAY), TODAY);
    expect(back.periods).toEqual(start.periods);
  });

  it('ON then OFF on one day leaves the set as it was', () => {
    const start = S([{ from: '2026-01-01', until: '2026-03-01' }]);
    const back = switchFrameSetOff(switchFrameSetOn(start, TODAY), TODAY);
    expect(back.periods).toEqual(start.periods);
  });

  it('ON absorbs a period planned later (on from now on, open-ended)', () => {
    const on = switchFrameSetOn(S([{ from: '2027-01-20', until: '2027-02-20' }]), TODAY);
    expect(on.periods).toEqual([{ from: TODAY, until: null }]);
  });

  it('returns the set itself when the switch changes nothing', () => {
    const on = S([{ from: null, until: null }]);
    expect(switchFrameSetOn(on, TODAY)).toBe(on);
    const off = S([]);
    expect(switchFrameSetOff(off, TODAY)).toBe(off);
  });

  it('withFrameSetPeriods returns the set itself when the periods are unchanged', () => {
    const s = S([{ from: '2026-01-01', until: null }]);
    expect(withFrameSetPeriods(s, [{ from: '2026-01-01', until: null }])).toBe(s);
    expect(withFrameSetPeriods(s, [{ from: '2026-01-02', until: null }]).periods).toEqual([{ from: '2026-01-02', until: null }]);
  });
});

describe('frameInstancesForDate with sets', () => {
  // 2026-11-02 is a Monday.
  const MON_PAST = '2026-11-02';
  const MON_TODAY = '2026-11-09';
  const F = (id, over = {}) => ({ id, label: id, enabled: true, days: [1], start: '09:00', end: '12:00', ...over });
  const work = { id: 'work', name: 'Work', periods: [{ from: null, until: '2026-11-08' }] };
  const holiday = { id: 'hol', name: 'Holiday', periods: [{ from: '2026-11-09', until: '2026-11-20' }] };
  const frames = [F('always'), F('desk', { setId: 'work' }), F('beach', { setId: 'hol', start: '13:00', end: '15:00' })];
  const ids = (date, sets) => frameInstancesForDate(frames, date, { frameSets: sets }).map((i) => i.frameId);

  it('past dates keep the frames of a set switched off today', () => {
    expect(ids(MON_PAST, [work, holiday])).toEqual(['always', 'desk']);
  });

  it('a planned period brings its set in, and a set switched off drops out', () => {
    expect(ids(MON_TODAY, [work, holiday])).toEqual(['always', 'beach']);
    expect(ids('2026-11-23', [work, holiday])).toEqual(['always']);
  });

  it('an unknown setId applies, so a set not synced yet hides nothing', () => {
    expect(ids(MON_TODAY, [holiday])).toEqual(['always', 'desk', 'beach']);
  });

  it('a set still needs the frame\'s own rules: days, enabled, singleDate, exceptions', () => {
    const always = { id: 'on', periods: [{ from: null, until: null }] };
    const own = [
      F('tue', { setId: 'on', days: [2] }),
      F('off', { setId: 'on', enabled: false }),
      F('pin', { setId: 'on', singleDate: '2026-11-10' }),
      F('skip', { setId: 'on', exceptions: { [MON_TODAY]: { deleted: true } } }),
    ];
    expect(frameInstancesForDate(own, MON_TODAY, { frameSets: [always] })).toEqual([]);
    expect(frameInstancesForDate(own, '2026-11-10', { frameSets: [always] }).map((i) => i.frameId)).toEqual(['tue', 'pin']);
  });

  it('frameAppliesTo takes the same gate', () => {
    expect(frameAppliesTo(F('x', { setId: 'hol' }), MON_PAST, 1, { frameSets: [holiday] })).toBe(false);
    expect(frameAppliesTo(F('x', { setId: 'hol' }), MON_TODAY, 1, { frameSets: [holiday] })).toBe(true);
  });

  it('no sets: unchanged behaviour, the instances exactly as before the feature', () => {
    // Pinned against the instance shape the pre-sets module produced.
    const plain = [F('a', { color: 'blue', tagAffinity: ['#x'], energyLevel: 'high', bufferMinutes: 10 }), F('b', { setId: 'whatever' })];
    const expected = [
      { frameId: 'a', templateId: 'a', date: MON_TODAY, start: '09:00', end: '12:00', label: 'a', color: 'blue', tagAffinity: ['#x'], energyLevel: 'high', bufferMinutes: 10 },
      { frameId: 'b', templateId: 'b', date: MON_TODAY, start: '09:00', end: '12:00', label: 'b', color: undefined, tagAffinity: [], energyLevel: 'medium', bufferMinutes: 5 },
    ];
    expect(frameInstancesForDate(plain, MON_TODAY)).toEqual(expected);
    expect(frameInstancesForDate(plain, MON_TODAY, { frameSets: [] })).toEqual(expected);
  });
});
