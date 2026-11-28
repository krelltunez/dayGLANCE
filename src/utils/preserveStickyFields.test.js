import { describe, it, expect } from 'vitest';
import { preserveStickyFields } from './preserveStickyFields.js';

// The applyEngineData second-pass strip: a merged/remote copy that OMITS `archived`
// must not silently un-archive a locally-archived item (which also caused the
// re-stamp/push churn). A real remote unarchive (archived:false explicit) still wins.

describe('preserveStickyFields', () => {
  it('back-fills archived:true when the incoming copy omits it (the churn fix)', () => {
    const existing = [{ id: 'a', archived: true }];
    const incoming = [{ id: 'a', title: 'x' }]; // merged row dropped archived
    expect(preserveStickyFields(incoming, existing)).toEqual([{ id: 'a', title: 'x', archived: true }]);
  });

  it('does NOT override an explicit remote unarchive (archived:false propagates)', () => {
    const existing = [{ id: 'a', archived: true }];
    const incoming = [{ id: 'a', title: 'x', archived: false }];
    expect(preserveStickyFields(incoming, existing)[0].archived).toBe(false);
  });

  it('leaves a never-archived item alone (no archived key injected)', () => {
    const existing = [{ id: 'a' }];
    const incoming = [{ id: 'a', title: 'x' }];
    const out = preserveStickyFields(incoming, existing);
    expect('archived' in out[0]).toBe(false);
  });

  it('carries a local archived:false forward when incoming omits it', () => {
    // Local explicitly un-archived; incoming (older) lacks the flag → keep local false.
    const existing = [{ id: 'a', archived: false }];
    const incoming = [{ id: 'a', title: 'x' }];
    expect(preserveStickyFields(incoming, existing)[0].archived).toBe(false);
  });

  it('an incoming archived:true is kept even if local lacks it', () => {
    const existing = [{ id: 'a' }];
    const incoming = [{ id: 'a', archived: true }];
    expect(preserveStickyFields(incoming, existing)[0].archived).toBe(true);
  });

  it('matches by id across both lists (scheduled↔inbox move) and ignores unmatched', () => {
    const existing = [{ id: 'sched-1', archived: true }, { id: 'inbox-9', archived: true }];
    const incoming = [{ id: 'inbox-9', title: 'moved' }, { id: 'new-1', title: 'fresh' }];
    const out = preserveStickyFields(incoming, existing);
    expect(out[0].archived).toBe(true);          // matched → healed
    expect('archived' in out[1]).toBe(false);     // no local match → untouched
  });

  it('handles empty/undefined inputs without throwing', () => {
    expect(preserveStickyFields(undefined, undefined)).toEqual([]);
    expect(preserveStickyFields([], [{ id: 'a', archived: true }])).toEqual([]);
    expect(preserveStickyFields([{ id: 'a' }], undefined)).toEqual([{ id: 'a' }]);
  });

  it('the 24-item repro: all locally-archived items survive a merge that dropped archived', () => {
    const ids = Array.from({ length: 24 }, (_, i) => `id-${i}`);
    const existing = ids.map((id) => ({ id, completed: true, archived: true }));
    const incoming = ids.map((id) => ({ id, completed: true })); // vault row without archived
    const out = preserveStickyFields(incoming, existing);
    expect(out.every((t) => t.archived === true)).toBe(true);
  });
});

describe('preserveStickyFields — originalPlan', () => {
  // The apply path is where the loss would otherwise become permanent: it runs
  // with suppressTimestampRef set, so the persist pass skips stampOriginalPlan
  // and writes storage without the field. Carrying it here is what stops a merge
  // from an older device erasing the baseline for good.
  const PLAN = { date: '2026-09-17', startTime: '09:00', duration: 60 };

  it('back-fills the baseline when the incoming copy omits it', () => {
    const existing = [{ id: 'a', originalPlan: PLAN }];
    const incoming = [{ id: 'a', title: 'x', startTime: '16:00' }];
    const [out] = preserveStickyFields(incoming, existing);
    expect(out.originalPlan).toEqual(PLAN);
    expect(out.startTime).toBe('16:00'); // the incoming reschedule is untouched
  });

  it('never overwrites a baseline the incoming copy already has', () => {
    const existing = [{ id: 'a', originalPlan: PLAN }];
    const incoming = [{ id: 'a', originalPlan: { date: '2026-01-01', startTime: '07:00' } }];
    expect(preserveStickyFields(incoming, existing)[0].originalPlan)
      .toEqual({ date: '2026-01-01', startTime: '07:00' });
  });

  it('injects nothing when neither side has one', () => {
    const [out] = preserveStickyFields([{ id: 'a' }], [{ id: 'a' }]);
    expect('originalPlan' in out).toBe(false);
  });

  it('carries archived and originalPlan independently', () => {
    const existing = [{ id: 'a', archived: true, originalPlan: PLAN }];
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], existing);
    expect(out).toEqual({ id: 'a', title: 'x', archived: true, originalPlan: PLAN });
  });

  it('leaves a task with no local counterpart alone', () => {
    const [out] = preserveStickyFields([{ id: 'new' }], [{ id: 'a', originalPlan: PLAN }]);
    expect(out.originalPlan).toBeUndefined();
  });
});

