import { describe, it, expect } from 'vitest';
import { isOnHold, hyperGlanceRuns, pausedLast } from './projectStatus.js';
import { getHGBarsForDate, getGlanceHGInstances } from '../hooks/useHyperGlance.js';

// A project on hold: still listed and intact, but no longer asking for
// attention. Here: the rules, and hyperGLANCE leaving it alone.

describe('isOnHold / pausedLast', () => {
  it('knows the status, and nothing else counts', () => {
    expect(isOnHold({ status: 'on-hold' })).toBe(true);
    for (const status of ['active', 'completed', 'archived', undefined]) expect(isOnHold({ status })).toBe(false);
    expect(isOnHold(null)).toBe(false);
  });

  it('moves on-hold projects after the others, each side in its order, and leaves a list without any as it is', () => {
    const list = [{ id: 'a', status: 'on-hold' }, { id: 'b', status: 'active' }, { id: 'c', status: 'on-hold' }, { id: 'd' }];
    expect(pausedLast(list).map((p) => p.id)).toEqual(['b', 'd', 'a', 'c']);
    const plain = [{ id: 'x' }];
    expect(pausedLast(plain)).toBe(plain);
  });
});

describe('hyperGLANCE on an on-hold project', () => {
  // A session every day at 09:00, set up today: today's is the one due.
  const hg = (extra = {}) => ({
    id: 'p1', title: 'Writing', status: 'active',
    hyperglance: { enabled: true, isRecurring: true, scheduledDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], scheduledTime: '09:00', scheduledDuration: 60, completions: [], createdAt: new Date().toISOString() },
    ...extra,
  });

  it('runs only when enabled, not archived and not on hold', () => {
    expect(hyperGlanceRuns(hg())).toBe(true);
    expect(hyperGlanceRuns(hg({ status: 'on-hold' }))).toBe(false);
    expect(hyperGlanceRuns(hg({ archived: true }))).toBe(false);
    expect(hyperGlanceRuns({ ...hg(), hyperglance: { enabled: false } })).toBe(false);
  });

  // MUTATION: drop the on-hold check from hyperGlanceRuns and a paused
  // project keeps its bars, agenda entries and (through these) reminders.
  it('draws no bars and offers no sessions (which the reminders read) while on hold', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(getHGBarsForDate([hg()], todayStr, 0).length).toBeGreaterThan(0);
    expect(getHGBarsForDate([hg({ status: 'on-hold' })], todayStr, 0)).toEqual([]);
    expect(getGlanceHGInstances([hg()], 0).length).toBeGreaterThan(0);
    expect(getGlanceHGInstances([hg({ status: 'on-hold' })], 0)).toEqual([]);
  });
});
