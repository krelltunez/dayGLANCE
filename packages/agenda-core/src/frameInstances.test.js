import { describe, it, expect } from 'vitest';
import { dayOfWeekFor, frameAppliesTo, frameInstancesForDate } from './frameInstances.js';

// 2026-09-19 is a Saturday (day 6); 2026-09-21 a Monday (day 1).
const SAT = '2026-09-19';
const MON = '2026-09-21';

const F = (over = {}) => ({
  id: 'f1', label: 'Deep work', enabled: true, days: [1, 2, 3, 4, 5],
  start: '09:00', end: '12:00', color: 'blue',
  tagAffinity: ['#writing'], energyLevel: 'high', bufferMinutes: 5, ...over,
});

describe('frameInstancesForDate', () => {
  it('resolves a weekday rule', () => {
    expect(frameInstancesForDate([F()], MON)).toHaveLength(1);
    expect(frameInstancesForDate([F()], SAT)).toHaveLength(0);
  });

  it('honours enabled', () => {
    expect(frameInstancesForDate([F({ enabled: false })], MON)).toEqual([]);
  });

  it('honours singleDate, which overrides the weekday rule entirely', () => {
    const pinned = F({ singleDate: SAT, days: [1, 2, 3, 4, 5] });
    expect(frameInstancesForDate([pinned], SAT)).toHaveLength(1);
    // Monday is in `days`, but singleDate wins.
    expect(frameInstancesForDate([pinned], MON)).toHaveLength(0);
  });

  it('applies a per-date start/end exception', () => {
    const withException = F({ exceptions: { [MON]: { start: '10:00', end: '11:00' } } });
    const [inst] = frameInstancesForDate([withException], MON);
    expect([inst.start, inst.end]).toEqual(['10:00', '11:00']);
    // Other dates are untouched.
    expect(frameInstancesForDate([withException], '2026-09-22')[0].start).toBe('09:00');
  });

  it('drops an instance deleted for that date only', () => {
    const withDelete = F({ exceptions: { [MON]: { deleted: true } } });
    expect(frameInstancesForDate([withDelete], MON)).toEqual([]);
    expect(frameInstancesForDate([withDelete], '2026-09-22')).toHaveLength(1);
  });

  it('defaults bufferMinutes to 5, energyLevel to medium, tagAffinity to []', () => {
    const bare = { id: 'f2', label: 'Bare', enabled: true, days: [1], start: '09:00', end: '10:00' };
    expect(frameInstancesForDate([bare], MON)[0]).toMatchObject({
      bufferMinutes: 5, energyLevel: 'medium', tagAffinity: [],
    });
  });

  it('keeps an explicit bufferMinutes of 0 rather than defaulting it', () => {
    // ?? not ||, so a deliberate zero-buffer frame is not silently given 5.
    expect(frameInstancesForDate([F({ bufferMinutes: 0 })], MON)[0].bufferMinutes).toBe(0);
  });

  it('tolerates a malformed date and a missing days array', () => {
    expect(dayOfWeekFor('nonsense')).toBeNull();
    expect(frameInstancesForDate([F()], 'nonsense')).toEqual([]);
    expect(frameAppliesTo(F({ days: undefined }), MON, 1)).toBe(false);
  });
});