describe('preserveStickyFields — starredDate', () => {
  const DAY = '2026-09-18';

  it('back-fills a star the incoming copy omits', () => {
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], [{ id: 'a', starredDate: DAY }]);
    expect(out.starredDate).toBe(DAY);
  });

  it('honours an explicit unstar rather than restoring the star', () => {
    const [out] = preserveStickyFields([{ id: 'a', starredDate: null }], [{ id: 'a', starredDate: DAY }]);
    expect(out.starredDate).toBeNull();
  });

  it('carries all three sticky fields independently in one pass', () => {
    const existing = [{ id: 'a', archived: true, starredDate: DAY, originalPlan: { date: DAY, startTime: '08:00' } }];
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], existing);
    expect(out).toEqual({
      id: 'a', title: 'x', archived: true, starredDate: DAY,
      originalPlan: { date: DAY, startTime: '08:00' },
    });
  });
});

describe('preserveStickyFields — deferrals merge rather than carry', () => {
  it('keeps the higher of the two counts', () => {
    const [out] = preserveStickyFields([{ id: 'a', deferrals: 2 }], [{ id: 'a', deferrals: 7 }]);
    expect(out.deferrals).toBe(7);
  });

  it('takes a higher incoming count', () => {
    const [out] = preserveStickyFields([{ id: 'a', deferrals: 9 }], [{ id: 'a', deferrals: 1 }]);
    expect(out.deferrals).toBe(9);
  });

  it('keeps a local count the incoming copy omits', () => {
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], [{ id: 'a', deferrals: 4 }]);
    expect(out.deferrals).toBe(4);
  });

  it('injects nothing when neither side has one', () => {
    const [out] = preserveStickyFields([{ id: 'a' }], [{ id: 'a' }]);
    expect('deferrals' in out).toBe(false);
  });
});

describe('preserveStickyFields — the plan trail unions rather than carries', () => {
  const STOP_A = { at: 1000, date: '2026-09-15', startTime: '09:00' };
  const STOP_B = { at: 2000, date: '2026-09-17', startTime: '14:00' };

  it('recovers a stop the incoming copy never had', () => {
    const [out] = preserveStickyFields([{ id: 'a', planTrail: [STOP_B] }], [{ id: 'a', planTrail: [STOP_A] }]);
    expect(out.planTrail).toEqual([STOP_A, STOP_B]);
  });

  it('carries the local trail when the incoming copy has none', () => {
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], [{ id: 'a', planTrail: [STOP_A] }]);
    expect(out.planTrail).toEqual([STOP_A]);
  });

  it('leaves a task neither side has a trail for alone', () => {
    const [out] = preserveStickyFields([{ id: 'a' }], [{ id: 'a' }]);
    expect('planTrail' in out).toBe(false);
  });
});

describe('preserveStickyFields — clientId (the launcher write id)', () => {
  // MUTATION: drop 'clientId' from STICKY_FIELDS and this fails.
  it('back-fills the id when the incoming copy omits it', () => {
    const [out] = preserveStickyFields([{ id: 'a', title: 'x' }], [{ id: 'a', clientId: 'w-1' }]);
    expect(out.clientId).toBe('w-1');
  });

  it('keeps an incoming id and leaves a task that never had one alone', () => {
    expect(preserveStickyFields([{ id: 'a', clientId: 'w-2' }], [{ id: 'a', clientId: 'w-1' }])[0].clientId).toBe('w-2');
    expect('clientId' in preserveStickyFields([{ id: 'a' }], [{ id: 'a' }])[0]).toBe(false);
  });
});

describe('preserveStickyFields — completedAt (packages/dayglance-vault/src/completedAt.js)', () => {
  const STAMP = '2026-11-27T14:57:15-07:00';

  it('a done incoming copy without a stamp keeps the one this device recorded', () => {
    const [out] = preserveStickyFields([{ id: 'a', completed: true }], [{ id: 'a', completed: true, completedAt: STAMP }]);
    expect(out.completedAt).toBe(STAMP);
  });

  it('an incoming reopen takes no stamp, and an incoming stamp is kept', () => {
    expect(preserveStickyFields([{ id: 'a', completed: false, completedAt: null }], [{ id: 'a', completed: true, completedAt: STAMP }])[0].completedAt).toBeNull();
    expect(preserveStickyFields([{ id: 'a', completed: true, completedAt: 'X' }], [{ id: 'a', completed: true, completedAt: STAMP }])[0].completedAt).toBe('X');
  });
});

describe('preserveStickyFields — an Obsidian title (packages/dayglance-vault/src/obsidianTitle.js)', () => {
  const vault = (raw) => ({ id: 'a', importSource: 'obsidian', title: `${raw} #obsidian`, obsidianRawTitle: raw });

  it('an incoming copy holding a damaged line\'s text keeps the clean title this device holds', () => {
    const [out] = preserveStickyFields([vault('Five ^dg-abcd1234 extra')], [vault('Five')]);
    expect(out).toMatchObject({ title: 'Five #obsidian', obsidianRawTitle: 'Five' });
  });

  it('an incoming clean retitle is kept', () => {
    expect(preserveStickyFields([vault('Six')], [vault('Five')])[0].obsidianRawTitle).toBe('Six');
  });
});
